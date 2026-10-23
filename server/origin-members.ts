import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { releases } from "../shared/origin-releases.ts";
import { DATA_DIR } from "./config.ts";
import { CallAgentError, MAX_AUDIO_BYTES, type CallAgents, type CallAgentScope } from "./origin-call-agent.ts";
import { agentUserId, type ChatAgent } from "./origin-chat-agent.ts";
import { convexRealtimeBackend, localRealtimeBackend, type RealtimeBackend, type TokenCall } from "./origin-realtime-backend.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient, type OriginTeamChat } from "./origin-cloud.ts";
import {
  openRealtimeStore, RealtimeError, CallSessionChangedError,
  type CallSignalKind, type ChatMention, type Conversation, type ChatReference, type ChatScope, type MentionNotice, type RealtimeStore, type WorkspaceUser,
} from "./origin-realtime-store.ts";
import { convexSiteUrl } from "./origin-public-pages.ts";
import { PASS, type RouteContext, type RouteHandler } from "./routes/table.ts";

type Args = Record<string, unknown>;

export const MAX_CHAT_FILE_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = MAX_CHAT_FILE_BYTES + 1024 * 1024;
const MAX_JSON_BYTES = 128_000;
const ACCESS_TTL_MS = 15_000;
const TURN_CREDENTIAL_TTL_S = 3600;
const FILE_ID = /^[a-f0-9-]{36}$/;
const CONVEX_ID = /^[a-z0-9]{10,64}$/;
const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

class AccessError extends Error {}

export interface TurnConfig { host?: string; secret?: string }

export interface OriginMemberRouteDeps {
  store?: () => RealtimeStore;
  convex?: () => OriginCloudClient | null;
  filesDir?: string;
  turn?: () => TurnConfig;
  notifyMentions?: ((notice: MentionNotice) => Promise<void>) | null;
  callAgents?: CallAgents | null;
  chatAgent?: ChatAgent | null;
  /** Where chat and call signalling live; defaults to the connected Origin deployment, else this app's own store. */
  backend?: () => RealtimeBackend;
  now?: () => number;
}

const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function turnIceServers(turn: TurnConfig, userId: string, nowMs: number): { urls: string | string[]; username?: string; credential?: string }[] {
  const host = turn.host?.trim();
  if (!host) return [];
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [{ urls: `stun:${host}:3478` }];
  if (turn.secret) {
    // coturn's use-auth-secret (TURN REST API): username is "<expiry>:<id>", credential is base64 HMAC-SHA1 of it.
    const username = `${Math.floor(nowMs / 1000) + TURN_CREDENTIAL_TTL_S}:${userId}`;
    const credential = createHmac("sha1", turn.secret).update(username).digest("base64");
    servers.push({ urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username, credential });
  }
  return servers;
}

export function originSessionToken(req: IncomingMessage, body?: Args): string {
  const header = req.headers["x-origin-session"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
  if (bearer && !bearer.startsWith("omb_sess_")) return bearer;
  return text(body?.sessionToken);
}

export function connectedConvexUrl(): string | null {
  return readOriginCloud(defaultOriginCloudFile()).url ?? (process.env.ORIGIN_CONVEX_URL?.trim() || null);
}

let cachedConvex: { url: string; client: OriginCloudClient } | null = null;
export function connectedConvex(): OriginCloudClient | null {
  const url = connectedConvexUrl();
  if (!url) return null;
  if (cachedConvex?.url !== url) cachedConvex = { url, client: convexOriginClient(url) };
  return cachedConvex.client;
}

export function convexMentionNotifier(env: NodeJS.ProcessEnv = process.env, convexUrl: () => string | null = connectedConvexUrl): ((notice: MentionNotice) => Promise<void>) | null {
  const secret = env.ORIGIN_INTEGRATION_SECRET;
  if (!secret || secret.length < 32) return null;
  return async (notice) => {
    const url = convexUrl();
    const site = env.ORIGIN_CONVEX_SITE_URL?.trim().replace(/\/+$/, "") || (url ? convexSiteUrl(url) : null);
    if (!site) throw new Error("Origin is not connected");
    const body = JSON.stringify({ at: Date.now(), operation: "chatMentions", args: notice });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const response = await fetch(`${site}/integrations`, { method: "POST", body, headers: { "content-type": "application/json", "x-origin-signature": signature }, signal: AbortSignal.timeout(15_000) });
    if (response.status === 400) {
      console.warn("Origin refused a chat mention notice; dropping it");
      return;
    }
    if (!response.ok) throw new Error(`Origin notification failed (${response.status})`);
  };
}

export async function readBounded(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer;
    size += part.length;
    if (size <= max) chunks.push(part);
  }
  return size > max ? null : Buffer.concat(chunks);
}

export function parseConversation(value: string): Conversation | null {
  return value === "" || /^dm:[a-z0-9]{1,64}:[a-z0-9]{1,64}$/.test(value) || /^project:[a-z0-9]{10,64}$/.test(value) ? value as Conversation : null;
}

function convexMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /Uncaught Error: ([^\n]+)/.exec(message)?.[1]?.trim() ?? "";
}

let sharedStore: RealtimeStore | null = null;
/** The app's one realtime store, shared by the member routes and the agents' team chat tools. */
export function appRealtimeStore(): RealtimeStore {
  return sharedStore ??= openRealtimeStore(join(DATA_DIR, "origin-realtime.sqlite"));
}

const appFiles = (dir: string) => ({
  id: () => randomUUID(),
  write(id: string, data: Uint8Array) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id), data, { flag: "wx", mode: 0o600 });
  },
  read: (id: string) => new Uint8Array(readFileSync(join(dir, id))),
});

/** Team chat and calls on the connected Origin deployment, shared by every member's app; this app's own store when none is connected. */
export function appRealtimeBackend(store: () => RealtimeStore = appRealtimeStore, filesDir = join(DATA_DIR, "origin-chat-files")): () => RealtimeBackend {
  const local = localRealtimeBackend(store, appFiles(filesDir));
  let shared: { client: OriginCloudClient; backend: RealtimeBackend } | null = null;
  return () => {
    const client = connectedConvex();
    if (!client) return local;
    if (shared?.client !== client) shared = { client, backend: convexRealtimeBackend(() => client) };
    return shared.backend;
  };
}

/** A project's team chat for the Origin agent tools, read and written with the app's Origin sign-in; an agent posts under its own name, never the person's. */
export function originTeamChat(backend: () => RealtimeBackend = appRealtimeBackend(), token: () => string = () => readOriginCloud(defaultOriginCloudFile()).sessionToken ?? ""): OriginTeamChat {
  const scope = (teamId: string, projectId: string) => ({
    user: { userId: "", name: "", email: "", teamId, role: "member" }, conversation: `project:${projectId}` as const, token: token(),
  });
  const line = (message: { id: string; authorName: string; body: string; createdAt: number }) =>
    ({ id: message.id, authorName: message.authorName, body: message.body, createdAt: message.createdAt });
  return {
    recent: async (teamId, projectId, limit) => (await backend().messages(scope(teamId, projectId), {})).slice(-limit).map(line),
    post: async (teamId, projectId, agent, body) => line(await backend().send(scope(teamId, projectId), body, { asAgent: agent })),
  };
}

export function createOriginMemberRoutes(deps: OriginMemberRouteDeps = {}): RouteHandler {
  const now = deps.now ?? Date.now;
  const filesDir = deps.filesDir ?? join(DATA_DIR, "origin-chat-files");
  let opened: RealtimeStore | null = null;
  const store = deps.store ?? (deps.now ? () => (opened ??= openRealtimeStore(join(DATA_DIR, "origin-realtime.sqlite"), now)) : appRealtimeStore);
  const convexFor = deps.convex ?? connectedConvex;
  const backend = deps.backend ?? (deps.store || deps.now ? (() => { const local = localRealtimeBackend(store, appFiles(filesDir)); return () => local; })() : appRealtimeBackend(store, filesDir));
  const turn = deps.turn ?? (() => ({ host: process.env.ORIGIN_TURN_HOST, secret: process.env.ORIGIN_TURN_SECRET }));
  const notifyMentions = deps.notifyMentions === undefined ? convexMentionNotifier() : deps.notifyMentions;
  const accessCache = new Map<string, { value: unknown; expires: number }>();

  const convex = () => {
    const client = convexFor();
    if (!client) throw new AccessError("Origin is not connected on this app");
    return client;
  };

  const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = accessCache.get(key);
    if (hit && hit.expires > now()) return hit.value as T;
    const value = await load();
    if (accessCache.size > 500) for (const [entry, item] of accessCache) if (item.expires <= now()) accessCache.delete(entry);
    accessCache.set(key, { value, expires: now() + ACCESS_TTL_MS });
    return value;
  };

  const workspaceUser = async (token: string, teamId: string): Promise<WorkspaceUser> => {
    if (!token) throw new AccessError("Sign in to Origin first");
    if (!CONVEX_ID.test(teamId)) throw new AccessError("Workspace required");
    return cached(`user\n${token}\n${teamId}`, async () => {
      const client = convex();
      try {
        const [me, access] = await Promise.all([
          client.query("auth:me", { sessionToken: token }).then(record),
          client.query("workspaces:access", { sessionToken: token, teamId }).then(record),
        ]);
        if (!text(me._id) || text(access.teamId) !== teamId) throw new AccessError("Workspace access required");
        return {
          userId: text(me._id), name: text(me.name) || text(me.email), ...(text(me.username) ? { username: text(me.username) } : {}),
          email: text(me.email), avatarUrl: typeof me.avatarUrl === "string" ? me.avatarUrl : null, teamId, role: text(access.role) || "viewer",
        };
      } catch (error) {
        if (error instanceof AccessError) throw error;
        throw new AccessError("Workspace access required");
      }
    });
  };

  const project = async (token: string, teamId: string, projectId: string): Promise<{ name: string; memberRole: string }> => {
    if (!CONVEX_ID.test(projectId)) throw new RealtimeError("Project not found");
    return cached(`project\n${token}\n${teamId}\n${projectId}`, async () => {
      const found = record(await convex().query("projects:get", { sessionToken: token, projectId }).catch(() => null));
      if (text(found.teamId) !== teamId) throw new RealtimeError("Project not found");
      return { name: text(found.name), memberRole: text(found.memberRole) };
    });
  };

  const members = async (token: string, teamId: string) =>
    (await convex().query("workspaces:members", { sessionToken: token, teamId }) as unknown[]).map(record);

  const scopeInput = (ctx: RouteContext, body?: Args) => ({
    token: originSessionToken(ctx.req, body),
    teamId: ctx.url.searchParams.get("teamId") ?? text(body?.teamId),
  });

  const callScope = async (ctx: RouteContext, body?: Args): Promise<TokenCall> => {
    const { token, teamId } = scopeInput(ctx, body);
    let user = await workspaceUser(token, teamId);
    const room = ctx.url.searchParams.get("room") ?? text(body?.room);
    if (room && (await project(token, teamId, room)).memberRole === "viewer") user = { ...user, role: "viewer" };
    return { user, room, token };
  };

  const chatScope = async (ctx: RouteContext, body?: Args): Promise<ChatScope & { token: string }> => {
    const { token, teamId } = scopeInput(ctx, body);
    let user = await workspaceUser(token, teamId);
    const conversation = parseConversation(ctx.url.searchParams.get("conversation") ?? "");
    if (conversation === null) throw new RealtimeError("Conversation not found");
    if (conversation.startsWith("project:")) {
      if ((await project(token, teamId, conversation.slice("project:".length))).memberRole === "viewer") user = { ...user, role: "viewer" };
    }
    else if (conversation && !(await backend().directConversationMember(token, user, conversation))) throw new RealtimeError("Conversation not found");
    return { user, conversation, token };
  };

  let flushingMentions = false;
  const flushMentions = async () => {
    if (!notifyMentions || flushingMentions) return;
    flushingMentions = true;
    try {
      for (let batch = store().pendingMentions(); batch.length; batch = store().pendingMentions()) {
        for (const { id, notice } of batch) {
          await notifyMentions(notice);
          store().mentionDelivered(id);
        }
      }
    } finally {
      flushingMentions = false;
    }
  };

  const fail = (ctx: RouteContext, error: unknown) => {
    if (error instanceof AccessError) return ctx.json(ctx.res, 401, { error: error.message });
    if (error instanceof CallSessionChangedError) return ctx.json(ctx.res, 409, { error: error.message });
    if (error instanceof RealtimeError || error instanceof CallAgentError) return ctx.json(ctx.res, 400, { error: error.message });
    const status = Number((error as { status?: unknown })?.status);
    if (status === 413) return ctx.json(ctx.res, 413, { error: "Request too large" });
    return ctx.json(ctx.res, 400, { error: convexMessage(error) || "Request failed" });
  };

  const callAgents = deps.callAgents ?? null;
  if (callAgents) {
    const present = async (scope: CallAgentScope) => (await backend().participants({
      user: { userId: scope.user.userId, name: scope.user.name, email: "", teamId: scope.teamId, role: "member" }, room: scope.room, token: scope.token ?? "",
    })).map((participant) => participant.userId);
    setInterval(() => void callAgents.sweep(present).catch(() => undefined), 10_000).unref();
  }

  const callAgent = async (agents: CallAgents, ctx: RouteContext, route: string) => {
    const { req, res, method, json, url, auth } = ctx;
    const body = route === "agent" && method === "POST" ? record(await ctx.readBody(req, MAX_JSON_BYTES)) : undefined;
    const scope = await callScope(ctx, body);
    if (method === "POST" && scope.user.role === "viewer") throw new RealtimeError("View-only workspace access");
    const name = scope.room ? (await project(originSessionToken(req, body), scope.user.teamId, scope.room)).name : "Workspace";
    const agentScope: CallAgentScope = { teamId: scope.user.teamId, room: scope.room, name, user: scope.user, token: scope.token };
    const present = async () => (await backend().participants(scope)).map((participant) => participant.userId);
    if (route === "agent" && method === "GET") return json(res, 200, await agents.state(agentScope, Number(url.searchParams.get("after")) || 0));
    if (route === "agent-audio" && method === "POST") {
      const audio = await readBounded(req, MAX_AUDIO_BYTES);
      if (!audio) throw Object.assign(new Error("too large"), { status: 413 });
      return json(res, 200, await agents.audio(agentScope, auth, new Uint8Array(audio), url.searchParams.get("mime") ?? "", await present()));
    }
    if (route !== "agent" || method !== "POST" || !body) return PASS;
    if (body.action === "join") return json(res, 200, { agent: await agents.join(agentScope, auth, text(body.botId), await present(), scope.room ? [name] : []) });
    if (body.action === "leave") return json(res, 200, await agents.leave(agentScope, await present()));
    if (body.action === "keep") return json(res, 200, await agents.keep(agentScope, body.keep === true, await present()));
    if (body.action === "line") return json(res, 200, await agents.line(agentScope, auth, text(body.text).slice(0, 2_000), await present()));
    throw new RealtimeError("Unknown call agent action");
  };

  const voice = async (ctx: RouteContext, route: string) => {
    const { req, res, method, json } = ctx;
    res.setHeader("cache-control", "no-store");
    if (route === "agent" || route === "agent-audio") return callAgents ? callAgent(callAgents, ctx, route) : PASS;
    if (route === "config" && method === "GET") {
      const scope = await callScope(ctx);
      return json(res, 200, { iceServers: turnIceServers(turn(), scope.user.userId, now()) });
    }
    if (route === "participants" && method === "GET") return json(res, 200, { participants: await backend().participants(await callScope(ctx)) });
    if (route === "participants" && method === "POST") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const scope = await callScope(ctx, body);
      if (body.action === "leave") {
        await backend().leave(scope, text(body.sessionId));
        return json(res, 200, { ok: true });
      }
      const media = { audioEnabled: body.audioEnabled === true, videoEnabled: body.videoEnabled === true, screenSharing: body.screenSharing === true };
      if (body.action !== "join" && body.action !== "update") throw new RealtimeError("Unknown call action");
      const participant = body.action === "update" ? await backend().heartbeat(scope, media, text(body.sessionId)) : await backend().join(scope, media);
      return json(res, 200, { userId: participant.userId, joinedAt: participant.joinedAt, sessionId: participant.sessionId });
    }
    if (route === "signals" && method === "GET") return json(res, 200, { signals: await backend().signals(await callScope(ctx), ctx.url.searchParams.get("sessionId") ?? undefined) });
    if (route === "signals" && method === "POST") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const scope = await callScope(ctx, body);
      if (!text(body.toUserId) || !text(body.kind)) throw new RealtimeError("Signal target and kind required");
      const signal = await backend().sendSignal(scope, text(body.toUserId), text(body.kind) as CallSignalKind, text(body.payload), {
        fromJoinedAt: typeof body.fromJoinedAt === "number" ? body.fromJoinedAt : undefined,
        toJoinedAt: typeof body.toJoinedAt === "number" ? body.toJoinedAt : undefined,
        sessionId: text(body.sessionId), toSessionId: text(body.toSessionId),
      });
      return json(res, 200, { signal });
    }
    if (route === "signals" && method === "DELETE") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const scope = await callScope(ctx, body);
      await backend().ackSignals(scope, Array.isArray(body.signalIds) ? body.signalIds.filter((id): id is string => typeof id === "string") : [], text(body.sessionId));
      return json(res, 200, { ok: true });
    }
    return PASS;
  };

  const resolveReferences = async (scope: ChatScope & { token: string }, raw: unknown, team: Args[], notify: string[]): Promise<ChatReference[]> => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 12) throw new RealtimeError("Too many references");
    return Promise.all(raw.map(async (value) => {
      const reference = record(value);
      const projectId = text(reference.projectId);
      const found = await project(scope.token, scope.user.teamId, projectId);
      if (reference.type === "project") return { type: "project" as const, projectId, id: projectId, label: found.name };
      if (reference.type !== "issue") throw new RealtimeError("Unknown reference");
      const task = record(record(await convex().query("tasks:details", { sessionToken: scope.token, projectId, taskId: text(reference.id) })).task);
      const assignee = team.find((member) => text(member.email) && member.email === task.assignedToEmail);
      if (text(assignee?.userId)) notify.push(text(assignee?.userId));
      return { type: "issue" as const, projectId, id: text(task._id), label: text(task.title) };
    }));
  };

  const chat = async (ctx: RouteContext, route: string) => {
    const { req, res, method, json, url } = ctx;
    res.setHeader("cache-control", "no-store");
    if (route === "conversations" && method === "GET") {
      const { token, teamId } = scopeInput(ctx);
      return json(res, 200, { conversations: await backend().directConversations(token, await workspaceUser(token, teamId)) });
    }
    if (route === "conversations" && method === "POST") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const { token, teamId } = scopeInput(ctx, body);
      const user = await workspaceUser(token, teamId);
      const recipientId = text(body.recipientId);
      if (!recipientId || !(await members(token, teamId)).some((member) => member.userId === recipientId)) throw new RealtimeError("Choose a member of this workspace");
      return json(res, 200, { conversationId: await backend().openDirectConversation(token, user, recipientId) });
    }
    if (route === "conversations" && method === "PATCH") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const scope = await chatScope(ctx, body);
      if (!text(body.messageId)) throw new RealtimeError("Message required");
      await backend().markRead(scope, text(body.messageId));
      return json(res, 200, { ok: true });
    }
    if (route === "messages" && method === "GET") {
      const scope = await chatScope(ctx);
      const search = url.searchParams.get("search");
      const focus = url.searchParams.get("focus");
      const before = Number(url.searchParams.get("before")) || undefined;
      const messages = await backend().messages(scope, { ...(before ? { before } : {}), ...(search ? { search } : {}), ...(focus ? { focus } : {}) });
      const projectId = scope.conversation.startsWith("project:") ? scope.conversation.slice("project:".length) : "";
      const agent = projectId && deps.chatAgent ? deps.chatAgent.agent(ctx.auth, projectId) : null;
      const thinking = agent ? deps.chatAgent!.thinking(scope) : null;
      return json(res, 200, { messages, hasMore: messages.length === 100, ...(agent ? { agent: { id: agent.id, name: agent.name, userId: agentUserId(agent.id) } } : {}), ...(thinking ? { thinking } : {}) });
    }
    if (route === "messages" && method === "POST") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const scope = await chatScope(ctx, body);
      const mentionIds = body.mentionUserIds;
      if (mentionIds !== undefined && (!Array.isArray(mentionIds) || mentionIds.length > 20)) throw new RealtimeError("Too many mentions");
      const team = await members(scope.token, scope.user.teamId);
      if (scope.conversation.startsWith("dm:") && !scope.conversation.slice(3).split(":").every((id) => team.some((member) => member.userId === id))) {
        throw new RealtimeError("This member is no longer in the workspace");
      }
      const participants = scope.conversation.startsWith("dm:") ? scope.conversation.slice(3).split(":") : null;
      const mentions: ChatMention[] = [...new Set((mentionIds ?? []) as unknown[])].map((id) => {
        const member = team.find((candidate) => candidate.userId === id);
        if (!member || !text(member.userId)) throw new RealtimeError("Mention must belong to this workspace");
        if (participants && !participants.includes(text(member.userId))) throw new RealtimeError("Only people in this conversation can be mentioned");
        return { userId: text(member.userId), name: text(member.username) || text(member.name) };
      });
      if (mentions.length) store().limit(`chat-mention:${scope.user.teamId}:${scope.user.userId}`, 20, 60_000);
      const notifyUserIds: string[] = [];
      const references = await resolveReferences(scope, body.references, team, notifyUserIds);
      const message = await backend().send(scope, text(body.body), {
        attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.filter((id): id is string => typeof id === "string") : [],
        references, mentions, notifyUserIds, ...(text(body.replyTo) ? { replyTo: text(body.replyTo) } : {}),
      });
      void flushMentions().catch(() => console.warn("Origin chat mention delivery deferred"));
      if (deps.chatAgent && scope.conversation.startsWith("project:")) {
        const projectId = scope.conversation.slice("project:".length);
        const { name } = await project(scope.token, scope.user.teamId, projectId);
        deps.chatAgent.heard({ backend: backend(), scope, auth: ctx.auth, projectId, projectName: name || "this project", message });
      }
      return json(res, 200, { message });
    }
    if (route === "messages" && method === "PATCH") {
      const body = record(await ctx.readBody(req, MAX_JSON_BYTES));
      const scope = await chatScope(ctx, body);
      return json(res, 200, { message: await backend().edit(scope, text(body.id), body) });
    }
    if (route === "files" && method === "POST") {
      const scope = await chatScope(ctx);
      if (scope.user.role === "viewer") throw new RealtimeError("View-only workspace access");
      const projectId = url.searchParams.get("projectId");
      if (projectId && (await project(scope.token, scope.user.teamId, projectId)).memberRole === "viewer") throw new RealtimeError("Edit role required");
      store().limit(`upload:${scope.user.userId}`, 30, 60_000);
      if (Number(req.headers["content-length"]) > MAX_UPLOAD_BODY_BYTES) throw Object.assign(new Error("too large"), { status: 413 });
      const bytes = await readBounded(req, MAX_UPLOAD_BODY_BYTES);
      if (!bytes) throw Object.assign(new Error("too large"), { status: 413 });
      const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": String(req.headers["content-type"] ?? "") } }).formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File) || file.size === 0 || file.size > MAX_CHAT_FILE_BYTES) throw new RealtimeError("Choose a file between 1 byte and 15 MB");
      const metadata = await backend().uploadFile(scope, {
        name: file.name, contentType: file.type || "application/octet-stream", data: new Uint8Array(await file.arrayBuffer()), ...(projectId ? { projectId } : {}),
      });
      return json(res, 200, { file: metadata });
    }
    if (route === "files" && method === "GET") {
      let data: Uint8Array;
      let file: { name: string; contentType: string };
      try {
        const scope = await chatScope(ctx);
        const id = url.searchParams.get("id") ?? "";
        if (!FILE_ID.test(id)) throw new RealtimeError("File not found");
        const found = await backend().file(scope, id);
        if (found.file.projectId) await project(scope.token, scope.user.teamId, found.file.projectId);
        else await convex().query("tasks:authorizeLocalFile", { sessionToken: scope.token, teamId: scope.user.teamId, fileId: id });
        data = found.data;
        file = found.file;
      } catch {
        return json(res, 404, { error: "File not found or access denied" });
      }
      const image = INLINE_IMAGE.test(file.contentType);
      res.writeHead(200, {
        "content-type": image ? file.contentType : "application/octet-stream",
        "content-disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(data);
      return;
    }
    return PASS;
  };

  return async (ctx) => {
    const { path, method, res, json } = ctx;
    if (path === "/api/releases" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, releases);
    }
    const match = /^\/api\/local-(voice|chat)\/(config|participants|signals|agent|agent-audio|conversations|messages|files)$/.exec(path);
    if (!match) return PASS;
    try {
      return await (match[1] === "voice" ? voice(ctx, match[2]!) : chat(ctx, match[2]!));
    } catch (error) {
      return fail(ctx, error);
    }
  };
}
