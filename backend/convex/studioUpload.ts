"use node";
// Convex's upload route is an HTTP action, whose request body stops at 20 MB, and its storage has no append or
// multipart upload, so a larger Studio output arrives in pieces and is joined here. Node actions get 512 MiB of
// memory against 64 MiB in the default runtime, room for a 150 MB file and its pieces.
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/** Joins pieces the member just uploaded into one project file and returns its storage id; the pieces are deleted. */
export const assemble = action({
  args: { projectId: v.id("projects"), sessionToken: v.string(), chunks: v.array(v.id("_storage")), contentType: v.string() },
  returns: v.id("_storage"),
  handler: async (ctx, args): Promise<Id<"_storage">> => {
    await ctx.runMutation(internal.studio.claimChunks, { projectId: args.projectId, sessionToken: args.sessionToken, chunks: args.chunks });
    const parts: Blob[] = [];
    for (const chunk of args.chunks) {
      const part = await ctx.storage.get(chunk);
      if (!part) throw new Error("A piece of the upload is gone");
      parts.push(part);
    }
    const storageId = await ctx.storage.store(new Blob(parts, { type: args.contentType }));
    try {
      await ctx.runMutation(internal.studio.finishAssembly, { ...args, storageId });
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
    for (const chunk of args.chunks) await ctx.storage.delete(chunk);
    return storageId;
  },
});
