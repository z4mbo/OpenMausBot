import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember } from "./lib/permissions";
import { invitationAddress } from "./lib/invitationMail";
import { newToken, settingsOf } from "./lib/pipelineCore";
import { countPageView } from "./pulse";
import { PAGE_BODY_MAX, PAGE_DESCRIPTION_MAX, PAGE_SLUG, PAGE_TITLE_MAX, pageSlug, renderCanvasPage } from "../../shared/canvas-page";
import { decodeScene, descendants } from "../../shared/canvas-scene";

type Ctx = QueryCtx | MutationCtx;

const PAGES_PER_PROJECT = 50;
const CAPTURES_COUNTED = 5000;

const pageRow = v.object({
  _id: v.id("publishedPages"),
  canvasId: v.id("canvases"),
  frameId: v.string(),
  slug: v.string(),
  title: v.string(),
  description: v.string(),
  url: v.string(),
  views: v.number(),
  leads: v.number(),
  leadForms: v.number(),
  publishedBy: v.string(),
  updatedAt: v.number(),
});

/** Where people open published pages: the Origin site when this backend has one, otherwise the backend's own HTTP address. */
export function pagesOrigin(): string {
  return invitationAddress().origin ?? (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
}

export const pagePath = (page: Pick<Doc<"publishedPages">, "site" | "slug">) => `/p/${page.site}/${page.slug}`;

async function siteFor(ctx: Ctx, team: Doc<"teams">): Promise<string> {
  const existing = await ctx.db.query("publishedPages").withIndex("by_teamId", (q) => q.eq("teamId", team._id)).first();
  if (existing) return existing.site;
  const preferred = team.slug && PAGE_SLUG.test(team.slug) ? team.slug : `${pageSlug(team.name).slice(0, 24).replace(/-+$/, "") || "site"}-${team._id.slice(-6).toLowerCase()}`;
  const taken = await ctx.db.query("publishedPages").withIndex("by_site_and_slug", (q) => q.eq("site", preferred)).first();
  return taken && taken.teamId !== team._id ? `w-${team._id.toLowerCase()}` : preferred;
}

async function captureCounts(ctx: Ctx, projectId: Id<"projects">): Promise<Map<string, number>> {
  const rows = await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_kind_and_createdAt", (q) => q.eq("projectId", projectId).eq("kind", "capture")).order("desc").take(CAPTURES_COUNTED);
  const counts = new Map<string, number>();
  for (const row of rows) if (row.actor.kind === "system") counts.set(row.actor.name, (counts.get(row.actor.name) ?? 0) + 1);
  return counts;
}

export const list = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  returns: v.object({ pages: v.array(pageRow), captureEnabled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const pages = await ctx.db.query("publishedPages").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(PAGES_PER_PROJECT);
    const counts = pages.length ? await captureCounts(ctx, args.projectId) : new Map<string, number>();
    const origin = pagesOrigin();
    return {
      captureEnabled: (await settingsOf(ctx, args.projectId))?.captureEnabled ?? false,
      pages: pages.sort((a, b) => b.updatedAt - a.updatedAt).map((page) => ({
        _id: page._id, canvasId: page.canvasId, frameId: page.frameId, slug: page.slug, title: page.title, description: page.description,
        url: `${origin}${pagePath(page)}`, views: page.views, leads: counts.get(page.slug) ?? 0, leadForms: page.leadForms, publishedBy: page.publishedBy, updatedAt: page.updatedAt,
      })),
    };
  },
});

async function fileUrl(ctx: MutationCtx, canvas: Doc<"canvases">, fileId: string) {
  const file = await ctx.db.query("drawingFiles").withIndex("by_scene", (q) => q.eq("teamId", canvas.teamId).eq("canvasId", canvas._id).eq("fileId", fileId)).unique();
  return file ? { storageId: file.storageId, url: await ctx.storage.getUrl(file.storageId) } : null;
}

export const publish = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), canvasId: v.id("canvases"), frameId: v.string(),
    slug: v.string(), title: v.string(), description: v.optional(v.string()), ogFileId: v.optional(v.string()),
  },
  returns: v.object({ pageId: v.id("publishedPages"), url: v.string(), created: v.boolean(), leadForms: v.number(), captureTurnedOn: v.boolean() }),
  handler: async (ctx, args) => {
    const { member, user, project } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas || canvas.archived || canvas.projectId !== project._id) throw new Error("Canvas not found");
    const team = await ctx.db.get(canvas.teamId);
    if (!team) throw new Error("Workspace not found");
    const slug = args.slug.trim().toLowerCase();
    if (!PAGE_SLUG.test(slug)) throw new Error("Use lowercase letters, numbers and hyphens for the page address, up to 48 characters");
    const title = args.title.trim().slice(0, PAGE_TITLE_MAX);
    if (!title) throw new Error("Give the page a title");

    const rows = await ctx.db.query("drawingElements").withIndex("by_scene", (q) => q.eq("teamId", canvas.teamId).eq("canvasId", canvas._id)).take(5000);
    const scene = new Map(decodeScene(rows.map((row) => row.data)).map((node) => [node.id, node]));
    const frame = scene.get(args.frameId);
    if (!frame || frame.deleted || frame.type !== "frame") throw new Error("Choose a frame on this canvas to publish");
    const images = new Map<string, string>();
    for (const node of descendants(scene, frame.id)) {
      if (node.type !== "image" || !node.fileId || images.has(node.fileId)) continue;
      const file = await fileUrl(ctx, canvas, node.fileId);
      if (file?.url) images.set(node.fileId, file.url);
    }
    const rendered = renderCanvasPage(scene, frame.id, images)!;
    if (rendered.body.length > PAGE_BODY_MAX) throw new Error("This frame is too large to publish; split it into smaller pages");
    const og = args.ogFileId ? await fileUrl(ctx, canvas, args.ogFileId) : null;

    const existing = await ctx.db.query("publishedPages").withIndex("by_canvasId_and_frameId", (q) => q.eq("canvasId", canvas._id).eq("frameId", frame.id)).unique();
    const site = existing?.site ?? await siteFor(ctx, team);
    const clash = await ctx.db.query("publishedPages").withIndex("by_site_and_slug", (q) => q.eq("site", site).eq("slug", slug)).unique();
    if (clash && clash._id !== existing?._id) throw new Error(`/p/${site}/${slug} is already another page; choose a different address`);
    if (!existing && (await ctx.db.query("publishedPages").withIndex("by_projectId", (q) => q.eq("projectId", project._id)).take(PAGES_PER_PROJECT)).length >= PAGES_PER_PROJECT) {
      throw new Error(`A project can publish up to ${PAGES_PER_PROJECT} pages`);
    }
    const now = Date.now();
    const fields = {
      slug, title, description: (args.description?.trim() || rendered.summary).slice(0, PAGE_DESCRIPTION_MAX),
      body: rendered.body, background: rendered.background, fonts: rendered.fonts, leadForms: rendered.leadForms,
      ...(og ? { ogStorageId: og.storageId } : {}), publishedBy: user.name || user.email, updatedAt: now,
    };
    let pageId: Id<"publishedPages">;
    if (existing) { await ctx.db.patch(existing._id, fields); pageId = existing._id; }
    else pageId = await ctx.db.insert("publishedPages", { teamId: team._id, projectId: project._id, canvasId: canvas._id, frameId: frame.id, site, views: 0, publishedAt: now, ...fields });

    let captureTurnedOn = false;
    if (rendered.leadForms) {
      const settings = await settingsOf(ctx, project._id);
      if (!settings) await ctx.db.insert("pipelineSettings", { projectId: project._id, captureToken: newToken(), captureEnabled: true, autoSend: false });
      else if (!settings.captureEnabled) await ctx.db.patch(settings._id, { captureEnabled: true });
      captureTurnedOn = !settings?.captureEnabled;
    }
    return { pageId, url: `${pagesOrigin()}/p/${site}/${slug}`, created: !existing, leadForms: rendered.leadForms, captureTurnedOn };
  },
});

export const unpublish = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), pageId: v.id("publishedPages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    const page = await ctx.db.get(args.pageId);
    if (!page || page.projectId !== args.projectId) throw new Error("Page not found");
    await ctx.db.delete(page._id);
    return null;
  },
});

const address = { site: v.string(), slug: v.string() };
async function pageAt(ctx: Ctx, site: string, slug: string) {
  if (!PAGE_SLUG.test(slug) || site.length > 80) return null;
  return ctx.db.query("publishedPages").withIndex("by_site_and_slug", (q) => q.eq("site", site).eq("slug", slug)).unique();
}

/** Only the public page route calls these. */
export const served = internalQuery({
  args: address,
  returns: v.union(v.null(), v.object({ title: v.string(), description: v.string(), body: v.string(), background: v.string(), fonts: v.array(v.string()), image: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const page = await pageAt(ctx, args.site, args.slug);
    if (!page) return null;
    const image = page.ogStorageId ? await ctx.storage.getUrl(page.ogStorageId) : null;
    return { title: page.title, description: page.description, body: page.body, background: page.background, fonts: page.fonts, ...(image ? { image } : {}) };
  },
});

export const viewed = internalMutation({
  args: address, returns: v.null(),
  handler: async (ctx, args) => {
    const page = await pageAt(ctx, args.site, args.slug);
    if (!page) return null;
    await ctx.db.patch(page._id, { views: page.views + 1 });
    await countPageView(ctx, page.projectId, Date.now());
    return null;
  },
});

export const captureTarget = internalQuery({
  args: address, returns: v.union(v.null(), v.object({ token: v.string(), leadForms: v.number() })),
  handler: async (ctx, args) => {
    const page = await pageAt(ctx, args.site, args.slug);
    if (!page) return null;
    const settings = await settingsOf(ctx, page.projectId);
    return { token: settings?.captureToken ?? "", leadForms: page.leadForms };
  },
});
