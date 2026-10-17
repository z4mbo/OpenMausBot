import { v } from "convex/values";

export const userRoleValidator = v.union(v.literal("owner"), v.literal("user"));

export const userStatusValidator = v.union(v.literal("active"), v.literal("disabled"));

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);

export const memberStatusValidator = v.union(v.literal("active"), v.literal("invited"));

export const projectStatusValidator = v.union(v.literal("active"), v.literal("inactive"));

// Retain old stored values without deleting or rewriting existing projects.
export const storedProjectStatusValidator = v.union(
  projectStatusValidator,
  v.literal("paused"),
  v.literal("shipped"),
  v.literal("archived"),
);

export const projectIconTypeValidator = v.union(
  v.literal("default"),
  v.literal("emoji"),
  v.literal("icon"),
  v.literal("image"),
);

export const callSignalKindValidator = v.union(
  v.literal("offer"),
  v.literal("answer"),
  v.literal("candidate"),
);

export const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export const wikiTypeValidator = v.union(
  v.literal("wiki"),
  v.literal("credential_note"),
  v.literal("process"),
  v.literal("decision"),
);

export const tokenTypeValidator = v.union(
  v.literal("color"),
  v.literal("typography"),
  v.literal("spacing"),
  v.literal("component"),
  v.literal("motion"),
  v.literal("other"),
);

export const assetTypeValidator = v.union(
  v.literal("figma"),
  v.literal("image"),
  v.literal("icon"),
  v.literal("font"),
  v.literal("document"),
  v.literal("apk"),
  v.literal("other"),
);

export const taskAssetTypeValidator = v.union(
  v.literal("link"),
  v.literal("image"),
  v.literal("figma"),
  v.literal("file"),
  v.literal("other"),
);
