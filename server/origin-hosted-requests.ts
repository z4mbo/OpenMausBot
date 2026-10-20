import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { modelPairKey } from "../shared/model-selection.ts";
import { sameModelSelection } from "../shared/thread-model.ts";
import { writeFileAtomic } from "./atomic.ts";
import type { ModelSelection } from "./contracts.ts";
import { defaultModelSelectionSchema } from "./model-selection-config.ts";
import { modelAccountKey } from "./model-backup.ts";
import type { HostedPort } from "./origin-model-host-types.ts";
import type { Message, Store } from "./store.ts";

export interface RequesterScope { origin: string; userId: string; identity: object; port: HostedPort }
export interface HostedRequestStatus {
  runId: string; runStatus: string; route: "host" | "sender" | "none";
  currentExecutionId: string | null; previousExecutionId?: string;
  sourceId?: string; hostId?: string; model: string; provider: string;
  requestKey?: string; executionStatus?: string;
}
interface ExecutionStatus {
  sourceId: string; model: string; requestKey: string; status: string; runStatus: string;
  currentExecutionId: string | null; safeToRetry: boolean; refusal?: string;
}
export type RequestBackup = { selection: ModelSelection; provider: string };
const text = z.string().min(1).max(500);
const pendingSchema = z.object({
  id: text, origin: text, userId: text, botId: text, threadId: text, cloudThreadId: text, teamId: text,
  clientId: z.string().min(1).max(160), messageId: text, selection: defaultModelSelectionSchema,
  expectedSelection: defaultModelSelectionSchema.optional(),
  queued: z.boolean().optional(),
  stage: z.enum(["begin", "offer", "host", "advance", "sender-starting", "sender"]),
  runId: text.optional(), executionId: text.optional(), previousExecutionId: text.optional(),
  transferKey: text.optional(), target: z.object({ selection: defaultModelSelectionSchema, provider: text }).optional(),
  quota: z.boolean(), cancelRequested: z.boolean(), visited: z.array(text).max(16), blockedAccounts: z.array(text).max(16),
  noteId: text.optional(), createdAt: z.number().finite(),
}).strict();
export type HostedRequest = z.infer<typeof pendingSchema>;

interface RequesterDeps {
  file: string;
  store: Pick<Store, "bot" | "projectBotForTask" | "taskByThread" | "messagesFor" | "patchMessage" | "appendMessage" | "setTaskActivity" | "switchTaskModel">;
  scope(): RequesterScope | null;
  next(request: HostedRequest, current: () => boolean): Promise<RequestBackup | null>;
  validate(botId: string, selection: ModelSelection, allowMetered: boolean): Promise<unknown>;
  startSender(request: HostedRequest, target: RequestBackup, current: () => boolean): Promise<void>;
  handover(threadId: string, runId: string): boolean;
  release(threadId: string, publish: boolean, runId: string): void;
  locallyRunning?(threadId: string): boolean;
  redact(text: string): string;
  now?: () => number;
  timeoutMs?: number;
}

export function createHostedRequests(deps: RequesterDeps) {
  const now = deps.now ?? Date.now;
  const rows = new Map<string, HostedRequest>();
  const inFlight = new Map<string, Promise<void>>();
  const senderLaunches = new Set<string>();
  let stopped = false;
  if (existsSync(deps.file)) {
    const saved = z.object({ version: z.literal(1), requests: z.array(pendingSchema).max(200) }).strict().parse(JSON.parse(readFileSync(deps.file, "utf8")));
    for (const row of saved.requests) rows.set(row.id, row);
  }
  const save = () => {
    mkdirSync(dirname(deps.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(deps.file, JSON.stringify({ version: 1, requests: [...rows.values()] }), { mode: 0o600 });
  };
  const current = (scope: RequesterScope) => !stopped && deps.scope()?.identity === scope.identity;
  const belongs = (row: HostedRequest, scope: RequesterScope) => row.origin === scope.origin && row.userId === scope.userId;
  const update = (row: HostedRequest, patch: Partial<HostedRequest>) => { const previous = JSON.stringify(row); Object.assign(row, patch); if (JSON.stringify(row) !== previous) save(); };
  const refreshActivity = (row: HostedRequest) => {
    const active = [...rows.values()].some(candidate => candidate.origin === row.origin && candidate.userId === row.userId && candidate.threadId === row.threadId);
    if (!active && deps.locallyRunning?.(row.threadId)) return;
    deps.store.setTaskActivity(row.botId, row.threadId, active ? "working" : "idle");
  };
  const note = (row: HostedRequest, message: string) => {
    const tool = { name: message, ok: false };
    if (row.noteId && deps.store.messagesFor(row.threadId).some(message => message.id === row.noteId)) deps.store.patchMessage(row.threadId, row.noteId, { tool });
    else update(row, { noteId: deps.store.appendMessage(row.threadId, { role: "bot", kind: "activity", tool }).id });
  };
  const finish = (row: HostedRequest, scope: RequesterScope) => {
    if (!current(scope)) return;
    if (row.runId && row.stage !== "sender") { deps.handover(row.threadId, row.runId); deps.release(row.threadId, false, row.runId); }
    deps.store.patchMessage(row.threadId, row.messageId, { requestPending: false, queued: undefined, ...(row.cancelRequested ? { requestCancelled: true } : {}) });
    rows.delete(row.id); senderLaunches.delete(row.id); save(); refreshActivity(row);
  };
  const call = async <T>(action: Promise<unknown>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([action, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Origin could not confirm the shared request")), deps.timeoutMs ?? 8_000); timer.unref?.(); })]) as T;
    } finally { clearTimeout(timer); }
  };
  const status = (row: HostedRequest, scope: RequesterScope) => call<HostedRequestStatus | null>(scope.port.query("modelHosts:requestStatus", { threadId: row.cloudThreadId, clientId: row.clientId, now: now() }));
  const eligible = (row: HostedRequest, scope: RequesterScope) => {
    const bot = deps.store.projectBotForTask(row.botId, row.threadId);
    return current(scope) && rows.get(row.id) === row && !row.cancelRequested && bot?.quotaFallback === true && sameModelSelection(bot.modelSelection, row.selection);
  };
  const confirmedHost = (row: HostedRequest, scope: RequesterScope, found: HostedRequestStatus, selection: ModelSelection) => {
    if (!current(scope) || rows.get(row.id) !== row || row.cancelRequested || !found.currentExecutionId || found.sourceId !== selection.source?.sourceId || found.hostId !== selection.source?.hostId || found.model !== selection.model) return false;
    const live = deps.store.projectBotForTask(row.botId, row.threadId)?.modelSelection;
    const queued = found.runStatus === "queued";
    if (!queued && !row.queued && (!live || !sameModelSelection(live, row.expectedSelection ?? row.selection) && !sameModelSelection(live, selection))) return false;
    if (row.runId) { deps.handover(row.threadId, row.runId); deps.release(row.threadId, false, row.runId); }
    senderLaunches.delete(row.id);
    update(row, { runId: found.runId, executionId: found.currentExecutionId, stage: "host", selection, queued, expectedSelection: undefined, target: undefined, transferKey: undefined });
    if (!queued) deps.store.switchTaskModel(row.botId, row.threadId, selection, false, false, { resumeCursors: {}, rewound: true });
    deps.store.patchMessage(row.threadId, row.messageId, { queued: undefined });
    refreshActivity(row);
    return true;
  };
  const launchSender = async (row: HostedRequest, scope: RequesterScope, target: RequestBackup) => {
    if (!eligible(row, scope) || senderLaunches.has(row.id)) return;
    update(row, { stage: "sender-starting", selection: target.selection, target, executionId: undefined });
    senderLaunches.add(row.id);
    deps.store.switchTaskModel(row.botId, row.threadId, target.selection, false, false, { resumeCursors: {}, rewound: true });
    try {
      await deps.startSender(structuredClone(row), target, () => eligible(row, scope));
      if (current(scope) && rows.get(row.id) === row && !row.cancelRequested) update(row, { stage: "sender", target: undefined });
    } catch {
      if (current(scope)) note(row, "The local backup could not be confirmed. Check this conversation before sending the work again.");
    }
  };
  const cancel = async (row: HostedRequest, scope: RequesterScope, found?: HostedRequestStatus | null) => {
    const observed = found ?? (row.runId ? { runId: row.runId, runStatus: "running" } : await status(row, scope));
    if (!current(scope)) throw new Error("The Origin account changed before Stop was confirmed");
    if (!observed) throw new Error("Stop is not confirmed yet. Origin is still checking whether the shared request was accepted.");
    if (observed.runStatus === "running" || observed.runStatus === "queued") await call(scope.port.mutation("agentRuns:cancel", { runId: observed.runId }));
    if (!current(scope)) throw new Error("The Origin account changed before Stop was confirmed");
    if (row.runId) { deps.handover(row.threadId, row.runId); deps.release(row.threadId, false, row.runId); }
    finish(row, scope);
  };
  const reconcile = async (row: HostedRequest, scope: RequesterScope) => {
    const found = await status(row, scope);
    if (!current(scope) || rows.get(row.id) !== row) return;
    if (row.cancelRequested) { await cancel(row, scope, found); return; }
    if (!found) { note(row, "Shared execution is unconfirmed. Origin is checking the original request; it will not send it again."); return; }
    if (row.runId && row.runId !== found.runId) throw new Error("The shared request identity changed");
    if (!["running", "queued"].includes(found.runStatus)) { finish(row, scope); return; }
    if (found.route === "none") {
      note(row, "The shared execution lease ended. Work may have run; check this conversation before retrying.");
      finish(row, scope); return;
    }
    update(row, { runId: found.runId });
    if (row.stage === "sender" || row.stage === "sender-starting") {
      if (row.stage === "sender-starting" && !senderLaunches.has(row.id)) note(row, "A previous local backup may have started. It will not be replayed after restarting Origin.");
      return;
    }
    if (row.stage === "advance") {
      const target = row.target;
      if (target?.selection.source && found.requestKey === row.transferKey) {
        confirmedHost(row, scope, found, target.selection);
      } else if (target && !target.selection.source && found.route === "sender" && found.previousExecutionId === row.previousExecutionId && found.provider === target.provider && found.model === target.selection.model) {
        await launchSender(row, scope, target);
      } else if (found.currentExecutionId !== row.previousExecutionId) note(row, "The shared request changed on another computer. Automatic fallback is paused.");
      else note(row, "The backup transfer is unconfirmed. Origin is checking it before doing any more work.");
      return;
    }
    if (row.stage === "begin" || row.stage === "offer") {
      if (!confirmedHost(row, scope, found, row.selection)) { note(row, "Shared execution could not be matched to the chosen account. Check this conversation before retrying."); return; }
    }
    if (row.queued && found.runStatus === "running" && !confirmedHost(row, scope, found, row.selection)) return;
    if (found.runStatus !== "running" || found.route !== "host" || found.currentExecutionId !== row.executionId) return;
    const execution = await call<ExecutionStatus>(scope.port.query("modelHosts:executionStatus", { executionId: row.executionId, now: now() }));
    if (!current(scope) || row.cancelRequested) return;
    if (execution.currentExecutionId !== row.executionId || execution.sourceId !== row.selection.source?.sourceId || execution.model !== row.selection.model || !execution.safeToRetry) return;
    if (execution.refusal === "quota_exhausted") update(row, { quota: true, blockedAccounts: [...new Set([...row.blockedAccounts, modelAccountKey(row.selection)])].slice(-16) });
    if (!row.quota || !eligible(row, scope)) {
      note(row, row.quota ? "Backup settings or model choice changed. Automatic fallback is paused." : "The shared account could not start this request. No backup was run.");
      return;
    }
    const target = await deps.next(structuredClone(row), () => eligible(row, scope));
    if (!eligible(row, scope)) return;
    const previousExecutionId = row.executionId, transferKey = `fallback:${randomUUID()}`;
    update(row, { stage: "advance", previousExecutionId, transferKey, target: target ?? undefined,
      visited: target ? [...new Set([...row.visited, modelPairKey(target.selection)])].slice(-16) : row.visited });
    await call(scope.port.mutation("modelHosts:advance", { runId: row.runId, previousExecutionId, requestKey: transferKey,
      target: target ? target.selection.source ? { sourceId: target.selection.source.sourceId, model: target.selection.model, allowMetered: deps.store.bot(row.botId)?.fallbackApiAllowed === true }
        : { kind: "sender", provider: target.provider, model: target.selection.model } : null }));
    if (!current(scope)) return;
    if (row.cancelRequested) { await cancel(row, scope); return; }
    await reconcile(row, scope);
  };
  const exclusive = (row: HostedRequest, scope: RequesterScope, action: () => Promise<void>) => {
    const existing = inFlight.get(row.id);
    if (existing) return existing;
    const task = Promise.resolve().then(action).finally(() => { if (inFlight.get(row.id) === task) inFlight.delete(row.id); });
    inFlight.set(row.id, task);
    void task.catch(() => { if (current(scope) && rows.has(row.id)) note(row, row.cancelRequested ? "Stop is not confirmed. Origin will keep checking this shared request." : "Shared execution is unconfirmed. Check this conversation before sending the work again."); });
    return task;
  };
  const seed = (scope: RequesterScope, input: { botId: string; threadId: string; cloudThreadId: string; teamId: string; clientId: string; messageId: string; selection: ModelSelection }, stage: HostedRequest["stage"], extra: Partial<HostedRequest> = {}) => {
    if (rows.size >= 200) throw new Error("Too many unresolved shared requests. Resolve them before sending more work.");
    const row = pendingSchema.parse({ ...input, id: randomUUID(), origin: scope.origin, userId: scope.userId,
      stage, quota: false, cancelRequested: false, visited: [modelPairKey(input.selection)], blockedAccounts: [], createdAt: now(), ...extra });
    rows.set(row.id, row); save(); return row;
  };
  return {
    async begin(input: { botId: string; threadId: string; cloudThreadId: string; teamId: string; clientId: string; message: Message; selection: ModelSelection; current?(): boolean }) {
      const scope = deps.scope();
      if (!scope || !input.selection.source) throw new Error("Sign in to Origin and choose a shared account");
      await deps.validate(input.botId, input.selection, true);
      if (!current(scope) || input.current?.() === false || !sameModelSelection(deps.store.projectBotForTask(input.botId, input.threadId)?.modelSelection ?? { instanceId: "", model: "" }, input.selection)) throw new Error("The Origin account, model or pending request changed before sending");
      const { message, current: _admissionCurrent, ...target } = input;
      const row = seed(scope, { ...target, messageId: message.id }, "begin");
      refreshActivity(row);
      await exclusive(row, scope, async () => {
        const result = await call<{ runId: string; executionId: string }>(scope.port.mutation("modelHosts:begin", { threadId: row.cloudThreadId, clientId: row.clientId,
          text: deps.redact(message.text ?? ""), sourceId: row.selection.source!.sourceId, model: row.selection.model, allowMetered: true }));
        if (!current(scope) || rows.get(row.id) !== row) return;
        update(row, { runId: result.runId, executionId: result.executionId });
        await reconcile(row, scope);
      });
    },
    async offer(input: { botId: string; threadId: string; cloudThreadId: string; teamId: string; clientId: string; messageId: string; runId: string; selection: ModelSelection; visited: string[]; blockedAccounts: string[]; current(): boolean }) {
      const scope = deps.scope();
      if (!scope || !input.selection.source || !input.current()) return false;
      try { await deps.validate(input.botId, input.selection, deps.store.bot(input.botId)?.fallbackApiAllowed === true); }
      catch { return false; }
      if (!current(scope) || !input.current()) return false;
      const previous = [...rows.values()].find(row => belongs(row, scope) && row.runId === input.runId && row.threadId === input.threadId);
      const { current: _current, ...target } = input;
      const row = previous ?? seed(scope, target, "offer", { quota: true, runId: input.runId, visited: input.visited, blockedAccounts: input.blockedAccounts });
      update(row, { stage: "offer", selection: input.selection, expectedSelection: deps.store.projectBotForTask(input.botId, input.threadId)?.modelSelection,
        quota: true, visited: input.visited, blockedAccounts: input.blockedAccounts, transferKey: `fallback:${randomUUID()}` });
      await exclusive(row, scope, async () => {
        await call(scope.port.mutation("modelHosts:offerExisting", { runId: input.runId, sourceId: input.selection.source!.sourceId, model: input.selection.model,
          allowMetered: deps.store.bot(input.botId)?.fallbackApiAllowed === true, requestKey: row.transferKey, safeInitialRefusal: true, quiesced: true }));
        if (current(scope)) await reconcile(row, scope);
      }).catch(() => undefined);
      return true;
    },
    async tick() {
      const scope = deps.scope(); if (!scope || stopped) return;
      await Promise.all([...rows.values()].filter(row => belongs(row, scope)).map(row => exclusive(row, scope, () => reconcile(row, scope)).catch(() => undefined)));
    },
    async cancelThread(botId: string, threadId: string): Promise<boolean> {
      const scope = deps.scope(); if (!scope || stopped) return false;
      const selected = [...rows.values()].filter(row => belongs(row, scope) && row.botId === botId && row.threadId === threadId);
      if (!selected.length) return false;
      for (const row of selected) update(row, { cancelRequested: true });
      for (const row of selected) {
        if (rows.has(row.id)) await cancel(row, scope);
      }
      return true;
    },
    owns(threadId: string) { const scope = deps.scope(); return Boolean(scope && [...rows.values()].some(row => belongs(row, scope) && row.threadId === threadId)); },
    stop() { stopped = true; },
  };
}
