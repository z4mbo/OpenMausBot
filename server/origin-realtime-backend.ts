import { CallAgentError, type CallAgentScope, type CallRoomPort, type CaptionLine, type SharedCallAgent } from "./origin-call-agent.ts";
import type { OriginCloudClient } from "./origin-cloud.ts";
import {
  RealtimeError, CallSessionChangedError,
  type CallParticipant, type CallScope, type CallSignal, type CallSignalKind, type ChatAttachment, type ChatMention, type ChatMessage, type ChatReference,
  type ChatScope, type Conversation, type DirectConversation, type RealtimeStore, type WorkspaceUser,
} from "./origin-realtime-store.ts";

type Media = { audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean };
type SendExtras = { attachmentIds?: string[]; references?: ChatReference[]; replyTo?: string; mentions?: ChatMention[]; notifyUserIds?: string[]; asAgent?: { id: string; name: string } };
type Change = { body?: unknown; reaction?: unknown; pinned?: unknown; delete?: unknown };
export type TokenChat = ChatScope & { token: string };
export type TokenCall = CallScope & { token: string };

/** Where a workspace's team chat and call signalling live: Convex, so every member's app sees the same conversation. */
export interface RealtimeBackend {
  messages(scope: TokenChat, query: { before?: number; search?: string; focus?: string }): Promise<ChatMessage[]>;
  send(scope: TokenChat, body: string, extras?: SendExtras): Promise<ChatMessage>;
  edit(scope: TokenChat, id: string, change: Change): Promise<ChatMessage | null>;
  markRead(scope: TokenChat, messageId: string): Promise<void>;
  openDirectConversation(token: string, user: WorkspaceUser, recipientId: string): Promise<Conversation>;
  directConversations(token: string, user: WorkspaceUser): Promise<DirectConversation[]>;
  directConversationMember(token: string, user: WorkspaceUser, conversation: string): Promise<boolean>;
  uploadFile(scope: TokenChat, file: { name: string; contentType: string; data: Uint8Array; projectId?: string }): Promise<ChatAttachment>;
  file(scope: TokenChat, id: string): Promise<{ file: ChatAttachment; data: Uint8Array }>;
  participants(scope: TokenCall): Promise<CallParticipant[]>;
  join(scope: TokenCall, media: Media): Promise<CallParticipant>;
  heartbeat(scope: TokenCall, media: Media, sessionId: string): Promise<CallParticipant>;
  leave(scope: TokenCall, sessionId: string): Promise<void>;
  sendSignal(scope: TokenCall, toUserId: string, kind: CallSignalKind, payload: string, session: { fromJoinedAt?: number; toJoinedAt?: number; sessionId?: string; toSessionId?: string }): Promise<CallSignal | null>;
  signals(scope: TokenCall, sessionId?: string): Promise<CallSignal[]>;
  ackSignals(scope: TokenCall, ids: readonly string[], sessionId?: string): Promise<void>;
}

/** The app's own store, for an app with no Origin deployment and for tests. Only people using this app see it. */
export function localRealtimeBackend(store: () => RealtimeStore, files: { write(id: string, data: Uint8Array): void; read(id: string): Uint8Array; id(): string }): RealtimeBackend {
  return {
    messages: async (scope, query) => query.search ? store().search(scope, query.search, query.before) : query.focus ? store().context(scope, query.focus) : store().messages(scope, query.before),
    send: async (scope, body, extras = {}) => {
      if (!extras.asAgent) return store().send(scope, body, extras);
      return store().send({ ...scope, user: { userId: `agent:${extras.asAgent.id.replace(/^agent:/, "")}`, name: extras.asAgent.name, email: "", teamId: scope.user.teamId, role: "member" } }, body, extras.replyTo ? { replyTo: extras.replyTo } : {});
    },
    edit: async (scope, id, change) => store().edit(scope, id, change),
    markRead: async (scope, messageId) => store().markRead(scope, messageId),
    openDirectConversation: async (_token, user, recipientId) => store().openDirectConversation(user, recipientId),
    directConversations: async (_token, user) => store().directConversations(user),
    directConversationMember: async (_token, user, conversation) => store().directConversationMember(user, conversation),
    uploadFile: async (scope, input) => {
      const file: ChatAttachment = { id: files.id(), name: input.name.slice(0, 200), contentType: input.contentType || "application/octet-stream", size: input.data.byteLength, ...(input.projectId ? { projectId: input.projectId } : {}) };
      files.write(file.id, input.data);
      store().registerFile(scope, file);
      return file;
    },
    file: async (scope, id) => ({ file: store().file(scope, id), data: files.read(id) }),
    participants: async (scope) => store().participants(scope),
    join: async (scope, media) => store().join(scope, media),
    heartbeat: async (scope, media, sessionId) => store().heartbeat(scope, media, sessionId),
    leave: async (scope, sessionId) => store().leave(scope, sessionId),
    sendSignal: async (scope, toUserId, kind, payload, session) => store().sendSignal(scope, toUserId, kind, payload, session),
    signals: async (scope, sessionId) => store().signals(scope, sessionId),
    ackSignals: async (scope, ids, sessionId) => store().ackSignals(scope, ids, sessionId),
  };
}

const errorText = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (/Uncaught Error: ([^\n]+)/.exec(message)?.[1] ?? message).trim();
};

/** Convex's refusals become the same errors the app's own store throws, so the routes answer the same way. */
async function convex<T>(call: () => Promise<unknown>): Promise<T> {
  try {
    return await call() as T;
  } catch (error) {
    const message = errorText(error);
    if (message === "Rejoin the call to continue") throw new CallSessionChangedError();
    throw new RealtimeError(message || "Request failed");
  }
}

export function convexRealtimeBackend(client: () => OriginCloudClient, fetcher: typeof fetch = fetch): RealtimeBackend {
  const chat = (scope: TokenChat) => ({ sessionToken: scope.token, teamId: scope.user.teamId, conversation: scope.conversation });
  const call = (scope: TokenCall) => ({ sessionToken: scope.token, teamId: scope.user.teamId, room: scope.room });
  return {
    messages: (scope, query) => convex(() => client().query("realtime:messages", {
      ...chat(scope), ...(query.before ? { before: query.before } : {}), ...(query.search ? { search: query.search } : {}), ...(query.focus ? { focus: query.focus } : {}),
    })),
    send: (scope, body, extras = {}) => convex(() => client().mutation("realtime:send", {
      ...chat(scope), body,
      ...(extras.attachmentIds?.length ? { attachmentIds: extras.attachmentIds } : {}), ...(extras.references?.length ? { references: extras.references } : {}),
      ...(extras.mentions?.length ? { mentions: extras.mentions } : {}), ...(extras.notifyUserIds?.length ? { notifyUserIds: extras.notifyUserIds } : {}),
      ...(extras.replyTo ? { replyTo: extras.replyTo } : {}),
      ...(extras.asAgent ? { asAgent: { id: `agent:${extras.asAgent.id.replace(/^agent:/, "")}`, name: extras.asAgent.name } } : {}),
    })),
    edit: (scope, id, change) => convex(() => client().mutation("realtime:edit", {
      ...chat(scope), id,
      ...(typeof change.body === "string" ? { body: change.body } : {}), ...(typeof change.reaction === "string" ? { reaction: change.reaction } : {}),
      ...(typeof change.pinned === "boolean" ? { pinned: change.pinned } : {}), ...(change.delete === true ? { delete: true } : {}),
    })),
    markRead: async (scope, messageId) => { await convex(() => client().mutation("realtime:markRead", { ...chat(scope), messageId })); },
    openDirectConversation: (token, user, recipientId) => convex(() => client().mutation("realtime:openDirect", { sessionToken: token, teamId: user.teamId, recipientId })),
    directConversations: (token, user) => convex(() => client().query("realtime:directConversations", { sessionToken: token, teamId: user.teamId })),
    directConversationMember: async (token, user, conversation) =>
      (await convex<DirectConversation[]>(() => client().query("realtime:directConversations", { sessionToken: token, teamId: user.teamId }))).some((entry) => entry.id === conversation),
    uploadFile: async (scope, input) => {
      const url = await convex<string>(() => client().mutation("realtime:generateFileUploadUrl", chat(scope)));
      const response = await fetcher(url, { method: "POST", headers: { "content-type": input.contentType || "application/octet-stream" }, body: new Uint8Array(input.data) });
      if (!response.ok) throw new RealtimeError("Could not store the file");
      const { storageId } = await response.json() as { storageId: string };
      return convex(() => client().mutation("realtime:registerFile", {
        ...chat(scope), storageId, name: input.name, contentType: input.contentType || "application/octet-stream", ...(input.projectId ? { projectId: input.projectId } : {}),
      }));
    },
    file: async (scope, id) => {
      const found = await convex<{ file: ChatAttachment; url: string | null }>(() => client().query("realtime:fileUrl", { ...chat(scope), id }));
      if (!found.url) throw new RealtimeError("File not found");
      const response = await fetcher(found.url);
      if (!response.ok) throw new RealtimeError("File not found");
      return { file: found.file, data: new Uint8Array(await response.arrayBuffer()) };
    },
    participants: (scope) => convex(() => client().query("realtime:participants", call(scope))),
    join: (scope, media) => convex(() => client().mutation("realtime:presence", { ...call(scope), action: "join", ...media })),
    heartbeat: (scope, media, sessionId) => convex(() => client().mutation("realtime:presence", { ...call(scope), action: "update", sessionId, ...media })),
    leave: async (scope, sessionId) => { await convex(() => client().mutation("realtime:leave", { ...call(scope), sessionId })); },
    sendSignal: (scope, toUserId, kind, payload, session) => convex(() => client().mutation("realtime:sendSignal", {
      ...call(scope), toUserId, kind, payload,
      ...(session.sessionId ? { sessionId: session.sessionId } : {}), ...(session.toSessionId ? { toSessionId: session.toSessionId } : {}),
      ...(session.fromJoinedAt !== undefined ? { fromJoinedAt: session.fromJoinedAt } : {}), ...(session.toJoinedAt !== undefined ? { toJoinedAt: session.toJoinedAt } : {}),
    })),
    signals: (scope, sessionId) => convex(() => client().query("realtime:signals", { ...call(scope), ...(sessionId ? { sessionId } : {}) })),
    ackSignals: async (scope, ids, sessionId) => { await convex(() => client().mutation("realtime:ackSignals", { ...call(scope), signalIds: [...ids], ...(sessionId ? { sessionId } : {}) })); },
  };
}

/** A call's agent and captions on Convex, read and written with the person's own sign-in. */
export function convexCallRooms(client: () => OriginCloudClient | null): CallRoomPort {
  const args = (scope: CallAgentScope) => {
    if (!scope.token) throw new CallAgentError("Sign in to Origin first");
    return { sessionToken: scope.token, teamId: scope.teamId, room: scope.room };
  };
  const connected = () => client() ?? (() => { throw new CallAgentError("Origin is not connected on this app"); })();
  const call = async <T>(work: () => Promise<unknown>): Promise<T> => {
    try {
      return await work() as T;
    } catch (error) {
      throw new CallAgentError(errorText(error) || "Origin did not answer");
    }
  };
  return {
    async read(scope, after) {
      const found = await call<{ agent: { payload: string; updatedAt: number } | null; lines: { lineId: number; payload: string }[] }>(() => connected().query("realtime:callAgent", { ...args(scope), after }));
      return {
        agent: found.agent ? { state: JSON.parse(found.agent.payload) as SharedCallAgent, updatedAt: found.agent.updatedAt } : null,
        lines: found.lines.map((line) => ({ ...JSON.parse(line.payload) as Omit<CaptionLine, "id">, id: line.lineId })),
      };
    },
    set: (scope, state, expected) => call(() => connected().mutation("realtime:setCallAgent", {
      ...args(scope), payload: state ? JSON.stringify(state) : null, ...(expected !== undefined ? { expected } : {}),
    })),
    async add(scope, line) {
      const at = Date.now();
      const draft = { ...line, at };
      const { lineId } = await call<{ lineId: number }>(() => connected().mutation("realtime:addCallLine", { ...args(scope), payload: JSON.stringify(draft) }));
      return { ...draft, id: lineId };
    },
  };
}
