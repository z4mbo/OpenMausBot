import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_OWNER_EMAIL, requireUser as requireAuthenticatedUser } from "./lib/auth";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { callSignalKindValidator } from "./lib/validators";

const voiceStaleMs = 30_000;

// Legacy unscoped communication is retained only for the original owner.
async function requireUser(ctx: MutationCtx | QueryCtx, sessionToken: string) {
  const user = await requireAuthenticatedUser(ctx, sessionToken);
  if (user.email !== DEFAULT_OWNER_EMAIL) throw new Error("Use workspace chat and calls");
  return user;
}

export const listMessages = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.sessionToken);
    const messages = await ctx.db
      .query("generalChatMessages")
      .withIndex("by_createdAt")
      .order("desc")
      .take(120);
    return await Promise.all(
      messages.reverse().map(async (message) => ({
        ...message,
        avatarUrl: message.avatarStorageId ? await ctx.storage.getUrl(message.avatarStorageId) : null,
      })),
    );
  },
});

export const sendMessage = mutation({
  args: { sessionToken: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const body = args.body.trim();
    if (!body) throw new Error("Message required");
    if (body.length > 4_000) throw new Error("Message is too long");
    await ctx.db.insert("generalChatMessages", {
      authorUserId: user._id,
      authorName: user.username || user.name || user.email,
      authorEmail: user.email,
      avatarStorageId: user.avatarStorageId,
      body,
      createdAt: Date.now(),
    });
  },
});

export const listVoiceParticipants = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx, args.sessionToken);
    const participants = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_lastSeenAt", (q) => q.gt("lastSeenAt", Date.now() - voiceStaleMs))
      .order("asc")
      .take(64);
    return await Promise.all(
      participants.map(async (participant) => ({
        ...participant,
        avatarUrl: participant.avatarStorageId ? await ctx.storage.getUrl(participant.avatarStorageId) : null,
      })),
    );
  },
});

export const joinVoice = mutation({
  args: {
    sessionToken: v.string(),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const now = Date.now();
    const existing = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const participant = {
      name: user.name || user.email,
      username: user.username,
      email: user.email,
      avatarStorageId: user.avatarStorageId,
      audioEnabled: args.audioEnabled,
      videoEnabled: args.videoEnabled,
      lastSeenAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, participant);
    } else {
      await ctx.db.insert("voiceParticipants", {
        userId: user._id,
        joinedAt: now,
        ...participant,
      });
    }
    return user._id;
  },
});

export const updateVoicePresence = mutation({
  args: {
    sessionToken: v.string(),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      audioEnabled: args.audioEnabled,
      videoEnabled: args.videoEnabled,
      lastSeenAt: Date.now(),
    });
    return existing._id;
  },
});

export const leaveVoice = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);

    const incoming = await ctx.db.query("voiceSignals").withIndex("by_to", (q) => q.eq("toUserId", user._id)).take(100);
    for (const signal of incoming) await ctx.db.delete(signal._id);

    const outgoing = await ctx.db.query("voiceSignals").withIndex("by_from", (q) => q.eq("fromUserId", user._id)).take(100);
    for (const signal of outgoing) await ctx.db.delete(signal._id);
  },
});

export const sendVoiceSignal = mutation({
  args: {
    sessionToken: v.string(),
    toUserId: v.id("users"),
    kind: callSignalKindValidator,
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    if (args.toUserId === user._id) throw new Error("Cannot signal yourself");
    if (!args.payload) throw new Error("Signal payload required");
    if (args.payload.length > 80_000) throw new Error("Signal payload too large");
    const recipient = await ctx.db
      .query("voiceParticipants")
      .withIndex("by_user", (q) => q.eq("userId", args.toUserId))
      .unique();
    if (!recipient || recipient.lastSeenAt < Date.now() - voiceStaleMs) throw new Error("Recipient is not in voice chat");
    await ctx.db.insert("voiceSignals", {
      fromUserId: user._id,
      toUserId: args.toUserId,
      kind: args.kind,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const listVoiceSignals = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    return await ctx.db
      .query("voiceSignals")
      .withIndex("by_to_and_createdAt", (q) => q.eq("toUserId", user._id))
      .order("asc")
      .take(120);
  },
});

export const ackVoiceSignals = mutation({
  args: { sessionToken: v.string(), signalIds: v.array(v.id("voiceSignals")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    for (const signalId of args.signalIds.slice(0, 120)) {
      const signal = await ctx.db.get(signalId);
      if (signal?.toUserId === user._id) await ctx.db.delete(signal._id);
    }
  },
});
