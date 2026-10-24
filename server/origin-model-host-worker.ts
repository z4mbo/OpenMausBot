import { randomBytes, randomUUID } from "node:crypto";
import type { ModelHostAccountState } from "./origin-model-host-state.ts";
import type { HostedContextRow, HostedPort, HostedTurnInput, HostedTurnOutcome, HostedWork } from "./origin-model-host-types.ts";

export interface HostedPreparation { botId: string; instanceId: string; cwd: string }
interface WorkerDeps {
  account: ModelHostAccountState;
  port: HostedPort;
  current(): boolean;
  inspect(work: HostedWork): Promise<HostedPreparation>;
  run(input: HostedTurnInput): Promise<HostedTurnOutcome>;
  now?: () => number;
  monotonicNow?: () => number;
}

async function bounded<T>(action: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Origin model host confirmation timed out")), 8_000);
      timer.unref?.();
    })]);
  } finally { clearTimeout(timer); }
}

export function createHostedWorker(deps: WorkerDeps) {
  const active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  const attempted = new Set<string>();
  const now = deps.now ?? Date.now;
  const monotonic = deps.monotonicNow ?? (() => performance.now());
  const hostAuth = { hostId: deps.account.hostId, hostToken: deps.account.hostToken };
  let stopped = false;

  const execute = async (work: HostedWork, abort: AbortController) => {
    const source = deps.account.sources[work.sourceKey];
    const decline = async (reason: "configuration" | "unavailable") => {
      await bounded(deps.port.mutation("modelHosts:decline", { ...hostAuth, executionId: work.executionId, reason })).catch(() => undefined);
    };
    if (stopped || !deps.current() || !source?.enabled || source.sourceId !== work.sourceId || work.teamId !== deps.account.teamId) {
      await decline("unavailable"); return;
    }
    let prepared: HostedPreparation;
    try { prepared = await bounded(deps.inspect(work)); }
    catch { await decline("configuration"); return; }
    if (stopped || abort.signal.aborted || !deps.current()) { await decline("unavailable"); return; }
    const fenced = { ...hostAuth, executionId: work.executionId, leaseToken: randomBytes(32).toString("hex") };
    let claim: { work: HostedWork; leaseUntil: number };
    try {
      claim = await bounded(deps.port.mutation("modelHosts:claim", { ...fenced, claimId: randomUUID() })) as typeof claim;
    } catch { return; }
    if (claim.work.executionId !== work.executionId || claim.work.runId !== work.runId || claim.work.requestClientId !== work.requestClientId ||
        claim.work.text !== work.text || claim.work.sourceKey !== source.sourceKey || claim.work.definitionHash !== work.definitionHash) {
      abort.abort(); return;
    }
    let expiresAt = monotonic() + Math.max(0, Math.min(60_000, claim.leaseUntil - now()));
    let activity = false, failed = false, heartbeatInFlight = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let output = Promise.resolve();
    const written = new Set<string>();
    const valid = () => !stopped && !abort.signal.aborted && deps.current() && monotonic() < expiresAt;
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      if (!valid()) throw new Error("The hosted execution no longer holds its lease");
      return bounded(deps.port.mutation(name, { ...fenced, ...args }));
    };
    const fail = () => { failed = true; abort.abort(); };
    const armExpiry = () => { clearTimeout(expiryTimer); expiryTimer = setTimeout(fail, Math.max(0, expiresAt - monotonic())); expiryTimer.unref?.(); };
    armExpiry();
    const queue = (action: () => Promise<unknown>) => {
      output = output.then(async () => { if (failed) return; await action(); }).catch(fail);
    };
    const markActivity = () => {
      if (activity) return;
      activity = true;
      queue(() => call("modelHosts:activity"));
    };
    const heartbeat = setInterval(() => {
      if (!valid()) { fail(); return; }
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      const sentAt = monotonic();
      void call("modelHosts:heartbeatExecution").then(value => {
        const result = value as { leaseUntil?: number };
        if (typeof result.leaseUntil !== "number") throw new Error("Invalid execution heartbeat");
        expiresAt = sentAt + Math.max(0, Math.min(60_000, result.leaseUntil - now()));
        armExpiry();
        if (!valid()) fail();
      }).catch(fail).finally(() => { heartbeatInFlight = false; });
    }, 10_000);
    heartbeat.unref?.();
    try {
      const context: HostedContextRow[] = [];
      let afterSeq = 0, bytes = 0;
      for (let page = 0; page < 20; page++) {
        const result = await call("modelHosts:context", { afterSeq, limit: 50 }) as {
          requestSeq: number; nextSeq: number; more: boolean; messages: HostedContextRow[];
        };
        if (result.requestSeq !== claim.work.requestSeq || !Array.isArray(result.messages) || result.nextSeq < afterSeq ||
            result.messages.some(row => row.seq <= afterSeq || row.seq >= result.requestSeq)) throw new Error("Invalid hosted conversation context");
        bytes += Buffer.byteLength(JSON.stringify(result.messages));
        if (bytes > 1024 * 1024) throw new Error("Hosted conversation exceeds the bounded replay size");
        context.push(...result.messages);
        if (!result.more) break;
        if (result.nextSeq <= afterSeq || page === 19) throw new Error("Hosted conversation context was incomplete");
        afterSeq = result.nextSeq;
      }
      const outcome = await deps.run({
        ...prepared, work: claim.work, context, signal: abort.signal,
        beforeDispatch: async () => {
          const fresh = await bounded(deps.inspect(claim.work));
          if (fresh.botId !== prepared.botId || fresh.cwd !== prepared.cwd || fresh.instanceId !== prepared.instanceId) throw new Error("The model host's local execution binding changed");
          await call("modelHosts:started");
          if (!valid()) throw new Error("The hosted execution expired before dispatch");
        },
        activity: markActivity,
        emit: (row, patch) => {
          if (row.role !== "bot" || !valid()) return;
          markActivity();
          const clientId = `host:${work.executionId}:${row.clientId}`;
          const wasWritten = written.has(clientId);
          written.add(clientId);
          const { role: _role, kind, clientId: _local, ...content } = row;
          queue(() => call(patch && wasWritten ? "modelHosts:patchReply" : "modelHosts:appendReply",
            { clientId, ...(patch && wasWritten ? {} : { kind }), ...content, status: row.status ?? "final" }));
        },
      });
      await output;
      if (!valid() || failed) return;
      const safe = !activity && !written.size && outcome.refusal?.kind === "quota_exhausted" && outcome.refusal.retry === "safe_initial_refusal";
      await call("modelHosts:finish", { outcome: safe ? "quota_exhausted" : outcome.ok ? "succeeded" : "failed",
        ...(safe ? { safeInitialRefusal: true, quiesced: true } : {}) });
    } catch {
      if (valid() && !failed) await call("modelHosts:finish", { outcome: "failed" }).catch(() => undefined);
    } finally { clearInterval(heartbeat); clearTimeout(expiryTimer); abort.abort(); }
  };

  return {
    offer(work: HostedWork): void {
      if (stopped || attempted.has(work.executionId)) return;
      attempted.add(work.executionId);
      if (attempted.size > 5_000) { stopped = true; return; }
      const abort = new AbortController();
      const done = execute(work, abort).catch(() => undefined).finally(() => active.delete(work.executionId));
      active.set(work.executionId, { abort, done });
    },
    activeCount: () => active.size,
    async drain(): Promise<void> { await Promise.all([...active.values()].map(job => job.done)); },
    stop(): void { stopped = true; for (const job of active.values()) job.abort.abort(); },
  };
}
