import { defineTable } from "convex/server";
import { v } from "convex/values";

export const pagesTables = {
  /** A Canvas frame published as a public page at /p/<site>/<slug>; `body` is the snapshot taken at the last publish. */
  publishedPages: defineTable({
    teamId: v.id("teams"),
    projectId: v.id("projects"),
    canvasId: v.id("canvases"),
    frameId: v.string(),
    site: v.string(),
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    body: v.string(),
    background: v.string(),
    /** PageFont ids from shared/canvas-page; the public route drops any it does not know. */
    fonts: v.array(v.string()),
    leadForms: v.number(),
    ogStorageId: v.optional(v.id("_storage")),
    views: v.number(),
    publishedBy: v.string(),
    publishedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_and_slug", ["site", "slug"])
    .index("by_projectId", ["projectId"])
    .index("by_teamId", ["teamId"])
    .index("by_canvasId_and_frameId", ["canvasId", "frameId"]),
};
