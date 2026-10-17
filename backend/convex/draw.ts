import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canEdit, requireMember, requireTeamMember } from "./lib/permissions";

const scope = { sessionToken: v.string(), teamId: v.id("teams"), canvasId: v.optional(v.id("canvases")) };
async function sceneAccess(ctx: QueryCtx | MutationCtx, args: { sessionToken: string; teamId: Id<"teams">; canvasId?: Id<"canvases"> }) {
  if (args.canvasId) {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas || canvas.teamId !== args.teamId || canvas.archived) throw new Error("Canvas not found");
    const access = await requireMember(ctx, canvas.projectId, args.sessionToken);
    if (access.project.teamId !== args.teamId) throw new Error("Canvas not found");
    return { ...access, container: canvas };
  }
  const access = await requireTeamMember(ctx, args.teamId, args.sessionToken);
  const container = await ctx.db.get(args.teamId);
  if (!container) throw new Error("Workspace not found");
  return { ...access, container };
}

export const canvases = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.array(v.object({ _id: v.id("canvases"), name: v.string() })),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return (await ctx.db.query("canvases").withIndex("by_project", q => q.eq("projectId", args.projectId).eq("archived", false)).take(50)).map(({ _id, name }) => ({ _id, name }));
  },
});
export const createCanvas = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), name: v.string() }, returns: v.id("canvases"),
  handler: async (ctx, args) => {
    const { member, project } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member) || !project.teamId) throw new Error("Edit role required");
    if (!args.name.trim() || args.name.length > 80) throw new Error("Enter a canvas name under 80 characters");
    if ((await ctx.db.query("canvases").withIndex("by_project", q => q.eq("projectId", project._id).eq("archived", false)).take(50)).length >= 50) throw new Error("A project can have up to 50 canvases");
    return ctx.db.insert("canvases", { teamId: project.teamId, projectId: project._id, name: args.name.trim(), archived: false, drawingElementCount: 0, drawingBytes: 0, createdAt: Date.now(), updatedAt: Date.now() });
  },
});
export const renameCanvas = mutation({
  args: { ...scope, canvasId: v.id("canvases"), name: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    if (!canEdit((await sceneAccess(ctx, args)).member)) throw new Error("Edit role required");
    if (!args.name.trim() || args.name.length > 80) throw new Error("Enter a canvas name under 80 characters");
    await ctx.db.patch(args.canvasId, { name: args.name.trim(), updatedAt: Date.now() });
    return null;
  },
});

export const scene = query({
  args: scope, returns: v.array(v.string()),
  handler: async (ctx, args) => {
    await sceneAccess(ctx, args);
    return (await ctx.db.query("drawingElements").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId)).take(5000)).map(e => e.data);
  },
});
export const updateElements = mutation({
  args: { ...scope, elements: v.array(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { member, container: team } = await sceneAccess(ctx, args);
    if (!canEdit(member)) throw new Error("Edit role required");
    if (args.elements.length > 200) throw new Error("Drawing update too large");
    const rows = team.drawingElementCount === undefined ? await ctx.db.query("drawingElements").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId)).take(5001) : [];
    let count = team.drawingElementCount ?? rows.length;
    let bytes = team.drawingBytes ?? rows.reduce((sum, row) => sum + new TextEncoder().encode(row.data).byteLength, 0);
    for (const data of args.elements) {
      if (data.length > 64000) throw new Error("Drawing element is too large");
      const element = JSON.parse(data) as { id: string; version: number; versionNonce: number; type: string; x: number; y: number; width: number; height: number };
      if (!element || typeof element.id !== "string" || !element.id.length || element.id.length > 100 || !Number.isSafeInteger(element.version) || element.version < 1 || !Number.isSafeInteger(element.versionNonce) || ![element.x, element.y, element.width, element.height].every(Number.isFinite) || !["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame", "magicframe", "embeddable", "iframe"].includes(element.type)) throw new Error("Invalid drawing element");
      const existing = await ctx.db.query("drawingElements").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId).eq("elementId", element.id)).unique();
      // Excalidraw versions and nonce tie-breaks preserve concurrent element edits.
      if (existing && (existing.version > element.version || (existing.version === element.version && existing.nonce <= element.versionNonce))) continue;
      count += existing ? 0 : 1;
      bytes += new TextEncoder().encode(data).byteLength - (existing ? new TextEncoder().encode(existing.data).byteLength : 0);
      if (count > 5000 || bytes > 6 * 1024 * 1024) throw new Error("Canvas is full. Export your drawing before starting a new one");
      const update = { version: element.version, nonce: element.versionNonce, data, updatedAt: Date.now() };
      if (existing) await ctx.db.patch(existing._id, update);
      else await ctx.db.insert("drawingElements", { teamId: args.teamId, canvasId: args.canvasId, elementId: element.id, ...update });
    }
    await ctx.db.patch(team._id, { drawingElementCount: count, drawingBytes: bytes });
    return null;
  },
});
export const presence = query({
  args: scope, returns: v.any(),
  handler: async (ctx, args) => { await sceneAccess(ctx, args); return ctx.db.query("drawingPresence").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId)).take(100); },
});
export const setPresence = mutation({
  args: { ...scope, x: v.number(), y: v.number(), button: v.union(v.literal("up"), v.literal("down")), leave: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await sceneAccess(ctx, args);
    const row = await ctx.db.query("drawingPresence").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId).eq("userId", user._id)).unique();
    if (args.leave) { if (row) await ctx.db.delete(row._id); return null; }
    if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error("Invalid pointer");
    const patch = { name: user.name, x: args.x, y: args.y, button: args.button, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, patch); else await ctx.db.insert("drawingPresence", { teamId: args.teamId, canvasId: args.canvasId, userId: user._id, ...patch });
    return null;
  },
});
export const files = query({
  args: scope, returns: v.any(),
  handler: async (ctx, args) => { await sceneAccess(ctx, args); const files = await ctx.db.query("drawingFiles").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId)).take(500); return Promise.all(files.map(async f => ({ fileId: f.fileId, mimeType: f.mimeType, url: await ctx.storage.getUrl(f.storageId) }))); },
});
export const uploadUrl = mutation({
  args: scope, returns: v.string(),
  handler: async (ctx, args) => { const { member } = await sceneAccess(ctx, args); if (!canEdit(member)) throw new Error("Edit role required"); return ctx.storage.generateUploadUrl(); },
});
export const saveFile = mutation({
  args: { ...scope, fileId: v.string(), storageId: v.id("_storage"), mimeType: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await sceneAccess(ctx, args); if (!canEdit(member)) throw new Error("Edit role required");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size > 15 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(args.mimeType) || args.fileId.length > 100 || !args.fileId) throw new Error("Choose an image under 15 MB");
    const existing = await ctx.db.query("drawingFiles").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId).eq("fileId", args.fileId)).unique();
    if (!existing) {
      const count = (await ctx.db.query("drawingFiles").withIndex("by_scene", q => q.eq("teamId", args.teamId).eq("canvasId", args.canvasId)).take(501)).length;
      if (count >= 500) throw new Error("This canvas has reached its image limit");
      await ctx.db.insert("drawingFiles", { teamId: args.teamId, canvasId: args.canvasId, fileId: args.fileId, storageId: args.storageId, mimeType: args.mimeType });
    }
    return null;
  },
});
