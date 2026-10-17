import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getActiveTeamMember, projectMember, requireTeamMember } from "./lib/permissions";
import { projectIconTypeValidator } from "./lib/validators";
import { agentAccess, canSeeThread, requireThread } from "./lib/agentAccess";
import { messageByClientId } from "./lib/agentThreadRows";

export async function notify(ctx: MutationCtx, a: { teamId: Id<"teams">; email: string; actorId: Id<"users">; kind: "assignment" | "comment" | "mention"; eventId: string; projectId?: Id<"projects">; taskId?: Id<"tasks">; messageId?: string; conversation?: string; agentThreadId?: Id<"agentThreads">; preview?: string }) {
  const user = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", a.email)).unique();
  if (!user || user.status !== "active" || user._id === a.actorId || !await getActiveTeamMember(ctx, a.teamId, user.email)) return;
  if (a.projectId) {
    const project = await ctx.db.get(a.projectId);
    if (!project || project.teamId !== a.teamId || project.status !== "active" || !await projectMember(ctx, project, user)) return;
  }
  const preferences = await ctx.db.query("notificationPreferences").withIndex("by_teamId_and_userId", q => q.eq("teamId", a.teamId).eq("userId", user._id)).unique();
  if (preferences && ((a.kind === "assignment" && !preferences.assignments) || (a.kind === "comment" && !preferences.comments) || (a.kind === "mention" && !preferences.mentions) || (a.projectId && preferences.mutedProjects.includes(a.projectId)))) return;
  if (await ctx.db.query("notifications").withIndex("by_user_event", q => q.eq("userId", user._id).eq("eventId", a.eventId)).first()) return;
  const { email: _email, ...data } = a;
  await ctx.db.insert("notifications", { ...data, userId: user._id, read: false, createdAt: Date.now() });
}

const scope = { sessionToken: v.string(), teamId: v.id("teams") };
export const summary = query({
  args: scope, returns: v.object({ unread: v.number(), more: v.boolean(), latest: v.union(v.string(), v.null()) }),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const rows = await ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", user._id).eq("teamId", a.teamId).eq("read", false)).order("desc").take(100);
    const visible = [];
    for (const row of rows) {
      const project = row.projectId ? await ctx.db.get(row.projectId) : null;
      if (!row.projectId || (project?.status === "active" && await projectMember(ctx, project, user))) visible.push(row);
    }
    const recent = await ctx.db.query("notifications").withIndex("by_user_team", q => q.eq("userId", user._id).eq("teamId", a.teamId)).order("desc").take(100);
    let latest: string | null = null;
    for (const row of recent) {
      const project = row.projectId ? await ctx.db.get(row.projectId) : null;
      if (!row.projectId || (project?.status === "active" && await projectMember(ctx, project, user))) { latest = row._id; break; }
    }
    return { unread: Math.min(visible.length, 99), more: visible.length === 100, latest };
  },
});
export const list = query({
  args: { ...scope, unreadOnly: v.boolean(), paginationOpts: paginationOptsValidator },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.string(), page: v.array(v.object({
    _id: v.id("notifications"), kind: v.union(v.literal("assignment"), v.literal("comment"), v.literal("mention")), read: v.boolean(), createdAt: v.number(), snoozedUntil: v.optional(v.number()),
    projectId: v.optional(v.id("projects")), taskId: v.optional(v.id("tasks")), messageId: v.optional(v.string()), conversation: v.optional(v.string()), agentThreadId: v.optional(v.id("agentThreads")), preview: v.optional(v.string()),
    actorName: v.string(), actorAvatar: v.union(v.string(), v.null()), projectName: v.optional(v.string()), taskTitle: v.optional(v.string()), available: v.boolean(),
    iconType: v.optional(projectIconTypeValidator), iconValue: v.optional(v.string()), iconUrl: v.union(v.string(), v.null()),
  })) }),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const query = a.unreadOnly ? ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", user._id).eq("teamId", a.teamId).eq("read", false)) : ctx.db.query("notifications").withIndex("by_user_team", q => q.eq("userId", user._id).eq("teamId", a.teamId));
    const page = await query.order("desc").paginate({ ...a.paginationOpts, numItems: Math.min(a.paginationOpts.numItems, 50) });
    const visible = await Promise.all(page.page.map(async row => {
      const actor = await ctx.db.get(row.actorId), project = row.projectId ? await ctx.db.get(row.projectId) : null, task = row.taskId ? await ctx.db.get(row.taskId) : null;
      if (row.projectId && (!project || !await projectMember(ctx, project, user) || (a.unreadOnly && project.status !== "active"))) return null;
      return { _id: row._id, kind: row.kind, read: row.read, createdAt: row.createdAt, snoozedUntil: row.snoozedUntil, projectId: row.projectId, taskId: row.taskId, messageId: row.messageId, conversation: row.conversation, agentThreadId: row.agentThreadId, preview: row.preview, actorName: actor?.username || actor?.name || "Teammate", actorAvatar: actor?.avatarStorageId ? await ctx.storage.getUrl(actor.avatarStorageId) : null,
        projectName: project?.name, taskTitle: task?.title, available: Boolean(row.messageId) || Boolean(task && project?.teamId === a.teamId),
        iconType: project?.iconType, iconValue: project?.iconValue, iconUrl: project?.iconStorageId ? await ctx.storage.getUrl(project.iconStorageId) : null };
    }));
    return { isDone: page.isDone, continueCursor: page.continueCursor, page: visible.filter((row): row is NonNullable<typeof row> => row !== null) };
  },
});
export const markRead = mutation({
  args: { ...scope, id: v.id("notifications"), read: v.boolean() }, returns: v.null(),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const row = await ctx.db.get(a.id);
    if (!row || row.userId !== user._id || row.teamId !== a.teamId) throw new Error("Notification not found");
    await ctx.db.patch(row._id, { read: a.read, snoozedUntil: undefined }); return null;
  },
});
export const snooze = mutation({
  args: { ...scope, id: v.id("notifications"), until: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id || row.teamId !== args.teamId) throw new Error("Notification not found");
    if (!Number.isFinite(args.until) || args.until <= Date.now() || args.until > Date.now() + 30 * 86400000) throw new Error("Choose a time within the next 30 days");
    await ctx.db.patch(row._id, { read: true, snoozedUntil: args.until });
    await ctx.scheduler.runAt(args.until, internal.notifications.wake, { id: row._id, until: args.until });
    return null;
  },
});
export const wake = internalMutation({
  args: { id: v.id("notifications"), until: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row?.snoozedUntil === args.until) await ctx.db.patch(row._id, { read: false, snoozedUntil: undefined });
    return null;
  },
});
export const markAll = mutation({
  args: scope, returns: v.null(),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const newest = await ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", user._id).eq("teamId", a.teamId).eq("read", false)).order("desc").first();
    if (newest) await readBatch(ctx, a.teamId, user._id, newest._creationTime);
    return null;
  },
});
async function readBatch(ctx: MutationCtx, teamId: Id<"teams">, userId: Id<"users">, before: number) {
  const rows = await ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", userId).eq("teamId", teamId).eq("read", false).lte("_creationTime", before)).take(100);
  for (const row of rows) await ctx.db.patch(row._id, { read: true });
  if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.notifications.readMore, { teamId, userId, before });
}
export const readMore = internalMutation({ args: { teamId: v.id("teams"), userId: v.id("users"), before: v.number() }, returns: v.null(), handler: async (ctx, a) => { await readBatch(ctx, a.teamId, a.userId, a.before); return null; } });

const PREVIEW_MAX = 140;
const MENTION_LIMIT = 30;
const MENTION_WINDOW_MS = 60_000;
const AGENT_MENTION_MAX_AGE_MS = 10 * 60_000;
const clip = (text: string) => { const line = text.replace(/\s+/g, " ").trim(); return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line; };

/** "" is the workspace channel, "project:<id>" a project's chat, "dm:<a>:<b>" a conversation between two members. */
function chatTarget(ctx: MutationCtx, conversation: string | undefined): { projectId?: Id<"projects">; members?: string[] } | null {
  if (!conversation) return {};
  const project = /^project:([a-z0-9]{10,64})$/.exec(conversation);
  if (project) { const projectId = ctx.db.normalizeId("projects", project[1]!); return projectId ? { projectId } : null; }
  const dm = /^dm:([a-z0-9]{1,64}):([a-z0-9]{1,64})$/.exec(conversation);
  return dm ? { members: [dm[1]!, dm[2]!] } : null;
}

export const chatMentions = internalMutation({
  args: { teamId: v.id("teams"), actorId: v.id("users"), messageId: v.string(), userIds: v.array(v.id("users")), conversation: v.optional(v.string()), preview: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, a) => {
    const actor = await ctx.db.get(a.actorId);
    if (a.userIds.length > 20 || a.messageId.length > 80) throw new Error("Invalid mention");
    const target = chatTarget(ctx, a.conversation);
    if (!target) throw new Error("Invalid mention");
    if (target.members && !target.members.includes(a.actorId)) throw new Error("Invalid mention");
    if (target.projectId && (await ctx.db.get(target.projectId))?.teamId !== a.teamId) return null;
    if (!actor || actor.status !== "active" || !await getActiveTeamMember(ctx, a.teamId, actor.email)) return null;
    const located = a.conversation === undefined ? {} : { conversation: a.conversation, ...(target.projectId ? { projectId: target.projectId } : {}) };
    const preview = a.preview ? clip(a.preview) : "";
    for (const id of new Set(a.userIds)) {
      if (target.members && !target.members.includes(id)) continue;
      const user = await ctx.db.get(id);
      if (user) await notify(ctx, { teamId: a.teamId, actorId: a.actorId, email: user.email, kind: "mention", eventId: `chat:${a.messageId}`, messageId: a.messageId, ...located, ...(preview ? { preview } : {}) });
    }
    return null;
  },
});

export function tagsPerson(text: string, person: { name: string; username?: string }): boolean {
  const lower = text.toLowerCase();
  return [person.username, person.name].some((name) => {
    const tag = `@${(name ?? "").trim().toLowerCase()}`;
    if (tag.length < 2) return false;
    for (let at = lower.indexOf(tag); at !== -1; at = lower.indexOf(tag, at + 1)) {
      const before = at === 0 ? "" : lower[at - 1]!;
      const after = lower[at + tag.length] ?? "";
      if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_-]/u.test(after)) return true;
    }
    return false;
  });
}

async function withinMentionLimit(ctx: MutationCtx, userId: Id<"users">): Promise<boolean> {
  const key = `mention:${userId}`;
  const row = await ctx.db.query("authAttempts").withIndex("by_key", q => q.eq("key", key)).unique();
  const now = Date.now(); const live = row && row.expiresAt > now;
  const count = live ? row.count + 1 : 1;
  if (row) await ctx.db.patch(row._id, { count, expiresAt: live ? row.expiresAt : now + MENTION_WINDOW_MS });
  else await ctx.db.insert("authAttempts", { key, count, expiresAt: now + MENTION_WINDOW_MS });
  return count <= MENTION_LIMIT;
}

/** Security: only the author of a message in a shared agent thread can tag people in it, and only people the message
 * names who can open that thread are notified. */
export const agentThreadMentions = mutation({
  args: { sessionToken: v.string(), threadId: v.id("agentThreads"), clientId: v.string(), userIds: v.array(v.id("users")) }, returns: v.null(),
  handler: async (ctx, a) => {
    if (a.userIds.length > 10) throw new Error("Tag at most 10 people in one message");
    const { thread, user } = await requireThread(ctx, a.threadId, a.sessionToken);
    const row = await messageByClientId(ctx, thread._id, a.clientId.slice(0, 160));
    if (!row || row.role !== "user" || row.kind !== "text" || row.authorUserId !== user._id) throw new Error("Message not found");
    if (Date.now() - row.createdAt > AGENT_MENTION_MAX_AGE_MS) throw new Error("Tag people when you send the message");
    if (!await withinMentionLimit(ctx, user._id)) throw new Error("Too many mentions. Try again in a minute.");
    const agent = await ctx.db.get(thread.agentId);
    if (!agent) return null;
    const preview = clip(row.text ?? "");
    for (const id of new Set(a.userIds)) {
      const person = await ctx.db.get(id);
      if (!person || !tagsPerson(row.text ?? "", person) || !canSeeThread(thread, person) || !await agentAccess(ctx, agent, person)) continue;
      await notify(ctx, {
        teamId: thread.teamId, actorId: user._id, email: person.email, kind: "mention", eventId: `agent:${row._id}`, messageId: row._id,
        agentThreadId: thread._id, ...(thread.projectId ? { projectId: thread.projectId } : {}), ...(preview ? { preview } : {}),
      });
    }
    return null;
  },
});
