import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canEdit, requireMember } from "./lib/permissions";
import { sceneAccess } from "./draw";
import { notify } from "./notifications";

const scope = { sessionToken: v.string(), teamId: v.id("teams"), canvasId: v.id("canvases") };
const guide = v.object({ axis: v.union(v.literal("x"), v.literal("y")), at: v.number() });
const page = v.object({ id: v.string(), name: v.string(), guides: v.optional(v.array(guide)) });
const mention = v.object({ kind: v.union(v.literal("member"), v.literal("agent")), id: v.string(), name: v.string() });
const PAGE_ID = /^[a-z0-9-]{1,40}$/;
const CHUNK_BYTES = 700_000;

async function editable(ctx: Parameters<typeof sceneAccess>[0], args: { sessionToken: string; teamId: Id<"teams">; canvasId: Id<"canvases"> }) {
  const access = await sceneAccess(ctx, args);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

export const meta = query({
  args: scope,
  returns: v.object({ pages: v.array(page) }),
  handler: async (ctx, args) => {
    const { container } = await sceneAccess(ctx, args);
    const canvas = container as { pages?: { id: string; name: string; guides?: { axis: "x" | "y"; at: number }[] }[] };
    return { pages: canvas.pages?.length ? canvas.pages : [{ id: "page-1", name: "Page 1" }] };
  },
});

export const setPages = mutation({
  args: { ...scope, pages: v.array(page) }, returns: v.null(),
  handler: async (ctx, args) => {
    await editable(ctx, args);
    if (!args.pages.length || args.pages.length > 50) throw new Error("A canvas has 1 to 50 pages");
    const ids = new Set<string>();
    for (const item of args.pages) {
      if (!PAGE_ID.test(item.id) || ids.has(item.id)) throw new Error("Invalid page id");
      ids.add(item.id);
      if (!item.name.trim() || item.name.length > 60) throw new Error("Enter a page name under 60 characters");
      if ((item.guides?.length ?? 0) > 100 || item.guides?.some(line => !Number.isFinite(line.at) || Math.abs(line.at) > 1_000_000)) throw new Error("Too many guides");
    }
    await ctx.db.patch(args.canvasId, { pages: args.pages.map(item => ({ ...item, name: item.name.trim() })), updatedAt: Date.now() });
    return null;
  },
});

/** Where an agent is working on the canvas, shown to everyone as its cursor; the row belongs to the person whose sign-in the agent uses. */
export const agentPresence = mutation({
  args: { ...scope, agentId: v.string(), name: v.string(), x: v.number(), y: v.number(), selection: v.optional(v.array(v.string())), leave: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await editable(ctx, args);
    if (!args.agentId || args.agentId.length > 100 || !args.name.trim() || args.name.length > 80) throw new Error("Invalid agent");
    const rows = await ctx.db.query("drawingPresence").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId).eq("userId", user._id)).take(20);
    const row = rows.find(item => item.agentId === args.agentId);
    if (args.leave) { if (row) await ctx.db.delete(row._id); return null; }
    if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error("Invalid pointer");
    const patch = { name: args.name.trim(), x: args.x, y: args.y, button: "up", selection: (args.selection ?? []).slice(0, 50), updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, patch); else await ctx.db.insert("drawingPresence", { teamId: args.teamId, canvasId: args.canvasId, userId: user._id, agentId: args.agentId, ...patch });
    return null;
  },
});

const commentShape = v.object({
  _id: v.id("canvasComments"), parentId: v.optional(v.id("canvasComments")), nodeId: v.optional(v.string()), x: v.number(), y: v.number(),
  authorId: v.id("users"), authorName: v.string(), agentName: v.optional(v.string()), body: v.string(), mentions: v.array(mention), resolved: v.boolean(), createdAt: v.number(),
});

export const comments = query({
  args: scope, returns: v.array(commentShape),
  handler: async (ctx, args) => {
    await sceneAccess(ctx, args);
    const rows = await ctx.db.query("canvasComments").withIndex("by_canvas", q => q.eq("canvasId", args.canvasId)).order("desc").take(500);
    return rows.reverse().map(({ _creationTime: _created, teamId: _team, canvasId: _canvas, ...row }) => row);
  },
});

export const addComment = mutation({
  args: { ...scope, parentId: v.optional(v.id("canvasComments")), nodeId: v.optional(v.string()), x: v.number(), y: v.number(), body: v.string(), mentions: v.array(mention), agentName: v.optional(v.string()) },
  returns: v.id("canvasComments"),
  handler: async (ctx, args) => {
    const { user, container } = await sceneAccess(ctx, args);
    const body = args.body.trim();
    if (!body || body.length > 4000) throw new Error("Write a comment under 4,000 characters");
    if (args.mentions.length > 20 || (args.nodeId && args.nodeId.length > 100) || !Number.isFinite(args.x) || !Number.isFinite(args.y) || (args.agentName && args.agentName.length > 80)) throw new Error("Invalid comment");
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.canvasId !== args.canvasId || parent.parentId) throw new Error("Comment not found");
    }
    const id = await ctx.db.insert("canvasComments", {
      teamId: args.teamId, canvasId: args.canvasId, ...(args.parentId ? { parentId: args.parentId } : {}), ...(args.nodeId ? { nodeId: args.nodeId } : {}),
      x: args.x, y: args.y, authorId: user._id, authorName: user.name, ...(args.agentName ? { agentName: args.agentName.trim() } : {}),
      body, mentions: args.mentions.map(item => ({ ...item, id: item.id.slice(0, 200), name: item.name.slice(0, 80) })), resolved: false, createdAt: Date.now(),
    });
    const projectId = (container as { projectId?: Id<"projects"> }).projectId;
    for (const item of args.mentions) {
      if (item.kind !== "member" || !item.id.includes("@")) continue;
      await notify(ctx, { teamId: args.teamId, email: item.id, actorId: user._id, kind: "mention", eventId: `canvas-comment:${id}:${item.id}`, ...(projectId ? { projectId } : {}), preview: body.slice(0, 200) });
    }
    return id;
  },
});

export const resolveComment = mutation({
  args: { ...scope, commentId: v.id("canvasComments"), resolved: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    await sceneAccess(ctx, args);
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.canvasId !== args.canvasId) throw new Error("Comment not found");
    await ctx.db.patch(comment._id, { resolved: args.resolved });
    return null;
  },
});

export const deleteComment = mutation({
  args: { ...scope, commentId: v.id("canvasComments") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await sceneAccess(ctx, args);
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.canvasId !== args.canvasId) throw new Error("Comment not found");
    if (comment.authorId !== user._id) throw new Error("Only the author can delete a comment");
    for (const reply of await ctx.db.query("canvasComments").withIndex("by_canvas", q => q.eq("canvasId", args.canvasId)).take(500)) if (reply.parentId === comment._id) await ctx.db.delete(reply._id);
    await ctx.db.delete(comment._id);
    return null;
  },
});

export const versions = query({
  args: scope,
  returns: v.array(v.object({ _id: v.id("canvasVersions"), name: v.string(), nodeCount: v.number(), authorName: v.string(), agentName: v.optional(v.string()), createdAt: v.number() })),
  handler: async (ctx, args) => {
    await sceneAccess(ctx, args);
    const rows = await ctx.db.query("canvasVersions").withIndex("by_canvas", q => q.eq("canvasId", args.canvasId)).order("desc").take(100);
    return rows.map(({ _id, name, nodeCount, authorName, agentName, createdAt }) => ({ _id, name, nodeCount, authorName, ...(agentName ? { agentName } : {}), createdAt }));
  },
});

export const saveVersion = mutation({
  args: { ...scope, name: v.string(), agentName: v.optional(v.string()) }, returns: v.id("canvasVersions"),
  handler: async (ctx, args) => {
    const { user } = await editable(ctx, args);
    const name = args.name.trim();
    if (!name || name.length > 80) throw new Error("Name the version in under 80 characters");
    const existing = await ctx.db.query("canvasVersions").withIndex("by_canvas", q => q.eq("canvasId", args.canvasId)).take(201);
    if (existing.length >= 200) throw new Error("This canvas has 200 versions; delete an old one first");
    const rows = (await ctx.db.query("drawingElements").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId)).take(5000)).map(row => row.data);
    const live = rows.filter(row => !row.includes("\"deleted\":true"));
    const versionId = await ctx.db.insert("canvasVersions", { teamId: args.teamId, canvasId: args.canvasId, name, nodeCount: live.length, authorName: user.name, ...(args.agentName ? { agentName: args.agentName.slice(0, 80) } : {}), createdAt: Date.now() });
    let chunk: string[] = [];
    let bytes = 0;
    let order = 0;
    for (const row of live) {
      if (bytes + row.length > CHUNK_BYTES && chunk.length) { await ctx.db.insert("canvasVersionChunks", { versionId, order: order++, rows: chunk }); chunk = []; bytes = 0; }
      chunk.push(row);
      bytes += row.length;
    }
    if (chunk.length) await ctx.db.insert("canvasVersionChunks", { versionId, order, rows: chunk });
    return versionId;
  },
});

export const versionRows = query({
  args: { ...scope, versionId: v.id("canvasVersions") }, returns: v.array(v.string()),
  handler: async (ctx, args) => {
    await sceneAccess(ctx, args);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.canvasId !== args.canvasId) throw new Error("Version not found");
    const chunks = await ctx.db.query("canvasVersionChunks").withIndex("by_version", q => q.eq("versionId", args.versionId)).take(50);
    return chunks.flatMap(chunk => chunk.rows);
  },
});

export const deleteVersion = mutation({
  args: { ...scope, versionId: v.id("canvasVersions") }, returns: v.null(),
  handler: async (ctx, args) => {
    await editable(ctx, args);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.canvasId !== args.canvasId) throw new Error("Version not found");
    for (const chunk of await ctx.db.query("canvasVersionChunks").withIndex("by_version", q => q.eq("versionId", args.versionId)).take(50)) await ctx.db.delete(chunk._id);
    await ctx.db.delete(version._id);
    return null;
  },
});

const linkShape = v.object({ _id: v.id("designLinks"), taskId: v.id("tasks"), canvasId: v.id("canvases"), canvasName: v.string(), frameId: v.string(), frameName: v.string(), agentName: v.optional(v.string()), status: v.union(v.literal("draft"), v.literal("review"), v.literal("approved")), title: v.string(), done: v.boolean() });

async function describeLinks(ctx: Parameters<typeof sceneAccess>[0], rows: { _id: Id<"designLinks">; taskId: Id<"tasks">; canvasId: Id<"canvases">; frameId: string; frameName: string; agentName?: string; status: "draft" | "review" | "approved" }[]) {
  const out = [];
  for (const row of rows) {
    const [task, canvas] = await Promise.all([ctx.db.get(row.taskId), ctx.db.get(row.canvasId)]);
    if (!task || !canvas || canvas.archived) continue;
    out.push({ _id: row._id, taskId: row.taskId, canvasId: row.canvasId, canvasName: canvas.name, frameId: row.frameId, frameName: row.frameName, ...(row.agentName ? { agentName: row.agentName } : {}), status: row.status, title: task.title, done: task.done });
  }
  return out;
}

/** The canvas frames that design an issue. */
export const designsForIssue = query({
  args: { sessionToken: v.string(), taskId: v.id("tasks") }, returns: v.array(linkShape),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    await requireMember(ctx, task.projectId, args.sessionToken);
    return describeLinks(ctx, await ctx.db.query("designLinks").withIndex("by_task", q => q.eq("taskId", args.taskId)).take(50));
  },
});

/** The issues the frames of a canvas design. */
export const designsForCanvas = query({
  args: scope, returns: v.array(linkShape),
  handler: async (ctx, args) => {
    await sceneAccess(ctx, args);
    return describeLinks(ctx, await ctx.db.query("designLinks").withIndex("by_canvas", q => q.eq("canvasId", args.canvasId)).take(200));
  },
});

export const linkDesign = mutation({
  args: { ...scope, taskId: v.id("tasks"), frameId: v.string(), frameName: v.string(), agentName: v.optional(v.string()), status: v.optional(v.union(v.literal("draft"), v.literal("review"), v.literal("approved"))) },
  returns: v.id("designLinks"),
  handler: async (ctx, args) => {
    const { container } = await editable(ctx, args);
    const task = await ctx.db.get(args.taskId);
    const projectId = (container as { projectId?: Id<"projects"> }).projectId;
    if (!task || task.projectId !== projectId) throw new Error("Issue not found in this project");
    if (!args.frameId || args.frameId.length > 100 || !args.frameName.trim() || args.frameName.length > 120) throw new Error("Invalid frame");
    const existing = (await ctx.db.query("designLinks").withIndex("by_task", q => q.eq("taskId", args.taskId)).take(50)).find(row => row.canvasId === args.canvasId && row.frameId === args.frameId);
    const patch = { frameName: args.frameName.trim(), status: args.status ?? existing?.status ?? "draft", ...(args.agentName ? { agentName: args.agentName.slice(0, 80) } : {}), updatedAt: Date.now() };
    if (existing) { await ctx.db.patch(existing._id, patch); return existing._id; }
    return ctx.db.insert("designLinks", { projectId: task.projectId, taskId: args.taskId, canvasId: args.canvasId, frameId: args.frameId, createdAt: Date.now(), ...patch });
  },
});

export const unlinkDesign = mutation({
  args: { ...scope, linkId: v.id("designLinks") }, returns: v.null(),
  handler: async (ctx, args) => {
    await editable(ctx, args);
    const link = await ctx.db.get(args.linkId);
    if (!link || link.canvasId !== args.canvasId) throw new Error("Design link not found");
    await ctx.db.delete(link._id);
    return null;
  },
});
