import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getActiveTeamMember, projectMember } from "./lib/permissions";
import { requireUser } from "./lib/auth";

type Ctx = QueryCtx | MutationCtx;
type Role = "owner" | "admin" | "member" | "viewer";

type ChatAttachment = { id: string; name: string; size: number; contentType: string; projectId?: string };
type ChatReference = { type: "project" | "issue"; id: string; projectId: string; label: string };
type ChatMention = { userId: string; name: string };
type ChatMessage = {
  id: string; authorUserId: string; authorName: string; authorEmail: string; avatarUrl?: string | null;
  body: string; createdAt: number; editedAt?: number; replyTo?: string; pinned?: boolean;
  attachments?: ChatAttachment[]; references?: ChatReference[]; mentions?: ChatMention[]; reactions?: Record<string, string[]>;
};
type CallParticipant = {
  userId: string; name: string; username?: string; email: string; avatarUrl?: string | null;
  audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean; joinedAt: number; lastSeenAt: number; sessionId: string;
};
type CallSignal = { id: string; fromUserId: string; toUserId: string; fromJoinedAt?: number; toJoinedAt?: number; fromSessionId: string; toSessionId: string; kind: string; payload: string; createdAt: number };

const PAGE = 100;
const BODY_MAX = 8_000;
const CHAT_REACTIONS = ["like", "heart", "celebrate", "eyes"];
const CALL_ROOM_LIMIT = 8;
const PARTICIPANT_TTL_MS = 30_000;
const SIGNAL_TTL_MS = 120_000;
const CALL_LINES_MAX = 3_000;
const AGENT_ID = /^agent:[A-Za-z0-9_-]{1,80}$/;

const uuid = () => crypto.randomUUID();
const parse = <T>(payload: string) => JSON.parse(payload) as T;

type Viewer = { userId: string; name: string; username?: string; email: string; avatarUrl: string | null; role: Role; user: Doc<"users"> };

async function viewer(ctx: Ctx, teamId: Id<"teams">, sessionToken: string): Promise<Viewer> {
  const user = await requireUser(ctx, sessionToken);
  const member = await getActiveTeamMember(ctx, teamId, user.email);
  if (!member || (member.userId && member.userId !== user._id)) throw new Error("Workspace access required");
  return {
    userId: user._id, name: user.name || user.email, ...(user.username ? { username: user.username } : {}), email: user.email,
    avatarUrl: user.avatarStorageId ? await ctx.storage.getUrl(user.avatarStorageId) : null, role: member.role as Role, user,
  };
}

/** The person's role in this conversation; throws when they may not see it. */
async function conversationAccess(ctx: Ctx, teamId: Id<"teams">, conversation: string, sessionToken: string): Promise<Viewer> {
  const me = await viewer(ctx, teamId, sessionToken);
  const project = /^project:([a-z0-9]{10,64})$/.exec(conversation);
  if (project) {
    const projectId = ctx.db.normalizeId("projects", project[1]!);
    const doc = projectId ? await ctx.db.get(projectId) : null;
    if (!doc || doc.teamId !== teamId) throw new Error("Conversation not found");
    const member = await projectMember(ctx, doc, me.user);
    if (!member) throw new Error("Conversation not found");
    return member.role === "viewer" ? { ...me, role: "viewer" } : me;
  }
  if (conversation === "") return me;
  if (!/^dm:[a-z0-9]{1,64}:[a-z0-9]{1,64}$/.test(conversation) || !conversation.slice(3).split(":").includes(me.userId)) throw new Error("Conversation not found");
  const direct = await ctx.db.query("teamDirectConversations").withIndex("by_team_conversation", (q) => q.eq("teamId", teamId).eq("conversation", conversation)).unique();
  if (!direct) throw new Error("Conversation not found");
  return me;
}

async function roomAccess(ctx: Ctx, teamId: Id<"teams">, room: string, sessionToken: string): Promise<Viewer> {
  return room ? conversationAccess(ctx, teamId, `project:${room}`, sessionToken) : viewer(ctx, teamId, sessionToken);
}

const requireWriter = (me: Viewer) => {
  if (me.role === "viewer") throw new Error("View-only workspace access");
};

async function messageRow(ctx: Ctx, teamId: Id<"teams">, conversation: string, id: string) {
  const row = await ctx.db.query("teamChatMessages").withIndex("by_team_conversation_message", (q) => q.eq("teamId", teamId).eq("conversation", conversation).eq("messageId", id)).unique();
  if (!row) throw new Error("Message not found");
  return row;
}

const scopeArgs = { sessionToken: v.string(), teamId: v.id("teams"), conversation: v.string() };

export const messages = query({
  args: { ...scopeArgs, before: v.optional(v.number()), search: v.optional(v.string()), focus: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken);
    let before = args.before ?? Number.MAX_SAFE_INTEGER;
    if (args.focus) before = parse<ChatMessage>((await messageRow(ctx, args.teamId, args.conversation, args.focus)).payload).createdAt + 1;
    const rows = ctx.db.query("teamChatMessages").withIndex("by_team_conversation_created", (q) => q.eq("teamId", args.teamId).eq("conversation", args.conversation).lt("created", before)).order("desc");
    const search = args.search?.trim().slice(0, 160).toLowerCase();
    const out: ChatMessage[] = [];
    if (search) {
      for await (const row of rows) {
        const message = parse<ChatMessage>(row.payload);
        if (message.body.toLowerCase().includes(search)) out.push(message);
        if (out.length >= PAGE) break;
      }
    } else {
      for (const row of await rows.take(PAGE)) out.push(parse<ChatMessage>(row.payload));
    }
    return out.reverse();
  },
});

export const send = mutation({
  args: {
    ...scopeArgs, body: v.string(), attachmentIds: v.optional(v.array(v.string())), replyTo: v.optional(v.string()),
    references: v.optional(v.array(v.object({ type: v.union(v.literal("project"), v.literal("issue")), id: v.string(), projectId: v.string(), label: v.string() }))),
    mentions: v.optional(v.array(v.object({ userId: v.string(), name: v.string() }))), notifyUserIds: v.optional(v.array(v.string())),
    /** Posts as one of the person's agents, under its own name. */
    asAgent: v.optional(v.object({ id: v.string(), name: v.string() })),
  },
  handler: async (ctx, args) => {
    const me = await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken);
    requireWriter(me);
    if (args.body.length > BODY_MAX) throw new Error("Message must be under 8,000 characters");
    if (args.asAgent && (!AGENT_ID.test(args.asAgent.id) || !args.asAgent.name.trim())) throw new Error("Unknown agent");
    const author = args.asAgent ? { userId: args.asAgent.id, name: args.asAgent.name.trim().slice(0, 80), email: "", avatarUrl: null } : me;
    const attachments: ChatAttachment[] = [];
    for (const id of (args.attachmentIds ?? []).slice(0, 8)) {
      const file = await ctx.db.query("teamChatFiles").withIndex("by_team_conversation_file", (q) => q.eq("teamId", args.teamId).eq("conversation", args.conversation).eq("fileId", id)).unique();
      if (!file || file.author !== me.userId) throw new Error("Attachment not found");
      attachments.push(parse<ChatAttachment>(file.payload));
    }
    const references = (args.references ?? []).slice(0, 12);
    const mentions = (args.mentions ?? []).slice(0, 20);
    if (!args.body.trim() && !attachments.length && !references.length && !mentions.length) throw new Error("Write a message or add an attachment");
    if (args.replyTo) await messageRow(ctx, args.teamId, args.conversation, args.replyTo);
    const message: ChatMessage = {
      id: uuid(), authorUserId: author.userId, authorName: author.name, authorEmail: author.email, avatarUrl: author.avatarUrl ?? null,
      body: args.body.trim(), createdAt: Date.now(), attachments, references, mentions, ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    };
    await ctx.db.insert("teamChatMessages", { teamId: args.teamId, conversation: args.conversation, messageId: message.id, created: message.createdAt, payload: JSON.stringify(message) });
    const userIds = [...new Set([...mentions.map((mention) => mention.userId), ...(args.notifyUserIds ?? [])])]
      .filter((id) => id !== me.userId).map((id) => ctx.db.normalizeId("users", id)).filter((id): id is Id<"users"> => id !== null).slice(0, 20);
    if (userIds.length) {
      await ctx.scheduler.runAfter(0, internal.notifications.chatMentions, {
        teamId: args.teamId, actorId: me.user._id, messageId: message.id, userIds, conversation: args.conversation, preview: message.body.slice(0, 280),
      });
    }
    return message;
  },
});

export const edit = mutation({
  args: { ...scopeArgs, id: v.string(), body: v.optional(v.string()), reaction: v.optional(v.string()), pinned: v.optional(v.boolean()), delete: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const me = await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken);
    requireWriter(me);
    const row = await messageRow(ctx, args.teamId, args.conversation, args.id);
    const message = parse<ChatMessage>(row.payload);
    if (args.delete === true || args.body !== undefined) {
      if (message.authorUserId !== me.userId) throw new Error("Only the author can edit or delete this message");
      if (args.delete === true) {
        await ctx.db.delete(row._id);
        return null;
      }
      if (!args.body?.trim() || args.body.length > BODY_MAX) throw new Error("Enter a message under 8,000 characters");
      message.body = args.body.trim();
      message.editedAt = Date.now();
    }
    if (args.reaction !== undefined) {
      if (!CHAT_REACTIONS.includes(args.reaction)) throw new Error("Unknown reaction");
      const reactions = message.reactions ?? {};
      const users = reactions[args.reaction] ?? [];
      reactions[args.reaction] = users.includes(me.userId) ? users.filter((userId) => userId !== me.userId) : [...users, me.userId];
      message.reactions = reactions;
    }
    if (args.pinned !== undefined) message.pinned = args.pinned;
    await ctx.db.patch(row._id, { payload: JSON.stringify(message) });
    return message;
  },
});

export const markRead = mutation({
  args: { ...scopeArgs, messageId: v.string() },
  handler: async (ctx, args) => {
    const me = await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken);
    const seen = parse<ChatMessage>((await messageRow(ctx, args.teamId, args.conversation, args.messageId)).payload).createdAt;
    const row = await ctx.db.query("teamChatReads").withIndex("by_team_conversation_user", (q) => q.eq("teamId", args.teamId).eq("conversation", args.conversation).eq("userId", me.userId)).unique();
    if (!row) await ctx.db.insert("teamChatReads", { teamId: args.teamId, conversation: args.conversation, userId: me.userId, seen });
    else if (row.seen < seen) await ctx.db.patch(row._id, { seen });
    return null;
  },
});

export const openDirect = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), recipientId: v.string() },
  handler: async (ctx, args) => {
    const me = await viewer(ctx, args.teamId, args.sessionToken);
    requireWriter(me);
    const recipient = ctx.db.normalizeId("users", args.recipientId);
    const other = recipient ? await ctx.db.get(recipient) : null;
    if (!other || other._id === me.user._id || !(await getActiveTeamMember(ctx, args.teamId, other.email))) throw new Error("Choose a member of this workspace");
    const [userA, userB] = [me.userId, other._id as string].sort() as [string, string];
    const conversation = `dm:${userA}:${userB}`;
    const existing = await ctx.db.query("teamDirectConversations").withIndex("by_team_conversation", (q) => q.eq("teamId", args.teamId).eq("conversation", conversation)).unique();
    if (!existing) await ctx.db.insert("teamDirectConversations", { teamId: args.teamId, conversation, userA, userB });
    return conversation;
  },
});

export const directConversations = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const me = await viewer(ctx, args.teamId, args.sessionToken);
    const rows = [
      ...await ctx.db.query("teamDirectConversations").withIndex("by_team_userA", (q) => q.eq("teamId", args.teamId).eq("userA", me.userId)).take(200),
      ...await ctx.db.query("teamDirectConversations").withIndex("by_team_userB", (q) => q.eq("teamId", args.teamId).eq("userB", me.userId)).take(200),
    ];
    const out = [];
    for (const row of rows) {
      const read = await ctx.db.query("teamChatReads").withIndex("by_team_conversation_user", (q) => q.eq("teamId", args.teamId).eq("conversation", row.conversation).eq("userId", me.userId)).unique();
      const recent = await ctx.db.query("teamChatMessages").withIndex("by_team_conversation_created", (q) => q.eq("teamId", args.teamId).eq("conversation", row.conversation).gt("created", read?.seen ?? 0)).order("desc").take(100);
      const last = recent[0] ?? await ctx.db.query("teamChatMessages").withIndex("by_team_conversation_created", (q) => q.eq("teamId", args.teamId).eq("conversation", row.conversation)).order("desc").first();
      const unread = recent.filter((message) => parse<ChatMessage>(message.payload).authorUserId !== me.userId).length;
      out.push({ id: row.conversation, otherUserId: row.userA === me.userId ? row.userB : row.userA, unread, ...(last ? { lastMessage: parse<ChatMessage>(last.payload) } : {}) });
    }
    return out.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
  },
});

export const generateFileUploadUrl = mutation({
  args: scopeArgs,
  handler: async (ctx, args) => {
    requireWriter(await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken));
    return ctx.storage.generateUploadUrl();
  },
});

export const registerFile = mutation({
  args: { ...scopeArgs, storageId: v.id("_storage"), name: v.string(), contentType: v.string(), projectId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken);
    requireWriter(me);
    const stored = await ctx.db.system.get(args.storageId);
    if (!stored) throw new Error("Upload not found");
    const file: ChatAttachment = { id: uuid(), name: args.name.slice(0, 200), contentType: args.contentType.slice(0, 200) || "application/octet-stream", size: stored.size, ...(args.projectId ? { projectId: args.projectId } : {}) };
    await ctx.db.insert("teamChatFiles", { teamId: args.teamId, conversation: args.conversation, fileId: file.id, author: me.userId, storageId: args.storageId, payload: JSON.stringify(file) });
    return file;
  },
});

export const fileUrl = query({
  args: { ...scopeArgs, id: v.string() },
  handler: async (ctx, args) => {
    await conversationAccess(ctx, args.teamId, args.conversation, args.sessionToken);
    const row = await ctx.db.query("teamChatFiles").withIndex("by_team_conversation_file", (q) => q.eq("teamId", args.teamId).eq("conversation", args.conversation).eq("fileId", args.id)).unique();
    if (!row) throw new Error("File not found");
    return { file: parse<ChatAttachment>(row.payload), url: await ctx.storage.getUrl(row.storageId) };
  },
});

const callArgs = { sessionToken: v.string(), teamId: v.id("teams"), room: v.string() };

async function liveParticipants(ctx: Ctx, teamId: Id<"teams">, room: string) {
  const rows = await ctx.db.query("teamCallParticipants").withIndex("by_team_room_user", (q) => q.eq("teamId", teamId).eq("room", room)).take(50);
  const cutoff = Date.now() - PARTICIPANT_TTL_MS;
  return rows.filter((row) => row.seen >= cutoff);
}

const sortedPeople = (rows: Doc<"teamCallParticipants">[]) => rows.sort((a, b) => a.seen - b.seen).map((row) => parse<CallParticipant>(row.payload));

export const participants = query({
  args: callArgs,
  handler: async (ctx, args) => {
    await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    return sortedPeople(await liveParticipants(ctx, args.teamId, args.room));
  },
});

async function requireCallSession(ctx: Ctx, teamId: Id<"teams">, room: string, userId: string, sessionId?: string) {
  const row = (await liveParticipants(ctx, teamId, room)).find((candidate) => candidate.userId === userId);
  const participant = row ? parse<CallParticipant>(row.payload) : null;
  if (!sessionId || !row || participant?.sessionId !== sessionId) throw new Error("Rejoin the call to continue");
  return { row, participant: participant! };
}

async function dropSignals(ctx: MutationCtx, teamId: Id<"teams">, room: string, userId: string) {
  for (const row of await ctx.db.query("teamCallSignals").withIndex("by_team_room_sender", (q) => q.eq("teamId", teamId).eq("room", room).eq("sender", userId)).take(500)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query("teamCallSignals").withIndex("by_team_room_recipient_created", (q) => q.eq("teamId", teamId).eq("room", room).eq("recipient", userId)).take(500)) await ctx.db.delete(row._id);
}

export const presence = mutation({
  args: { ...callArgs, action: v.union(v.literal("join"), v.literal("update")), sessionId: v.optional(v.string()), audioEnabled: v.boolean(), videoEnabled: v.boolean(), screenSharing: v.boolean() },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    requireWriter(me);
    const heartbeat = args.action === "update";
    const live = await liveParticipants(ctx, args.teamId, args.room);
    const existing = await ctx.db.query("teamCallParticipants").withIndex("by_team_room_user", (q) => q.eq("teamId", args.teamId).eq("room", args.room).eq("userId", me.userId)).unique();
    const previous = existing && live.some((row) => row._id === existing._id) ? parse<CallParticipant>(existing.payload) : null;
    if (heartbeat) await requireCallSession(ctx, args.teamId, args.room, me.userId, args.sessionId);
    if (live.length >= CALL_ROOM_LIMIT && !previous) throw new Error(`This call is full (${CALL_ROOM_LIMIT} people)`);
    if (!heartbeat) await dropSignals(ctx, args.teamId, args.room, me.userId);
    const at = Date.now();
    const participant: CallParticipant = {
      userId: me.userId, name: me.name, ...(me.username ? { username: me.username } : {}), email: me.email, avatarUrl: me.avatarUrl,
      audioEnabled: args.audioEnabled, videoEnabled: args.videoEnabled, screenSharing: args.screenSharing,
      joinedAt: heartbeat && previous ? previous.joinedAt : Math.max(at, (previous?.joinedAt ?? 0) + 1), lastSeenAt: at,
      sessionId: heartbeat && previous ? previous.sessionId : uuid(),
    };
    if (existing) await ctx.db.patch(existing._id, { seen: at, payload: JSON.stringify(participant) });
    else await ctx.db.insert("teamCallParticipants", { teamId: args.teamId, room: args.room, userId: me.userId, seen: at, payload: JSON.stringify(participant) });
    return participant;
  },
});

export const leave = mutation({
  args: { ...callArgs, sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    const { row } = await requireCallSession(ctx, args.teamId, args.room, me.userId, args.sessionId);
    await ctx.db.delete(row._id);
    await dropSignals(ctx, args.teamId, args.room, me.userId);
    return null;
  },
});

export const sendSignal = mutation({
  args: {
    ...callArgs, toUserId: v.string(), kind: v.string(), payload: v.string(), sessionId: v.optional(v.string()), toSessionId: v.optional(v.string()),
    fromJoinedAt: v.optional(v.number()), toJoinedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    requireWriter(me);
    const { participant: sender } = await requireCallSession(ctx, args.teamId, args.room, me.userId, args.sessionId);
    if (args.toUserId === me.userId || !["offer", "answer", "candidate"].includes(args.kind) || !args.payload || args.payload.length > 80_000) throw new Error("Invalid call signal");
    const target = (await liveParticipants(ctx, args.teamId, args.room)).find((row) => row.userId === args.toUserId);
    if (!target) throw new Error("Both people must be in this call");
    const recipient = parse<CallParticipant>(target.payload);
    if ((args.fromJoinedAt !== undefined && args.fromJoinedAt !== sender.joinedAt) || (args.toJoinedAt !== undefined && args.toJoinedAt !== recipient.joinedAt) || args.toSessionId !== recipient.sessionId) return null;
    const signal: CallSignal = {
      id: uuid(), fromUserId: me.userId, toUserId: args.toUserId, fromJoinedAt: sender.joinedAt, toJoinedAt: recipient.joinedAt,
      fromSessionId: sender.sessionId, toSessionId: recipient.sessionId, kind: args.kind, payload: args.payload, createdAt: Date.now(),
    };
    await ctx.db.insert("teamCallSignals", { teamId: args.teamId, room: args.room, recipient: args.toUserId, sender: me.userId, signalId: signal.id, created: signal.createdAt, payload: JSON.stringify(signal) });
    return signal;
  },
});

export const signals = query({
  args: { ...callArgs, sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    await requireCallSession(ctx, args.teamId, args.room, me.userId, args.sessionId);
    const rows = await ctx.db.query("teamCallSignals").withIndex("by_team_room_recipient_created", (q) => q.eq("teamId", args.teamId).eq("room", args.room).eq("recipient", me.userId).gt("created", Date.now() - SIGNAL_TTL_MS)).take(120);
    return rows.map((row) => parse<CallSignal>(row.payload));
  },
});

export const ackSignals = mutation({
  args: { ...callArgs, sessionId: v.optional(v.string()), signalIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    await requireCallSession(ctx, args.teamId, args.room, me.userId, args.sessionId);
    const wanted = new Set(args.signalIds.slice(0, 120));
    for (const row of await ctx.db.query("teamCallSignals").withIndex("by_team_room_recipient_created", (q) => q.eq("teamId", args.teamId).eq("room", args.room).eq("recipient", me.userId)).take(500)) {
      if (wanted.has(row.signalId)) await ctx.db.delete(row._id);
    }
    return null;
  },
});

/** The agent in a call: who brought it, and whose app answers for it. Opaque to Convex beyond who may change it. */
export const callAgent = query({
  args: { ...callArgs, after: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    const agent = await ctx.db.query("teamCallAgents").withIndex("by_team_room", (q) => q.eq("teamId", args.teamId).eq("room", args.room)).unique();
    const lines = await ctx.db.query("teamCallLines").withIndex("by_team_room_line", (q) => q.eq("teamId", args.teamId).eq("room", args.room).gt("lineId", args.after ?? 0)).take(CALL_LINES_MAX);
    return { agent: agent ? { payload: agent.payload, updatedAt: agent.updatedAt } : null, lines: lines.map((line) => ({ lineId: line.lineId, payload: line.payload })) };
  },
});

export const setCallAgent = mutation({
  args: { ...callArgs, payload: v.union(v.string(), v.null()), expected: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    requireWriter(me);
    const row = await ctx.db.query("teamCallAgents").withIndex("by_team_room", (q) => q.eq("teamId", args.teamId).eq("room", args.room)).unique();
    if (args.expected !== undefined && (row?.updatedAt ?? null) !== args.expected) return { changed: false, updatedAt: row?.updatedAt ?? null };
    const at = Math.max(Date.now(), (row?.updatedAt ?? 0) + 1);
    if (args.payload === null) {
      if (row) await ctx.db.delete(row._id);
      for (const line of await ctx.db.query("teamCallLines").withIndex("by_team_room_line", (q) => q.eq("teamId", args.teamId).eq("room", args.room)).take(CALL_LINES_MAX)) await ctx.db.delete(line._id);
      return { changed: true, updatedAt: null };
    }
    if (args.payload.length > 4_000) throw new Error("Call agent state too large");
    if (row) await ctx.db.patch(row._id, { payload: args.payload, updatedAt: at });
    else await ctx.db.insert("teamCallAgents", { teamId: args.teamId, room: args.room, payload: args.payload, updatedAt: at });
    return { changed: true, updatedAt: at };
  },
});

export const addCallLine = mutation({
  args: { ...callArgs, payload: v.string() },
  handler: async (ctx, args) => {
    const me = await roomAccess(ctx, args.teamId, args.room, args.sessionToken);
    requireWriter(me);
    if (args.payload.length > 4_000) throw new Error("Caption too long");
    const agent = await ctx.db.query("teamCallAgents").withIndex("by_team_room", (q) => q.eq("teamId", args.teamId).eq("room", args.room)).unique();
    if (!agent) throw new Error("No agent is in this call");
    const last = await ctx.db.query("teamCallLines").withIndex("by_team_room_line", (q) => q.eq("teamId", args.teamId).eq("room", args.room)).order("desc").first();
    const lineId = (last?.lineId ?? 0) + 1;
    await ctx.db.insert("teamCallLines", { teamId: args.teamId, room: args.room, lineId, payload: args.payload });
    if (lineId > CALL_LINES_MAX) {
      for (const old of await ctx.db.query("teamCallLines").withIndex("by_team_room_line", (q) => q.eq("teamId", args.teamId).eq("room", args.room).lte("lineId", lineId - CALL_LINES_MAX)).take(100)) await ctx.db.delete(old._id);
    }
    return { lineId, userId: me.userId, name: me.username || me.name };
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const row of await ctx.db.query("teamCallParticipants").withIndex("by_seen", (q) => q.lt("seen", now - PARTICIPANT_TTL_MS)).take(500)) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("teamCallSignals").withIndex("by_created", (q) => q.lt("created", now - SIGNAL_TTL_MS)).take(500)) await ctx.db.delete(row._id);
    return null;
  },
});
