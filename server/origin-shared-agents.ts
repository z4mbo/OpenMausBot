import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { definitionHash, definitionOf } from "../shared/origin-shared-agents.ts";
import type { SharedBotLink } from "../shared/wire.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { resolveSharedModel, type DefaultSelectionContext, type ModelIntent, type SelectableInstance } from "./default-model-selection.ts";
import { UNSEEN_MAX_BYTES, UNSEEN_MAX_MESSAGES } from "./delta-context.ts";
import { defaultCloudLinksFile, readSharedLinks, writeSharedLinks } from "./origin-cloud-sync.ts";
import { defaultOriginCloudFile, readOriginCloud } from "./origin-cloud.ts";
import { openOutbox, type Outbox, type QueuedRun } from "./origin-outbox.ts";
import { createHostedRequests, type HostedRequest, type RequestBackup } from "./origin-hosted-requests.ts";
import { createRunLease, type RunLease } from "./origin-run-lease.ts";
import { clientIdFor, createThreadMirror, type CloudPort } from "./origin-thread-mirror.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Message, Store } from "./store.ts";

export interface CloudConnection extends CloudPort {
  query(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** Security: the session token rides every call but never the outbox, which stores only the call's own arguments. */
export function convexConnection(url: string, sessionToken: string): CloudConnection {
  const http = new ConvexHttpClient(url, { logger: false });
  let live: ConvexClient | null = null;
  const socket = () => (live ??= new ConvexClient(url, { logger: false, unsavedChangesWarning: false }));
  const withToken = (args: Record<string, unknown>) => ({ ...args, sessionToken });
  return {
    query: (name, args) => http.query(makeFunctionReference<"query">(name), withToken(args)),
    mutation: (name, args) => http.mutation(makeFunctionReference<"mutation">(name), withToken(args)),
    subscribe(name, args, onUpdate, onError) {
      const stop = socket().onUpdate(makeFunctionReference<"query">(name), withToken(args), onUpdate, onError ?? (() => undefined));
      return () => stop();
    },
    close() {
      void live?.close();
      live = null;
    },
  };
}

interface BotMeta {
  agentId: string;
  teamId: string;
  /** The cloud definition version this bot last matched, and the local definition's hash at that point. */
  version: number;
  hash: string;
  /** Threads opened after this moment are shared by default; older ones stay private. */
  boundAt: number;
  intent?: ModelIntent;
}

interface SharedState {
  bots: Record<string, BotMeta>;
  defaults: Record<string, ModelSelection>;
}

function readState(file: string): SharedState {
  try {
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Partial<SharedState> : {};
    return { bots: raw.bots && typeof raw.bots === "object" ? raw.bots : {}, defaults: raw.defaults && typeof raw.defaults === "object" ? raw.defaults : {} };
  } catch {
    return { bots: {}, defaults: {} };
  }
}

function writeState(file: string, state: SharedState): void {
  const partial = `${file}.${process.pid}.tmp`;
  writeFileSync(partial, JSON.stringify(state, null, 2));
  renameSync(partial, file);
}

export interface SharedAgentsDeps {
  store: Store;
  instances(): Promise<SelectableInstance[]>;
  selectionContext?: DefaultSelectionContext;
  isBusy(botId: string, threadId: string): boolean;
  /** Starts the turn for a run that waited and now holds its thread; `message` is the local line it answers. */
  startQueued(run: QueuedRun, message: Message | undefined): Promise<void>;
  interrupt(botId: string, threadId: string): void;
  redact(text: string): string;
  connect?: (url: string, sessionToken: string) => CloudConnection;
  files?: { cloud?: string; links?: string; state?: string; outbox?: string; bots?: string };
  validateHostedSelection?(botId: string, selection: ModelSelection, allowMetered: boolean): Promise<unknown>;
  nextHostedBackup?(request: HostedRequest, current: () => boolean): Promise<RequestBackup | null>;
  startHostedSender?(request: HostedRequest, target: RequestBackup): Promise<void>;
  locallyRunning?(threadId: string): boolean;
}

export type SendDecision = { status: "running"; sendId: string } | { status: "queued"; sendId: string; runId: string; teamId: string; cloudThreadId: string }
  | { status: "hosted"; sendId: string; message: Message };

const TICK_MS = 15_000;
const MENTIONS_PER_MESSAGE = 10;
const MENTION_REQUESTS_PER_MINUTE = 20;
const HOST_EVERY_MS = 10 * 60_000;
const ID = /^[a-z0-9]{1,64}$/;

const refusal = (status: number, error: string, code?: string) => Object.assign(new Error(error), { status, ...(code ? { code } : {}) });

/** Unseen-context caps: past them a resumed session would get a deferred summary, so the next turn replays history instead. */
export function remoteBacklogExceedsCaps(messages: readonly Pick<Message, "role" | "kind" | "text" | "remote">[]): boolean {
  let count = 0;
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.remote) {
      if (message.role === "bot" && message.kind === "text") break;
      continue;
    }
    if (message.kind !== "text") continue;
    count += 1;
    bytes += (message.text ?? "").length;
  }
  return count > UNSEEN_MAX_MESSAGES || bytes > UNSEEN_MAX_BYTES;
}

/** Origin no longer shares this agent or thread (sharing turned off, archived, access removed): the thread goes on locally. */
export function sharingWithdrawn(error: unknown): boolean {
  return /Shared agents are off|Agent not found|Thread not found|is archived|View-only access/.test(error instanceof Error ? error.message : String(error));
}

type MentionRefusal = { status: number; error: string };

/** The Origin call that tags teammates in this person's own line of a shared thread; Origin checks the tags and access. */
export function sharedThreadMention(
  store: Pick<Store, "taskByThread" | "messagesFor">, threads: Record<string, string>, botId: string, body: Record<string, unknown> | null,
): MentionRefusal | { threadId: string; clientId: string; userIds: string[] } {
  const threadId = typeof body?.threadId === "string" ? body.threadId : "";
  const sendId = typeof body?.sendId === "string" ? body.sendId : "";
  const userIds = Array.isArray(body?.userIds) ? [...new Set(body.userIds)] : [];
  if (!sendId || !userIds.length || userIds.length > MENTIONS_PER_MESSAGE || !userIds.every((id): id is string => typeof id === "string" && ID.test(id))) {
    return { status: 400, error: `sendId and 1 to ${MENTIONS_PER_MESSAGE} Origin user ids are required` };
  }
  if (!store.taskByThread(botId, threadId)) return { status: 404, error: "No such thread" };
  const cloudThreadId = threads[threadId];
  if (!cloudThreadId) return { status: 409, error: "Only people in a shared thread can be tagged" };
  const message = store.messagesFor(threadId).find((candidate) => candidate.sendId === sendId && candidate.role === "user" && !candidate.remote);
  if (!message) return { status: 404, error: "No such message" };
  return { threadId: cloudThreadId, clientId: clientIdFor(message), userIds };
}

export function createSharedAgents(deps: SharedAgentsDeps) {
  const { store } = deps;
  const files = {
    cloud: deps.files?.cloud ?? defaultOriginCloudFile(),
    links: deps.files?.links ?? defaultCloudLinksFile(),
    state: deps.files?.state ?? join(DATA_DIR, "origin-shared-agents.json"),
    outbox: deps.files?.outbox ?? join(DATA_DIR, "origin-outbox.sqlite"),
    bots: deps.files?.bots ?? join(DATA_DIR, "bots.json"),
  };
  const connect = deps.connect ?? convexConnection;
  let outbox: Outbox | null = null;
  let connection: { url: string; token: string; cloud: CloudConnection; me: { id: string; name: string } | null } | null = null;
  let lease: RunLease | null = null;
  let mirror: ReturnType<typeof createThreadMirror> | null = null;
  const watches = new Map<string, () => void>();
  let hostPublishedAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  const stops: Array<() => void> = [];
  const cancelledAdmissions = new Map<string, number>();
  let sharedStopped = false;
  const hostedRequests = createHostedRequests({
    file: join(dirname(files.state), "origin-hosted-requests.json"), store,
    scope: () => {
      const cloud = readOriginCloud(files.cloud);
      return connection?.me && cloud.url === connection.url && cloud.sessionToken === connection.token
        ? { origin: connection.url, userId: connection.me.id, identity: connection, port: connection.cloud } : null;
    },
    validate: (botId, selection, paid) => deps.validateHostedSelection?.(botId, selection, paid) ?? Promise.reject(new Error("Shared accounts are unavailable")),
    next: (request, current) => deps.nextHostedBackup?.(request, current) ?? Promise.resolve(null),
    handover: (threadId, runId) => lease?.handover(threadId, runId) ?? false,
    release: (threadId, publish, runId) => mirror?.release(threadId, publish, runId), redact: deps.redact,
    locallyRunning: deps.locallyRunning,
    startSender: async (request, target, current) => {
      if (!lease || !current() || !deps.startHostedSender) throw new Error("The local backup is unavailable");
      const message = store.messagesFor(request.threadId).find(message => message.id === request.messageId);
      if (!message?.text) throw new Error("The original shared message is missing");
      const result = await lease.begin({ botId: request.botId, threadId: request.threadId, cloudThreadId: request.cloudThreadId, teamId: request.teamId,
        clientId: request.clientId, text: deps.redact(message.text), engineLabel: target.selection.model });
      if (!current() || result.runId !== request.runId || result.status !== "running") throw new Error("The shared run changed before its local backup started");
      if (deps.locallyRunning?.(request.threadId)) throw new Error("A local turn is already running in this conversation");
      mirror?.hold(request.threadId, result.runId);
      store.setTaskActivity(request.botId, request.threadId, "idle");
      await deps.startHostedSender(request, target);
    },
  });

  const box = () => (outbox ??= openOutbox(files.outbox));
  const threads = () => readSharedLinks(files.links).threads;

  const flush = () => {
    if (!connection) return;
    const cloud = connection.cloud;
    void box().flush((name, args) => cloud.mutation(name, args), (op, error) => {
      console.warn(`origin shared: dropped ${op.name}: ${error instanceof Error ? error.message : String(error)}`);
    }).then(() => {
      if (box().pending().length) schedule(500);
    });
  };
  const schedule = (delay = 0) => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, delay);
  };

  const sharedBots = () => store.bots.filter((bot) => bot.shared);

  const bindThread = (botId: string, threadId: string, cloudThreadId: string) => {
    writeSharedLinks(files.links, { threads: { ...threads(), [threadId]: cloudThreadId } });
    store.patchTask(botId, threadId, { shared: { cloudThreadId } });
    mirror?.sync();
  };

  const unbindThread = (botId: string, threadId: string) => {
    const { [threadId]: _gone, ...rest } = threads();
    writeSharedLinks(files.links, { threads: rest });
    store.patchTask(botId, threadId, { shared: undefined });
    mirror?.sync();
  };

  const discover = (botId: string, rows: readonly { _id: string; title: string; clientId?: string }[]) => {
    const bot = store.bot(botId);
    if (!bot?.shared) return;
    const bound = new Set(Object.values(threads()));
    for (const row of rows) {
      if (bound.has(row._id)) continue;
      const own = row.clientId ? store.taskByThread(botId, row.clientId) : undefined;
      const task = own ?? store.createTask(botId, row.title, false, undefined, undefined, "ask");
      if (task) bindThread(botId, task.threadId, row._id);
    }
  };

  const syncWatches = () => {
    if (!connection || !lease) return;
    const cloud = connection.cloud;
    const wanted = new Map<string, () => () => void>();
    for (const bot of sharedBots()) {
      const shared = bot.shared!;
      wanted.set(`agent:${shared.agentId}:${bot.id}`, () => cloud.subscribe("agentThreads:list", { agentId: shared.agentId }, (value) => {
        discover(bot.id, value as { _id: string; title: string; clientId?: string }[]);
      }));
      wanted.set(`team:${shared.teamId}`, () => cloud.subscribe("agentRuns:pendingForMe", { teamId: shared.teamId }, (value) => {
        lease?.pending(shared.teamId, value as { runId: string; status: string }[]);
      }));
    }
    for (const [key, stop] of watches) {
      if (wanted.has(key)) continue;
      stop();
      watches.delete(key);
    }
    for (const [key, start] of wanted) if (!watches.has(key)) watches.set(key, start());
    mirror?.sync();
  };

  const disconnect = () => {
    for (const stop of watches.values()) stop();
    watches.clear();
    mirror?.stop();
    mirror = null;
    lease?.stop();
    lease = null;
    connection?.cloud.close();
    connection = null;
  };

  /** Follows the Origin session the bots use; a new account or sign-out starts over. */
  const ensureConnection = async () => {
    const { url, sessionToken } = readOriginCloud(files.cloud);
    if (!url || !sessionToken || !sharedBots().length) {
      if (connection) disconnect();
      return;
    }
    if (connection && connection.url === url && connection.token === sessionToken) return;
    disconnect();
    const cloud = connect(url, sessionToken);
    const me = await cloud.query("auth:me", {}).then((value) => {
      const user = value as { _id?: string; name?: string } | null;
      return user?._id ? { id: user._id, name: user.name ?? "" } : null;
    }, () => null);
    if (!me) {
      cloud.close();
      return;
    }
    connection = { url, token: sessionToken, cloud, me };
    lease = createRunLease({
      mutation: (name, args) => cloud.mutation(name, args),
      outbox: box(),
      kick: () => schedule(),
      isBusy: deps.isBusy,
      startQueued: async (run) => {
        const message = store.messagesFor(run.threadId).find((candidate) => candidate.id === run.messageId);
        if (message?.queued) store.patchMessage(run.threadId, message.id, { queued: undefined, queueId: undefined });
        await deps.startQueued(run, message);
      },
      interrupt: deps.interrupt,
      abandoned: (run) => {
        const message = store.messagesFor(run.threadId).find((candidate) => candidate.id === run.messageId);
        if (message?.queued) store.patchMessage(run.threadId, message.id, { queued: undefined, queueId: undefined });
        store.appendMessage(run.threadId, { role: "bot", kind: "activity", tool: { name: "This message did not run: its turn was cancelled or lapsed", ok: false } });
      },
    });
    mirror = createThreadMirror({
      store, outbox: box(), cloud, threads, runFor: (threadId) => lease?.runFor(threadId), me: () => connection?.me?.id ?? null,
      redact: deps.redact, kick: () => schedule(),
      onSnapshot: (threadId, snapshot) => {
        const me = connection?.me?.id;
        const bot = store.botByThread(threadId);
        if (!bot || deps.isBusy(bot.id, threadId) || snapshot.activeRun?.requesterUserId === me || snapshot.queued.some(run => run.requesterUserId === me)) return;
        for (const message of store.messagesFor(threadId)) if (message.role === "user" && message.requestPending && message.sendId && !message.queued) store.patchMessage(threadId, message.id, { requestPending: false });
      },
    });
    syncWatches();
    schedule();
  };

  const publishHost = async () => {
    if (!connection || Date.now() - hostPublishedAt < HOST_EVERY_MS) return;
    hostPublishedAt = Date.now();
    const ready = (await deps.instances().catch(() => [] as SelectableInstance[]))
      .filter((instance) => instance.enabled !== false && instance.snapshot.state === "available" && instance.snapshot.authenticated !== false);
    const engines = [...new Set(ready.map((instance) => instance.driverKind))];
    const models = [...new Set(ready.flatMap((instance) => [instance.models.default, ...instance.models.options.map((option) => option.id)]).filter(Boolean))].slice(0, 100);
    for (const teamId of new Set(sharedBots().map((bot) => bot.shared!.teamId))) {
      await connection.cloud.mutation("agents:publishHost", { teamId, name: hostname().slice(0, 80) || "Desktop", engines, models, computers: [] }).catch(() => undefined);
    }
  };

  const tick = async () => {
    await ensureConnection().catch(() => undefined);
    syncWatches();
    await hostedRequests.tick();
    await lease?.tick().catch(() => undefined);
    await publishHost().catch(() => undefined);
    schedule();
  };

  /** Called before a direct message is admitted. Null: the thread is not shared and runs as before. */
  const beforeSend = async (input: { botId: string; threadId: string; text: string; sendId?: string }): Promise<SendDecision | null> => {
    const admission = cancelledAdmissions.get(input.threadId) ?? 0;
    const admissionCloud = readOriginCloud(files.cloud);
    let admissionConnection: typeof connection | undefined;
    const admissionCurrent = () => {
      const cloud = readOriginCloud(files.cloud);
      return !sharedStopped && (cancelledAdmissions.get(input.threadId) ?? 0) === admission && cloud.url === admissionCloud.url &&
        cloud.sessionToken === admissionCloud.sessionToken && (admissionConnection === undefined || connection === admissionConnection);
    };
    const assertAdmission = () => { if (!admissionCurrent()) throw refusal(409, "This shared request was stopped before it could start"); };
    const bot = store.projectBotForTask(input.botId, input.threadId) ?? store.bot(input.botId);
    const shared = bot?.shared;
    const hosted = Boolean(bot?.modelSelection.source || bot?.modelSelection.instanceId === "origin-remote");
    if (hosted && !shared) throw refusal(409, "Choose a shared Origin conversation to use a teammate's model account", "model_host_shared_required");
    if (!bot || !shared) return null;
    if (shared.review) throw refusal(409, `${shared.review.by} changed ${bot.name}'s instructions. Review the change before sending.`, "shared_definition_review");
    const task = store.taskByThread(bot.id, input.threadId);
    if (!task) return null;
    let cloudThreadId = threads()[input.threadId];
    const meta = readState(files.state).bots[bot.id];
    const eligible = !cloudThreadId && !task.sharedPrivate && meta && task.createdAt >= meta.boundAt && !store.messagesFor(input.threadId).some((m) => m.role === "user");
    if (!cloudThreadId && !eligible) {
      if (hosted) throw refusal(409, "A private conversation cannot run on another person's model account", "model_host_private_thread");
      return null;
    }
    await ensureConnection();
    assertAdmission();
    if (!connection || !lease) throw refusal(503, "Origin is unreachable, so this shared thread can't take a message right now.", "shared_offline");
    admissionConnection = connection;
    if (!cloudThreadId) {
      try {
        cloudThreadId = await connection.cloud.mutation("agentThreads:create", { agentId: shared.agentId, title: task.title, clientId: input.threadId }) as string;
      } catch (error) {
        if (sharingWithdrawn(error)) return null;
        throw error;
      }
      assertAdmission();
      bindThread(bot.id, input.threadId, cloudThreadId);
    }
    const me = connection.me!.id;
    if (task.lastRunnerUserId !== me || remoteBacklogExceedsCaps(store.messagesFor(input.threadId))) {
      const replay = remoteBacklogExceedsCaps(store.messagesFor(input.threadId));
      store.patchTask(bot.id, input.threadId, { lastRunnerUserId: me, ...(replay ? { resumeCursors: {} } : {}) });
    }
    const sendId = input.sendId ?? randomUUID();
    if (hosted) {
      if (!deps.validateHostedSelection || !bot.modelSelection.source) throw refusal(409, "Teammate model hosting is unavailable on this server");
      if (/<attached-(?:image|file|audio)\b/i.test(input.text)) throw refusal(409, "Teammate-hosted chats currently accept text only; local attachments cannot be forwarded as another computer's file paths");
      const selected = structuredClone(bot.modelSelection), hostConnection = connection;
      await deps.validateHostedSelection(bot.id, selected, true);
      assertAdmission();
      const live = store.projectBotForTask(bot.id, input.threadId) ?? store.bot(bot.id), cloud = readOriginCloud(files.cloud);
      if (connection !== hostConnection || cloud.sessionToken !== hostConnection.token || cloud.url !== hostConnection.url ||
          JSON.stringify(live?.modelSelection) !== JSON.stringify(selected)) throw refusal(409, "The account or model choice changed before the shared request was sent");
      const message = store.appendMessage(input.threadId, { role: "user", kind: "text", text: input.text, sendId, requestPending: true, queued: true,
        sender: { name: hostConnection.me!.name, id: `origin:${me}` } });
      try {
        await hostedRequests.begin({ botId: bot.id, threadId: input.threadId, cloudThreadId, teamId: shared.teamId, clientId: `send:${sendId}`, message, selection: selected, current: admissionCurrent });
      } catch {
        if (!hostedRequests.owns(input.threadId)) store.patchMessage(input.threadId, message.id, { requestPending: false, queued: undefined });
        throw refusal(503, "Origin could not confirm this shared execution. Check the shared conversation before sending the work again.", "model_host_begin_unconfirmed");
      }
      return { status: "hosted", sendId, message };
    }
    let begun: Awaited<ReturnType<RunLease["begin"]>>;
    try {
      begun = await lease.begin({
        botId: bot.id, threadId: input.threadId, cloudThreadId, teamId: shared.teamId, text: input.text, clientId: `send:${sendId}`,
        engineLabel: (task.modelSelection ?? bot.modelSelection).model || undefined,
      });
    } catch (error) {
      if (!sharingWithdrawn(error)) throw error;
      unbindThread(bot.id, input.threadId);
      return null;
    }
    if (!admissionCurrent()) {
      await connection.cloud.mutation("agentRuns:cancel", { runId: begun.runId }).catch(() => undefined);
      lease.handover(input.threadId, begun.runId);
      assertAdmission();
    }
    if (begun.status === "running" && bot.quotaFallback && bot.fallback?.some(selection => selection.source)) mirror?.hold(input.threadId, begun.runId);
    return begun.status === "running"
      ? { status: "running", sendId }
      : { status: "queued", sendId, runId: begun.runId, teamId: shared.teamId, cloudThreadId };
  };

  const plan = async () => {
    const state = readState(files.state);
    const instances = await deps.instances();
    const bots = sharedBots().map((bot) => {
      const intent = state.bots[bot.id]?.intent ?? null;
      const { selection, via } = resolveSharedModel(instances, intent, state.defaults, deps.selectionContext);
      const instance = instances.find((candidate) => candidate.instanceId === selection.instanceId);
      const label = instance?.models.options.find((option) => option.id === selection.model)?.label ?? selection.model;
      return { botId: bot.id, name: bot.name, intent, resolved: selection.instanceId ? { instanceId: selection.instanceId, model: selection.model, label } : null, via };
    });
    return { defaults: state.defaults, bots };
  };

  const mentionTimes: number[] = [];
  const mentionRefusal = (botId: string, body: Record<string, unknown> | null): MentionRefusal | null => {
    const op = sharedThreadMention(store, threads(), botId, body);
    if ("error" in op) return op;
    const now = Date.now();
    while (mentionTimes.length && now - mentionTimes[0]! > 60_000) mentionTimes.shift();
    if (mentionTimes.length >= MENTION_REQUESTS_PER_MINUTE) return { status: 429, error: "Too many mentions. Try again in a minute." };
    mentionTimes.push(now);
    box().enqueue("notifications:agentThreadMentions", op);
    schedule();
    return null;
  };

  const routes: RouteHandler = async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/origin/shared-agents") && !/^\/api\/bots\/[\w-]+\/(shared-review|shared-private|mentions)$/.test(path)) return PASS;
    if (method === "GET" && path === "/api/origin/shared-agents") {
      const state = readState(files.state);
      return json(res, 200, { bots: Object.fromEntries(Object.entries(state.bots).filter(([id]) => store.bot(id))) });
    }
    if (method === "GET" && path === "/api/origin/shared-agents/plan") return json(res, 200, await plan());
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Changing shared agents needs the admin scope" });
    const body = (await readBody(req).catch(() => null)) as Record<string, unknown> | null;
    if (method === "PUT" && path === "/api/origin/shared-agents/defaults") {
      const defaults = body?.defaults;
      if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) return json(res, 400, { error: "defaults must be an object" });
      const clean: Record<string, ModelSelection> = {};
      for (const [provider, value] of Object.entries(defaults as Record<string, unknown>)) {
        const selection = value as Partial<ModelSelection> | null;
        if (!selection || typeof selection.instanceId !== "string" || typeof selection.model !== "string") continue;
        clean[provider.slice(0, 64)] = { instanceId: selection.instanceId, model: selection.model, ...(typeof selection.effort === "string" ? { effort: selection.effort as ModelSelection["effort"] } : {}) };
      }
      writeState(files.state, { ...readState(files.state), defaults: clean });
      return json(res, 200, await plan());
    }
    if (method === "POST" && path === "/api/origin/shared-agents/snapshot") {
      const target = files.bots.replace(/bots\.json$/, "bots.pre-share.json");
      const created = existsSync(files.bots) && !existsSync(target);
      if (created) copyFileSync(files.bots, target);
      return json(res, 200, { created });
    }
    if (method === "PUT" && path === "/api/origin/shared-agents/bind") {
      const botId = typeof body?.botId === "string" ? body.botId : "";
      const bot = store.bot(botId);
      if (!bot) return json(res, 404, { error: "No such bot" });
      const state = readState(files.state);
      const links = readSharedLinks(files.links);
      if (body?.agentId === null) {
        delete state.bots[botId];
        delete links.agents[botId];
        const owned = new Set((bot.tasks ?? []).map((task) => task.threadId));
        const kept = Object.fromEntries(Object.entries(links.threads).filter(([threadId]) => !owned.has(threadId)));
        writeSharedLinks(files.links, { agents: links.agents, threads: kept });
        writeState(files.state, state);
        for (const task of bot.tasks ?? []) if (task.shared) store.patchTask(botId, task.threadId, { shared: undefined });
        store.patchBot(botId, { shared: undefined });
        await tick();
        return json(res, 200, { ok: true });
      }
      const agentId = body?.agentId;
      const teamId = body?.teamId;
      if (typeof agentId !== "string" || !ID.test(agentId) || typeof teamId !== "string" || !ID.test(teamId)) {
        return json(res, 400, { error: "agentId and teamId must be Origin ids" });
      }
      const version = typeof body?.version === "number" ? body.version : 1;
      const intent = body?.intent && typeof body.intent === "object" ? body.intent as ModelIntent : undefined;
      const previous = state.bots[botId];
      state.bots[botId] = {
        agentId, teamId, version, hash: typeof body?.hash === "string" ? body.hash : definitionHash(definitionOf(bot)),
        boundAt: previous?.agentId === agentId ? previous.boundAt : Date.now(), ...(intent ? { intent } : {}),
      };
      writeState(files.state, state);
      writeSharedLinks(files.links, { agents: { ...Object.fromEntries(Object.entries(links.agents).filter(([, id]) => id !== agentId)), [botId]: agentId } });
      const link: SharedBotLink = { agentId, teamId, canEdit: body?.canEdit === true, ...(bot.shared?.review ? { review: bot.shared.review } : {}) };
      store.patchBot(botId, { shared: link });
      if (body?.adoptModel === true && !bot.modelSelection.source && bot.modelSelection.instanceId !== "origin-remote") {
        const { selection, via } = resolveSharedModel(await deps.instances(), intent, state.defaults, deps.selectionContext);
        if (via !== "none") store.applyModelDefault(botId, selection);
      }
      await tick();
      return json(res, 200, { ok: true, boundAt: state.bots[botId].boundAt });
    }
    if (method === "PUT" && path === "/api/origin/shared-agents/review") {
      const bot = store.bot(typeof body?.botId === "string" ? body.botId : "");
      if (!bot?.shared) return json(res, 404, { error: "No such shared bot" });
      const { version, by, soul } = body ?? {};
      if (typeof version !== "number" || typeof by !== "string" || typeof soul !== "string") return json(res, 400, { error: "version, by and soul are required" });
      store.patchBot(bot.id, { shared: { ...bot.shared, review: { version, by: by.slice(0, 120), soul } } });
      return json(res, 200, { ok: true });
    }
    const review = /^\/api\/bots\/([\w-]+)\/shared-review$/.exec(path);
    if (review && method === "POST") {
      const bot = store.bot(review[1]);
      const pending = bot?.shared?.review;
      if (!bot || !pending) return json(res, 404, { error: "Nothing to review" });
      if (body?.accept === true) store.patchBotProfile(bot.id, { soul: pending.soul });
      const updated = store.bot(bot.id)!;
      const state = readState(files.state);
      if (state.bots[bot.id]) {
        state.bots[bot.id] = { ...state.bots[bot.id], version: pending.version, hash: definitionHash(definitionOf(updated)) };
        writeState(files.state, state);
      }
      const { review: _done, ...link } = updated.shared!;
      store.patchBot(bot.id, { shared: link });
      return json(res, 200, { ok: true });
    }
    const mention = /^\/api\/bots\/([\w-]+)\/mentions$/.exec(path);
    if (mention && method === "POST") {
      const refused = mentionRefusal(mention[1]!, body);
      if (refused) return json(res, refused.status, { error: refused.error });
      return json(res, 202, { ok: true });
    }
    const privacy = /^\/api\/bots\/([\w-]+)\/shared-private$/.exec(path);
    if (privacy && method === "PUT") {
      const threadId = typeof body?.threadId === "string" ? body.threadId : "";
      const task = store.taskByThread(privacy[1], threadId);
      if (!task) return json(res, 404, { error: "No such thread" });
      if (task.shared) return json(res, 409, { error: "This thread is already shared" });
      store.patchTask(privacy[1], threadId, { sharedPrivate: body?.private === true ? true : undefined });
      return json(res, 200, { ok: true });
    }
    if (method === "PUT" && path === "/api/origin/shared-agents/meta") {
      const botId = typeof body?.botId === "string" ? body.botId : "";
      const state = readState(files.state);
      if (!state.bots[botId]) return json(res, 404, { error: "No such shared bot" });
      if (typeof body?.version === "number") state.bots[botId].version = body.version;
      if (typeof body?.hash === "string") state.bots[botId].hash = body.hash;
      if (body?.intent && typeof body.intent === "object") state.bots[botId].intent = body.intent as ModelIntent;
      writeState(files.state, state);
      const bot = store.bot(botId);
      if (bot?.shared && typeof body?.canEdit === "boolean" && bot.shared.canEdit !== body.canEdit) store.patchBot(botId, { shared: { ...bot.shared, canEdit: body.canEdit } });
      return json(res, 200, { ok: true });
    }
    return PASS;
  };

  return {
    routes,
    beforeSend,
    async transferToHost(input: { botId: string; threadId: string; messageId: string; selection: ModelSelection; visited: string[]; blockedAccounts: string[]; current(): boolean }) {
      const bot = store.bot(input.botId), message = store.messagesFor(input.threadId).find(message => message.id === input.messageId);
      const runId = lease?.runFor(input.threadId), cloudThreadId = threads()[input.threadId];
      if (!bot?.shared || !message?.sendId || !runId || !lease?.holds(input.threadId) || !cloudThreadId) return false;
      return hostedRequests.offer({ ...input, cloudThreadId, teamId: bot.shared.teamId, clientId: clientIdFor(message), runId });
    },
    releaseHandoff(threadId: string, publish = true): void { const runId = lease?.runFor(threadId); if (runId) mirror?.release(threadId, publish, runId); },
    cancelHosted(botId: string, threadId: string) {
      cancelledAdmissions.set(threadId, (cancelledAdmissions.get(threadId) ?? 0) + 1);
      return hostedRequests.cancelThread(botId, threadId);
    },
    /** A queued send: remember the local line so the run can start it once it holds the thread. */
    queued(run: QueuedRun): void {
      lease?.remember(run);
    },
    /** The local turn for a running shared send failed to start. */
    failed(threadId: string): void {
      lease?.failed(threadId);
    },
    start(): void {
      stops.push(store.onChange((change) => {
        if (change.type === "bot") lease?.observe(change.botId);
      }));
      tickTimer = setInterval(() => void tick(), TICK_MS);
      tickTimer.unref?.();
      void tick();
    },
    stop(): void {
      sharedStopped = true;
      cancelledAdmissions.clear();
      hostedRequests.stop();
      if (tickTimer) clearInterval(tickTimer);
      if (flushTimer) clearTimeout(flushTimer);
      for (const stop of stops.splice(0)) stop();
      disconnect();
      outbox?.close();
      outbox = null;
    },
    tick,
  };
}

export type SharedAgents = ReturnType<typeof createSharedAgents>;
