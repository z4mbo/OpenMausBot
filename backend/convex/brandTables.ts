import { defineTable } from "convex/server";
import { v } from "convex/values";

export const brandTables = {
  /** A project's brand kit, at most one per project; the fields mirror BrandKit in shared/brand-kit. */
  brandKits: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    tagline: v.string(),
    voice: v.object({ adjectives: v.array(v.string()), do: v.array(v.string()), dont: v.array(v.string()) }),
    colors: v.object({ primary: v.string(), secondary: v.string(), neutrals: v.array(v.string()) }),
    fonts: v.object({ heading: v.string(), body: v.string() }),
    logoAssetIds: v.array(v.id("designAssets")),
    iconAssetId: v.optional(v.id("designAssets")),
    imagery: v.array(v.string()),
    updatedBy: v.string(),
    agentName: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),
};
