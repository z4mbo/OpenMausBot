import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { credentialKindValidator } from "./lib/validators";
import { serviceOf } from "./lib/vaultService";

const MAX_ITEMS = 500;

const encrypted = {
  ciphertext: v.string(),
  iv: v.string(),
  salt: v.string(),
  iterations: v.number(),
  kdf: v.string(),
};

const row = v.object({
  _id: v.id("personalCredentials"),
  _creationTime: v.number(),
  userId: v.id("users"),
  kind: credentialKindValidator,
  service: v.optional(v.string()),
  title: v.string(),
  username: v.optional(v.string()),
  url: v.optional(v.string()),
  ...encrypted,
  agentUse: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

async function ownItem(ctx: MutationCtx, sessionToken: string, credentialId: Id<"personalCredentials">) {
  const user = await requireUser(ctx, sessionToken);
  const item = await ctx.db.get(credentialId);
  if (!item || item.userId !== user._id) throw new Error("Credential not found");
  return item;
}

function title(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 150) throw new Error("Enter a name under 150 characters");
  return trimmed;
}

export const list = query({
  args: { sessionToken: v.string() },
  returns: v.array(row),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const rows = await ctx.db.query("personalCredentials").withIndex("by_userId", (q) => q.eq("userId", user._id)).take(MAX_ITEMS);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    kind: credentialKindValidator,
    service: v.optional(v.string()),
    title: v.string(),
    username: v.optional(v.string()),
    url: v.optional(v.string()),
    ...encrypted,
  },
  returns: v.id("personalCredentials"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const existing = await ctx.db.query("personalCredentials").withIndex("by_userId", (q) => q.eq("userId", user._id)).take(MAX_ITEMS);
    if (existing.length >= MAX_ITEMS) throw new Error(`Your Vault holds up to ${MAX_ITEMS} items`);
    const now = Date.now();
    return await ctx.db.insert("personalCredentials", {
      userId: user._id,
      kind: args.kind,
      service: serviceOf(args.kind, args.service),
      title: title(args.title),
      username: args.username?.trim() || undefined,
      url: args.url?.trim() || undefined,
      ciphertext: args.ciphertext,
      iv: args.iv,
      salt: args.salt,
      iterations: args.iterations,
      kdf: args.kdf,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    sessionToken: v.string(),
    credentialId: v.id("personalCredentials"),
    kind: v.optional(credentialKindValidator),
    service: v.optional(v.string()),
    title: v.optional(v.string()),
    username: v.optional(v.string()),
    url: v.optional(v.string()),
    ciphertext: v.optional(v.string()),
    iv: v.optional(v.string()),
    salt: v.optional(v.string()),
    iterations: v.optional(v.number()),
    kdf: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ownItem(ctx, args.sessionToken, args.credentialId);
    const kind = args.kind ?? item.kind;
    const patch: Partial<Doc<"personalCredentials">> = { kind, service: serviceOf(kind, args.service ?? item.service), updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = title(args.title);
    if (args.username !== undefined) patch.username = args.username.trim() || undefined;
    if (args.url !== undefined) patch.url = args.url.trim() || undefined;
    if (args.ciphertext !== undefined) {
      if (args.iv === undefined || args.salt === undefined || args.iterations === undefined || args.kdf === undefined) throw new Error("Send the whole encrypted value");
      Object.assign(patch, { ciphertext: args.ciphertext, iv: args.iv, salt: args.salt, iterations: args.iterations, kdf: args.kdf });
    }
    await ctx.db.patch(item._id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), credentialId: v.id("personalCredentials") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ownItem(ctx, args.sessionToken, args.credentialId);
    await ctx.db.delete(item._id);
    return null;
  },
});

/** Whether this person's agents may use the item, in any project, while they have their Vault unlocked on their computer. */
export const setAgentUse = mutation({
  args: { sessionToken: v.string(), credentialId: v.id("personalCredentials"), agentUse: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ownItem(ctx, args.sessionToken, args.credentialId);
    await ctx.db.patch(item._id, { agentUse: args.agentUse || undefined, updatedAt: Date.now() });
    return null;
  },
});
