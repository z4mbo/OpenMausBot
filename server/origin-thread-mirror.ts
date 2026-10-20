import type { SharedThreadLink } from "../shared/wire.ts";
import type { Outbox } from "./origin-outbox.ts";
import type { Message, Store, StoreChange } from "./store.ts";

export type CloudKind = "text" | "activity" | "options" | "digest" | "compaction" | "widget" | "routine.run" | "placeholder";
export type CloudTool = { name: string; ok?: boolean; summary?: string; input?: string; output?: string };

export interface OutboundRow {
  clientId: string;
  role: "user" | "bot";
  kind: CloudKind;
  text?: string;
  tool?: CloudTool;
  payload?: string;
}

export interface CloudRow extends OutboundRow {
  _id: string;
  seq: number;
  updSeq: number;
  authorUserId?: string;
  authorName?: string;
  runId?: string;
  runBy?: string;
  runByUserId?: string;
  engineLabel?: string;
  executedByUserId?: string;
  executedByName?: string;
  hostId?: string;
  sourceId?: string;
  status: "streaming" | "final" | "interrupted";
  createdAt: number;
}

export interface CloudRun { runId: string; requesterUserId: string; requesterName: string; status: string; engineLabel?: string; executedByName?: string; hostId?: string; sourceId?: string }

export interface ThreadSnapshot {
  seq: number;
  title: string;
  archived: boolean;
  messages: CloudRow[];
  more: boolean;
  activeRun: CloudRun | null;
  queued: CloudRun[];
}

export type RemoteInput = Parameters<Store["applyRemoteMessage"]>[1];

/** Security: a card mirrored from another member's run is answered on their machine only. */
export const REMOTE_CARD = "remote:";
export const REMOTE_CARD_REFUSAL = "Only the person whose message raised this card can answer it";

const TOOL_FIELD_MAX = 2_000;
const PAYLOAD_MAX = 16_000;
const TEXT_MAX = 60_000;
const PRIVATE_KINDS = new Set<Message["kind"]>(["secret", "signin", "screen", "connector", "call", "goal.run"]);

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export function clientIdFor(message: Pick<Message, "id" | "role" | "sendId">): string {
  return message.role === "user" && message.sendId ? `send:${message.sendId}` : `m:${message.id}`;
}

function payloadOf(value: unknown, redact: (text: string) => string): string | undefined {
  if (value === undefined) return undefined;
  const text = redact(JSON.stringify(value));
  return text.length <= PAYLOAD_MAX ? text : undefined;
}

/** What of a local row leaves this machine. Secrets, sign-ins, screens and other private steps go as a placeholder only. */
export function toCloudRow(message: Message, redact: (text: string) => string): OutboundRow | null {
  if (message.remote || message.queued) return null;
  const base = { clientId: clientIdFor(message), role: message.role } as const;
  if (PRIVATE_KINDS.has(message.kind)) return { ...base, role: "bot", kind: "placeholder", text: "A private step" };
  switch (message.kind) {
    case "text":
      return message.text === undefined ? null : { ...base, kind: "text", text: clip(redact(message.text), TEXT_MAX) };
    case "activity": {
      if (!message.tool) return null;
      const tool: CloudTool = { name: clip(message.tool.name, 200) };
      if (message.tool.ok !== undefined) tool.ok = message.tool.ok;
      if (message.tool.summary) tool.summary = clip(redact(message.tool.summary), TOOL_FIELD_MAX);
      if (message.tool.input) tool.input = clip(redact(message.tool.input), TOOL_FIELD_MAX);
      if (message.tool.output) tool.output = clip(redact(message.tool.output), TOOL_FIELD_MAX);
      return { ...base, kind: "activity", tool };
    }
    case "options": {
      if (!message.card) return null;
      const { title, subtitle, options, requestType, answered, answeredText, expired, tool } = message.card;
      return { ...base, kind: "options", text: redact(title), payload: payloadOf({ title, subtitle, options, requestType, answered, answeredText, expired, tool }, redact) };
    }
    case "digest":
      return message.digest ? { ...base, kind: "digest", text: redact(message.digest.reply), payload: payloadOf(message.digest, redact) } : null;
    case "compaction":
      return message.compaction ? { ...base, kind: "compaction", text: clip(redact(message.compaction.summary), TEXT_MAX) } : null;
    case "widget":
      return { ...base, kind: "widget", text: clip(redact(message.text ?? ""), TEXT_MAX), payload: payloadOf(message.widget, redact) };
    case "routine.run":
      return message.routineRun ? { ...base, kind: "routine.run", text: redact(message.routineRun.routineName), payload: payloadOf(message.routineRun, redact) } : null;
    default:
      return null;
  }
}

function parsed<T>(payload: string | undefined): T | undefined {
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as T;
  } catch {
    return undefined;
  }
}

/** A cloud row as this machine shows it. Compaction rows stay out: each machine folds its own context. */
export function fromCloudRow(row: CloudRow, local: { botId: string; threadId: string }): RemoteInput | null {
  const name = (row.role === "user" ? row.authorName : row.executedByName ?? row.runBy) ?? "Someone";
  const userId = row.role === "user" ? row.authorUserId : row.executedByUserId ?? row.runByUserId;
  const remote: RemoteInput["remote"] = {
    cloudId: row._id, name, ...(userId ? { userId } : {}), ...(row.runId ? { runId: row.runId } : {}),
    ...(row.engineLabel ? { model: row.engineLabel } : {}), status: row.status,
  };
  const at = row.createdAt;
  switch (row.kind) {
    case "text":
      return row.role === "user"
        ? { role: "user", kind: "text", text: row.text ?? "", sender: { name, ...(userId ? { id: `origin:${userId}` } : {}) }, remote, at }
        : { role: "bot", kind: "text", text: row.text ?? "", remote, at };
    case "activity":
      return row.tool ? { role: "bot", kind: "activity", tool: row.tool, remote, at } : null;
    case "placeholder":
      return { role: "bot", kind: "activity", tool: { name: `${row.text ?? "A private step"} on ${name}'s computer`, ok: true }, remote, at };
    case "options": {
      const card = parsed<{ title?: string; subtitle?: string; options?: string[]; requestType?: "permission" | "question"; answered?: string; answeredText?: string; expired?: boolean; tool?: string }>(row.payload);
      return {
        role: "bot", kind: "options", remote, at,
        card: {
          title: card?.title ?? row.text ?? "", subtitle: card?.subtitle ?? "", options: card?.options ?? [], requestId: `${REMOTE_CARD}${row._id}`,
          ...(card?.requestType ? { requestType: card.requestType } : {}), ...(card?.answered ? { answered: card.answered } : {}),
          ...(card?.answeredText ? { answeredText: card.answeredText } : {}), ...(card?.expired ? { expired: true } : {}), ...(card?.tool ? { tool: card.tool } : {}),
        },
      };
    }
    case "digest": {
      const digest = parsed<NonNullable<Message["digest"]>>(row.payload);
      return digest ? { role: "bot", kind: "digest", digest: { ...digest, botId: local.botId, threadId: local.threadId }, remote, at } : null;
    }
    case "widget": {
      const widget = parsed<NonNullable<Message["widget"]>>(row.payload);
      return widget ? { role: "bot", kind: "widget", text: row.text, widget, remote, at } : { role: "bot", kind: "text", text: row.text ?? "", remote, at };
    }
    case "routine.run": {
      const routineRun = parsed<NonNullable<Message["routineRun"]>>(row.payload);
      return routineRun ? { role: "bot", kind: "routine.run", routineRun, remote, at } : null;
    }
    default:
      return null;
  }
}

/** A row this machine wrote itself comes back from the subscription too; it is already here. */
export function ownRow(row: Pick<CloudRow, "clientId">, local: readonly Pick<Message, "id" | "sendId" | "remote">[]): boolean {
  if (row.clientId.startsWith("m:")) {
    const id = row.clientId.slice(2);
    return local.some((message) => message.id === id && !message.remote);
  }
  if (row.clientId.startsWith("send:")) {
    const sendId = row.clientId.slice(5);
    return local.some((message) => message.sendId === sendId && !message.remote);
  }
  return false;
}

export function threadLinkFrom(cloudThreadId: string, snapshot: Pick<ThreadSnapshot, "activeRun" | "queued">, me: string | null): SharedThreadLink {
  const run = snapshot.activeRun;
  const mineQueued = snapshot.queued.filter((queued) => queued.requesterUserId === me).length;
  return {
    cloudThreadId,
    ...(run ? { run: { by: run.requesterName, mine: run.requesterUserId === me, ...(run.engineLabel ? { model: run.engineLabel } : {}),
      ...(run.executedByName ? { executedByName: run.executedByName } : {}), ...(run.hostId ? { hostId: run.hostId } : {}), ...(run.sourceId ? { sourceId: run.sourceId } : {}) } } : {}),
    ...(snapshot.queued.length ? { queued: snapshot.queued.length } : {}),
    ...(mineQueued ? { mineQueued } : {}),
  };
}

export interface CloudPort {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  subscribe(name: string, args: Record<string, unknown>, onUpdate: (value: unknown) => void, onError?: (error: Error) => void): () => void;
}

export interface MirrorDeps {
  store: Pick<Store, "onChange" | "messagesFor" | "applyRemoteMessage" | "patchTask" | "taskByThread" | "botByThread">;
  outbox: Pick<Outbox, "enqueue" | "cursor" | "setCursor">;
  cloud: CloudPort;
  /** Local thread id -> cloud thread id, for every bound thread. */
  threads(): Record<string, string>;
  /** The run of mine that may write this thread's bot rows now. */
  runFor(threadId: string): string | undefined;
  me(): string | null;
  redact(text: string): string;
  /** Asks for a flush after a write was queued. */
  kick(): void;
  onSnapshot?(threadId: string, snapshot: ThreadSnapshot): void;
}

const PATCH_COALESCE_MS = 400;

/** Mirrors bound threads both ways: this machine's rows go out through the outbox; other members' rows come in live. */
export function createThreadMirror(deps: MirrorDeps) {
  const mirrored = new Map<string, { clientId: string; cloudThreadId: string }>();
  const subscriptions = new Map<string, { cloudThreadId: string; afterSeq: number; stop: () => void }>();
  const held = new Map<string, { key?: string; rows: StoreChange[]; bytes: number }>();

  const publish = (change: StoreChange) => {
    if (change.type !== "message" && change.type !== "message.patch") return;
    const cloudThreadId = deps.threads()[change.threadId];
    if (!cloudThreadId || change.message.remote) return;
    if (change.type === "message.patch") {
      const known = mirrored.get(change.message.id);
      const row = known ? toCloudRow(change.message, deps.redact) : null;
      if (!known || !row) return;
      deps.outbox.enqueue("agentRuns:patchMessage", {
        threadId: known.cloudThreadId, clientId: known.clientId,
        ...(row.text !== undefined ? { text: row.text } : {}), ...(row.tool ? { tool: row.tool } : {}), ...(row.payload !== undefined ? { payload: row.payload } : {}),
      }, { key: `patch:${known.clientId}`, delayMs: PATCH_COALESCE_MS });
      deps.kick();
      return;
    }
    const row = toCloudRow(change.message, deps.redact);
    if (!row) return;
    const runId = row.role === "bot" ? deps.runFor(change.threadId) : undefined;
    if (row.role === "bot" && !runId) return;
    mirrored.set(change.message.id, { clientId: row.clientId, cloudThreadId });
    deps.outbox.enqueue("agentRuns:appendMessage", { threadId: cloudThreadId, ...row, ...(runId ? { runId } : {}) });
    deps.kick();
  };

  const apply = (threadId: string, cloudThreadId: string, snapshot: ThreadSnapshot) => {
    const bot = deps.store.botByThread(threadId);
    if (!bot) return;
    const local = deps.store.messagesFor(threadId);
    let cursor = deps.outbox.cursor(threadId);
    for (const row of snapshot.messages) {
      cursor = Math.max(cursor, row.updSeq);
      if (ownRow(row, local)) continue;
      const input = fromCloudRow(row, { botId: bot.id, threadId });
      if (input) deps.store.applyRemoteMessage(threadId, input);
    }
    deps.outbox.setCursor(threadId, cursor);
    const link = threadLinkFrom(cloudThreadId, snapshot, deps.me());
    const task = deps.store.taskByThread(bot.id, threadId);
    if (task && JSON.stringify(task.shared) !== JSON.stringify(link)) deps.store.patchTask(bot.id, threadId, { shared: link });
    deps.onSnapshot?.(threadId, snapshot);
    const current = subscriptions.get(threadId);
    if (current && cursor > current.afterSeq) watch(threadId, cloudThreadId, cursor);
  };

  const watch = (threadId: string, cloudThreadId: string, afterSeq: number) => {
    subscriptions.get(threadId)?.stop();
    const entry = { cloudThreadId, afterSeq, stop: () => {} };
    subscriptions.set(threadId, entry);
    entry.stop = deps.cloud.subscribe("agentThreads:messagesSince", { threadId: cloudThreadId, afterSeq }, (value) => {
      if (subscriptions.get(threadId) !== entry) return;
      apply(threadId, cloudThreadId, value as ThreadSnapshot);
    });
  };

  /** Starts watching newly bound threads and stops watching unbound ones. */
  const sync = () => {
    const bound = deps.threads();
    for (const [threadId, entry] of subscriptions) {
      if (bound[threadId] === entry.cloudThreadId) continue;
      entry.stop();
      subscriptions.delete(threadId);
    }
    for (const [threadId, cloudThreadId] of Object.entries(bound)) {
      if (!subscriptions.has(threadId)) watch(threadId, cloudThreadId, deps.outbox.cursor(threadId));
    }
  };

  const release = (threadId: string, send: boolean, key?: string): void => {
    const entry = held.get(threadId);
    if (!entry || key !== undefined && entry.key !== key) return;
    held.delete(threadId);
    if (send) for (const row of entry.rows) publish(row);
  };
  const unsubscribe = deps.store.onChange(change => {
    const entry = (change.type === "message" || change.type === "message.patch") && change.message.role === "bot" && !change.message.remote ? held.get(change.threadId) : undefined;
    if (!entry || (change.type !== "message" && change.type !== "message.patch")) { publish(change); return; }
    entry.rows.push(structuredClone(change)); entry.bytes += Buffer.byteLength(JSON.stringify(change.message));
    if (entry.rows.length > 20 || entry.bytes > 64 * 1024) release(change.threadId, true, entry.key);
  });
  return {
    sync,
    hold(threadId: string, key?: string): void {
      if (held.get(threadId)?.key === key && held.has(threadId)) return;
      held.set(threadId, { key, rows: [], bytes: 0 });
    },
    release,
    stop() {
      held.clear();
      unsubscribe();
      for (const entry of subscriptions.values()) entry.stop();
      subscriptions.clear();
    },
  };
}
