import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canEdit, requireMember } from "./lib/permissions";
import { createTaskRecord } from "./tasks";
import { callActionItem } from "./chiefOpsTables";

const ITEMS_MAX = 15;
const POINTS_MAX = 10;
const ITEM_CHARS = 200;
const POINT_CHARS = 400;
const TRANSCRIPT_MAX = 60_000;
const RECENT_MS = 7 * 86_400_000;
const LABEL_MAX = 32;
const DAY_MS = 86_400_000;

const lines = (items: readonly string[], max: number, chars: number) => items.map(item => item.replace(/\s+/g, " ").trim().slice(0, chars)).filter(Boolean).slice(0, max);

/** The issue label that hands an issue to an agent. */
export function agentLabel(name: string): string {
  return `agent:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bot"}`.slice(0, LABEL_MAX);
}

async function chiefOf(ctx: QueryCtx, projectId: Id<"projects">) {
  const agents = await ctx.db.query("workspaceAgents").withIndex("by_projectId", q => q.eq("projectId", projectId)).take(50);
  return agents.find(agent => agent.kind === "chief" && !agent.archivedAt && !agent.disabled) ?? null;
}

/** Saves what a call's agent took from the call. The transcript comes only when the people in it chose to keep it. */
export const record = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), callName: v.string(), startedAt: v.number(), minutes: v.number(),
    keyPoints: v.array(v.string()), decisions: v.array(v.string()), actionItems: v.array(v.object({ title: v.string(), owner: v.optional(v.string()) })),
    transcript: v.optional(v.string()),
  },
  returns: v.id("callNotes"),
  handler: async (ctx, a) => {
    const { user, project } = await requireMember(ctx, a.projectId, a.sessionToken);
    if (!project.teamId) throw new Error("Only a workspace project keeps call notes");
    const actionItems = a.actionItems.slice(0, ITEMS_MAX).map(item => {
      const owner = item.owner?.trim().slice(0, 60);
      return { title: item.title.replace(/\s+/g, " ").trim().slice(0, ITEM_CHARS), ...(owner ? { owner } : {}) };
    }).filter(item => item.title);
    return ctx.db.insert("callNotes", {
      teamId: project.teamId, projectId: a.projectId, callName: a.callName.trim().slice(0, 120) || project.name, createdBy: user._id,
      startedAt: a.startedAt, minutes: Math.max(1, Math.min(24 * 60, Math.round(a.minutes))),
      keyPoints: lines(a.keyPoints, POINTS_MAX, POINT_CHARS), decisions: lines(a.decisions, POINTS_MAX, POINT_CHARS), actionItems,
      ...(a.transcript?.trim() ? { transcript: a.transcript.slice(0, TRANSCRIPT_MAX) } : {}), createdAt: Date.now(),
    });
  },
});

const noteView = v.object({
  _id: v.id("callNotes"), callName: v.string(), startedAt: v.number(), minutes: v.number(), keyPoints: v.array(v.string()), decisions: v.array(v.string()),
  actionItems: v.array(callActionItem), chiefName: v.union(v.string(), v.null()), canCreate: v.boolean(),
});

/** The project's most recent call from the last week that still has action items to offer. */
export const latest = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.union(v.null(), noteView),
  handler: async (ctx, a) => {
    const { member } = await requireMember(ctx, a.projectId, a.sessionToken);
    const since = Date.now() - RECENT_MS;
    const notes = await ctx.db.query("callNotes").withIndex("by_projectId_and_createdAt", q => q.eq("projectId", a.projectId).gte("createdAt", since)).order("desc").take(10);
    const note = notes.find(row => row.dismissedAt === undefined && row.actionItems.length > 0);
    if (!note) return null;
    const chief = await chiefOf(ctx, a.projectId);
    return {
      _id: note._id, callName: note.callName, startedAt: note.startedAt, minutes: note.minutes, keyPoints: note.keyPoints, decisions: note.decisions,
      actionItems: note.actionItems, chiefName: chief?.name ?? null, canCreate: canEdit(member),
    };
  },
});

/** Creates a Draft issue for each picked action item not yet made into one, labelled for the project's Chief. */
export const createIssues = mutation({
  args: { sessionToken: v.string(), noteId: v.id("callNotes"), indexes: v.array(v.number()) },
  returns: v.array(v.id("tasks")),
  handler: async (ctx, a) => {
    const note = await ctx.db.get(a.noteId);
    if (!note) throw new Error("Call notes not found");
    const { member, user } = await requireMember(ctx, note.projectId, a.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    const chief = await chiefOf(ctx, note.projectId);
    const picked = new Set(a.indexes.filter(index => Number.isInteger(index) && index >= 0 && index < note.actionItems.length));
    const when = new Date(note.startedAt).toISOString().slice(0, 10);
    const context = [
      note.decisions.length ? `Decisions:\n${note.decisions.map(item => `- ${item}`).join("\n")}` : "",
      note.keyPoints.length ? `Key points:\n${note.keyPoints.map(item => `- ${item}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
    const created: Id<"tasks">[] = [];
    const items = [...note.actionItems];
    for (const index of [...picked].sort((x, y) => x - y)) {
      const item = items[index]!;
      if (item.taskId && await ctx.db.get(item.taskId)) continue;
      const description = [`From the "${note.callName}" call on ${when}.${item.owner ? ` Owner named in the call: ${item.owner}.` : ""}`, context].filter(Boolean).join("\n\n");
      const taskId = await createTaskRecord(ctx, {
        projectId: note.projectId, title: item.title, description, priority: "medium",
        ...(chief ? {} : { assignedToEmail: user.email, dueDate: new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10) }),
      }, user._id, chief?._id);
      if (chief) await ctx.db.patch(taskId, { labels: [agentLabel(chief.name)] });
      items[index] = { ...item, taskId };
      created.push(taskId);
    }
    await ctx.db.patch(note._id, { actionItems: items });
    return created;
  },
});

export const dismiss = mutation({
  args: { sessionToken: v.string(), noteId: v.id("callNotes") },
  returns: v.null(),
  handler: async (ctx, a) => {
    const note = await ctx.db.get(a.noteId);
    if (!note) return null;
    const { member } = await requireMember(ctx, note.projectId, a.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    await ctx.db.patch(note._id, { dismissedAt: Date.now() });
    return null;
  },
});
