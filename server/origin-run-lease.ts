import type { Outbox, QueuedRun } from "./origin-outbox.ts";

export interface LeaseDeps {
  /** Sends straight to Origin (not through the outbox): beginning a run must know at once whether it holds the thread. */
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  outbox: Pick<Outbox, "enqueue" | "queuedRuns" | "saveQueuedRun" | "dropQueuedRun">;
  kick(): void;
  isBusy(botId: string, threadId: string): boolean;
  /** Starts the turn of a run that waited for the thread and now holds it. */
  startQueued(run: QueuedRun): Promise<void>;
  /** The run was stopped elsewhere (cancelled, or its lease lapsed): stop the local turn. */
  interrupt(botId: string, threadId: string): void;
  /** A queued run will never start: clear its local waiting state. */
  abandoned(run: QueuedRun): void;
  now?: () => number;
  monotonicNow?: () => number;
}

export interface BeginInput {
  botId: string;
  threadId: string;
  cloudThreadId: string;
  teamId: string;
  text: string;
  clientId: string;
  engineLabel?: string;
}

interface ActiveRun {
  runId: string;
  botId: string;
  startedAt: number;
  sawBusy: boolean;
  expiresAt: number;
  confirmed: boolean;
  heartbeatInFlight: boolean;
  expiryTimer?: ReturnType<typeof setTimeout>;
  queued?: QueuedRun;
}

const LEASE_MS = 60_000;

/** A run that never got going (a local queue, a refused start) gives the thread back after this long. */
const START_TIMEOUT_MS = 10 * 60_000;
/** Bot rows of a just-finished run may still be on their way; Origin accepts them for 120 s. */
const WRITE_GRACE_MS = 100_000;
/** A subscription snapshot may predate the run it is missing. */
const SNAPSHOT_LAG_MS = 30_000;

/** Holds this machine's side of the thread lease: begins runs, heartbeats them, finishes them when the local turn ends,
 * and starts a waiting run of mine once Origin hands it the thread. */
export function createRunLease(deps: LeaseDeps) {
  const now = deps.now ?? Date.now;
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  const active = new Map<string, ActiveRun>();
  const recent = new Map<string, { runId: string; endedAt: number }>();
  const starting = new Set<string>();
  const lastRows = new Map<string, readonly { runId: string; status: string }[]>();
  const admissions = new Set<() => void>();
  let stopped = false;
  const leaseError = () => Object.assign(new Error("Origin's run lease expired before this turn could start. Send a new message to try again."), { status: 409 });

  const confirmBegin = async (runId: string, expiresAt: number): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => undefined;
    const deadline = new Promise<null>(resolve => {
      cancel = () => { clearTimeout(timeout); resolve(null); };
      admissions.add(cancel);
      timeout = setTimeout(cancel, Math.max(0, expiresAt - monotonicNow()));
      timeout.unref?.();
    });
    try {
      const answer = await Promise.race([
        deps.mutation("agentRuns:heartbeat", { runId }).catch(() => null),
        deadline,
      ]) as { status?: string } | null;
      if (stopped || answer?.status !== "running" || monotonicNow() >= expiresAt) throw leaseError();
    } finally {
      clearTimeout(timeout);
      admissions.delete(cancel);
    }
  };

  const remove = (threadId: string, run: ActiveRun) => {
    clearTimeout(run.expiryTimer);
    active.delete(threadId);
    starting.delete(run.runId);
  };

  const withdraw = (threadId: string, run: ActiveRun) => {
    if (active.get(threadId) !== run) return;
    remove(threadId, run);
    recent.delete(threadId);
    if (run.queued) {
      deps.outbox.dropQueuedRun(run.runId);
      deps.abandoned(run.queued);
    } else deps.interrupt(run.botId, threadId);
  };

  const expire = (threadId: string, run: ActiveRun) => {
    if (active.get(threadId) !== run) return true;
    if (monotonicNow() < run.expiresAt) return false;
    withdraw(threadId, run);
    return true;
  };

  const armExpiry = (threadId: string, run: ActiveRun) => {
    clearTimeout(run.expiryTimer);
    run.expiryTimer = setTimeout(() => {
      if (!expire(threadId, run)) armExpiry(threadId, run);
    }, Math.max(0, run.expiresAt - monotonicNow()));
    run.expiryTimer.unref?.();
  };

  const finish = (threadId: string, status: "succeeded" | "failed", expected?: ActiveRun) => {
    const run = active.get(threadId);
    if (!run || (expected && run !== expected) || expire(threadId, run)) return;
    remove(threadId, run);
    recent.set(threadId, { runId: run.runId, endedAt: now() });
    deps.outbox.enqueue("agentRuns:finish", { runId: run.runId, status });
    deps.kick();
  };

  const heartbeat = async (threadId: string, run: ActiveRun): Promise<void> => {
    if (expire(threadId, run) || run.heartbeatInFlight) return;
    run.heartbeatInFlight = true;
    const requestedAt = monotonicNow();
    try {
      const answer = await deps.mutation("agentRuns:heartbeat", { runId: run.runId }).catch(() => null) as { status?: string } | null;
      if (expire(threadId, run)) return;
      if (answer?.status && answer.status !== "running") {
        withdraw(threadId, run);
        return;
      }
      if (answer?.status !== "running") return;
      run.expiresAt = requestedAt + LEASE_MS;
      if (expire(threadId, run)) return;
      run.confirmed = true;
      armExpiry(threadId, run);
      if (run.queued) {
        const queued = run.queued;
        delete run.queued;
        deps.outbox.dropQueuedRun(run.runId);
        void deps.startQueued(queued)
          .catch(() => finish(threadId, "failed", run))
          .finally(() => starting.delete(run.runId));
      }
    } finally {
      run.heartbeatInFlight = false;
    }
  };

  return {
    async begin(input: BeginInput): Promise<{ runId: string; status: "running" | "queued"; messageId: string }> {
      if (stopped) throw leaseError();
      const requestedAt = monotonicNow();
      const result = await deps.mutation("agentRuns:begin", {
        threadId: input.cloudThreadId, clientId: input.clientId, text: input.text, ...(input.engineLabel ? { engineLabel: input.engineLabel } : {}),
      }) as { runId: string; status: string; messageId: string };
      if (stopped) throw leaseError();
      if (result.status === "running") {
        let previous = active.get(input.threadId);
        if (monotonicNow() >= requestedAt + LEASE_MS || (previous?.runId === result.runId && expire(input.threadId, previous))) {
          throw leaseError();
        }
        if (previous?.runId !== result.runId) {
          await confirmBegin(result.runId, requestedAt + LEASE_MS);
          previous = active.get(input.threadId);
          if (previous?.runId === result.runId) {
            if (expire(input.threadId, previous) || !previous.confirmed) throw leaseError();
          } else {
            if (previous) withdraw(input.threadId, previous);
            recent.delete(input.threadId);
            const run: ActiveRun = { runId: result.runId, botId: input.botId, startedAt: now(), sawBusy: false, expiresAt: requestedAt + LEASE_MS, confirmed: true, heartbeatInFlight: false };
            active.set(input.threadId, run);
            armExpiry(input.threadId, run);
          }
        } else if (!previous.confirmed) throw leaseError();
        return { runId: result.runId, status: "running", messageId: result.messageId };
      }
      if (result.status !== "queued") throw Object.assign(new Error(`this message's run already ended (${result.status})`), { status: 409 });
      return { runId: result.runId, status: "queued", messageId: result.messageId };
    },

    /** Remembers a queued run with the local line that stands for it, so a restart can still start it. */
    remember(run: QueuedRun): void {
      if (stopped) return;
      deps.outbox.saveQueuedRun({ ...run, savedAt: now() });
      const rows = lastRows.get(run.teamId);
      if (rows?.some((row) => row.runId === run.runId && row.status === "running")) this.pending(run.teamId, rows);
    },

    runFor(threadId: string): string | undefined {
      const live = active.get(threadId);
      if (live?.confirmed && monotonicNow() < live.expiresAt) return live.runId;
      const ended = recent.get(threadId);
      return ended && now() - ended.endedAt <= WRITE_GRACE_MS ? ended.runId : undefined;
    },

    holds(threadId: string): boolean {
      const run = active.get(threadId);
      return Boolean(run?.confirmed && monotonicNow() < run.expiresAt);
    },
    handover(threadId: string, expectedRunId: string): boolean {
      const run = active.get(threadId);
      if (!run || run.runId !== expectedRunId || !run.confirmed || expire(threadId, run)) return false;
      remove(threadId, run); recent.delete(threadId);
      return true;
    },

    /** The local turn could not start or failed before it ran. */
    failed(threadId: string): void {
      finish(threadId, "failed");
    },

    /** Called on every bot change: a run ends when its thread goes from busy back to idle. */
    observe(botId: string): void {
      for (const [threadId, run] of active) {
        if (run.botId !== botId || expire(threadId, run) || !run.confirmed) continue;
        if (deps.isBusy(botId, threadId)) run.sawBusy = true;
        else if (run.sawBusy) finish(threadId, "succeeded");
      }
    },

    /** My live and queued runs for one workspace, as Origin reports them. */
    pending(teamId: string, rows: readonly { runId: string; status: string }[]): void {
      if (stopped) return;
      lastRows.set(teamId, rows);
      const live = new Map(rows.map((row) => [row.runId, row.status]));
      for (const run of deps.outbox.queuedRuns()) {
        if (run.teamId !== teamId || starting.has(run.runId)) continue;
        const status = live.get(run.runId);
        if (status === "queued" || (status === undefined && now() - (run.savedAt ?? 0) < SNAPSHOT_LAG_MS)) continue;
        if (status !== "running") {
          deps.outbox.dropQueuedRun(run.runId);
          deps.abandoned(run);
          continue;
        }
        starting.add(run.runId);
        const previous = active.get(run.threadId);
        if (previous) withdraw(run.threadId, previous);
        recent.delete(run.threadId);
        const claiming: ActiveRun = { runId: run.runId, botId: run.botId, startedAt: now(), sawBusy: false, expiresAt: monotonicNow() + LEASE_MS, confirmed: false, heartbeatInFlight: false, queued: run };
        active.set(run.threadId, claiming);
        armExpiry(run.threadId, claiming);
        void heartbeat(run.threadId, claiming);
      }
    },

    async tick(): Promise<void> {
      for (const [threadId, run] of active) {
        if (expire(threadId, run)) continue;
        if (!run.confirmed) {
          await heartbeat(threadId, run);
          continue;
        }
        if (!run.sawBusy && now() - run.startedAt > START_TIMEOUT_MS) {
          finish(threadId, "failed");
          continue;
        }
        if (run.sawBusy && !deps.isBusy(run.botId, threadId)) {
          finish(threadId, "succeeded");
          continue;
        }
        await heartbeat(threadId, run);
      }
      for (const [threadId, ended] of recent) if (now() - ended.endedAt > WRITE_GRACE_MS) recent.delete(threadId);
    },

    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const cancel of admissions) cancel();
      admissions.clear();
      for (const [threadId, run] of active) withdraw(threadId, run);
      recent.clear();
      starting.clear();
      lastRows.clear();
    },
  };
}

export type RunLease = ReturnType<typeof createRunLease>;
