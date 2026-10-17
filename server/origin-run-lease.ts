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

interface ActiveRun { runId: string; botId: string; startedAt: number; sawBusy: boolean }

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
  const active = new Map<string, ActiveRun>();
  const recent = new Map<string, { runId: string; endedAt: number }>();
  const starting = new Set<string>();
  const lastRows = new Map<string, readonly { runId: string; status: string }[]>();

  const finish = (threadId: string, status: "succeeded" | "failed") => {
    const run = active.get(threadId);
    if (!run) return;
    active.delete(threadId);
    recent.set(threadId, { runId: run.runId, endedAt: now() });
    deps.outbox.enqueue("agentRuns:finish", { runId: run.runId, status });
    deps.kick();
  };

  return {
    async begin(input: BeginInput): Promise<{ runId: string; status: "running" | "queued"; messageId: string }> {
      const result = await deps.mutation("agentRuns:begin", {
        threadId: input.cloudThreadId, clientId: input.clientId, text: input.text, ...(input.engineLabel ? { engineLabel: input.engineLabel } : {}),
      }) as { runId: string; status: string; messageId: string };
      if (result.status === "running") {
        active.set(input.threadId, { runId: result.runId, botId: input.botId, startedAt: now(), sawBusy: false });
        return { runId: result.runId, status: "running", messageId: result.messageId };
      }
      if (result.status !== "queued") throw Object.assign(new Error(`this message's run already ended (${result.status})`), { status: 409 });
      return { runId: result.runId, status: "queued", messageId: result.messageId };
    },

    /** Remembers a queued run with the local line that stands for it, so a restart can still start it. */
    remember(run: QueuedRun): void {
      deps.outbox.saveQueuedRun({ ...run, savedAt: now() });
      const rows = lastRows.get(run.teamId);
      if (rows?.some((row) => row.runId === run.runId && row.status === "running")) this.pending(run.teamId, rows);
    },

    runFor(threadId: string): string | undefined {
      const live = active.get(threadId);
      if (live) return live.runId;
      const ended = recent.get(threadId);
      return ended && now() - ended.endedAt <= WRITE_GRACE_MS ? ended.runId : undefined;
    },

    holds(threadId: string): boolean {
      return active.has(threadId);
    },

    /** The local turn could not start or failed before it ran. */
    failed(threadId: string): void {
      finish(threadId, "failed");
    },

    /** Called on every bot change: a run ends when its thread goes from busy back to idle. */
    observe(botId: string): void {
      for (const [threadId, run] of active) {
        if (run.botId !== botId) continue;
        if (deps.isBusy(botId, threadId)) run.sawBusy = true;
        else if (run.sawBusy) finish(threadId, "succeeded");
      }
    },

    /** My live and queued runs for one workspace, as Origin reports them. */
    pending(teamId: string, rows: readonly { runId: string; status: string }[]): void {
      lastRows.set(teamId, rows);
      const live = new Map(rows.map((row) => [row.runId, row.status]));
      for (const run of deps.outbox.queuedRuns()) {
        if (run.teamId !== teamId || starting.has(run.runId)) continue;
        const status = live.get(run.runId);
        if (status === "queued" || (status === undefined && now() - (run.savedAt ?? 0) < SNAPSHOT_LAG_MS)) continue;
        deps.outbox.dropQueuedRun(run.runId);
        if (status !== "running") {
          deps.abandoned(run);
          continue;
        }
        starting.add(run.runId);
        active.set(run.threadId, { runId: run.runId, botId: run.botId, startedAt: now(), sawBusy: false });
        void deps.startQueued(run)
          .catch(() => finish(run.threadId, "failed"))
          .finally(() => starting.delete(run.runId));
      }
    },

    async tick(): Promise<void> {
      for (const [threadId, run] of active) {
        if (!run.sawBusy && now() - run.startedAt > START_TIMEOUT_MS) {
          finish(threadId, "failed");
          continue;
        }
        if (run.sawBusy && !deps.isBusy(run.botId, threadId)) {
          finish(threadId, "succeeded");
          continue;
        }
        const answer = await deps.mutation("agentRuns:heartbeat", { runId: run.runId }).catch(() => null) as { status?: string } | null;
        if (answer?.status && answer.status !== "running" && active.get(threadId)?.runId === run.runId) {
          active.delete(threadId);
          deps.interrupt(run.botId, threadId);
        }
      }
      for (const [threadId, ended] of recent) if (now() - ended.endedAt > WRITE_GRACE_MS) recent.delete(threadId);
    },
  };
}

export type RunLease = ReturnType<typeof createRunLease>;
