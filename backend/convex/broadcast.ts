import { v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { canEdit, requireMember } from "./lib/permissions";
import { broadcastChannel, broadcastFormat, broadcastReel, needsApproval, type broadcastVariant } from "./broadcastTables";
import { channelProblems, mediaKindOf, reelProblems, type BroadcastFormat, type BroadcastMediaKind } from "../../shared/broadcast";

type Ctx = QueryCtx | MutationCtx;
type Variant = Infer<typeof broadcastVariant>;
type Reel = Infer<typeof broadcastReel>;

const POSTS_SHOWN = 300;
const ASSETS_MAX = 20;
const TEXT_MAX = 64_000;
const AGENT_NAME_MAX = 120;
const SCHEDULE_AHEAD_MS = 400 * 86_400_000;
const CLAIM_BATCH = 5;
const ACCOUNT_MAX = 120;
const MUSIC_MAX = 200;
const COVER_MAX_MS = 3 * 3_600_000;
/** A claim older than this means the publishing app stopped mid-way; the channels it did not report may or may not have the post. */
const CLAIM_STALE_MS = 10 * 60_000;

const variantInput = v.object({ channel: broadcastChannel, text: v.string(), accountId: v.optional(v.string()), accountLabel: v.optional(v.string()) });
const metricInput = v.object({ postId: v.id("broadcastPosts"), channel: broadcastChannel, likes: v.number(), reposts: v.number(), replies: v.number(), impressions: v.optional(v.number()) });
const agentInput = v.object({ botId: v.string(), name: v.string() });
const resultInput = v.object({ channel: broadcastChannel, ok: v.boolean(), url: v.optional(v.string()), error: v.optional(v.string()) });

async function editorOf(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

async function postFor(ctx: Ctx, postId: Id<"broadcastPosts">, sessionToken: string) {
  const post = await ctx.db.get(postId);
  if (!post) throw new Error("Post not found");
  return { post, ...await editorOf(ctx, post.projectId, sessionToken) };
}

async function mediaOf(ctx: Ctx, projectId: Id<"projects">, assetIds: readonly Id<"designAssets">[]) {
  const media = [];
  for (const assetId of assetIds) {
    const asset = await ctx.db.get(assetId);
    if (!asset || asset.projectId !== projectId) continue;
    const url = asset.storageId ? await ctx.storage.getUrl(asset.storageId) : asset.url ?? null;
    media.push({ assetId, name: asset.name, url, contentType: asset.contentType ?? null, kind: mediaKindOf(asset.contentType, asset.name) });
  }
  return media;
}


type VariantInput = { channel: Variant["channel"]; text: string; accountId?: string; accountLabel?: string };

function accountOf(input: VariantInput): Pick<Variant, "accountId" | "accountLabel"> {
  const accountId = input.accountId?.trim().slice(0, ACCOUNT_MAX);
  if (!accountId) return {};
  return { accountId, ...(input.accountLabel?.trim() ? { accountLabel: input.accountLabel.trim().slice(0, ACCOUNT_MAX) } : {}) };
}

/** A variant ready to publish again: its text and account, without a previous attempt's outcome. */
const pending = (variant: Variant): Variant => variant.result === "published" ? variant
  : { channel: variant.channel, text: variant.text, ...(variant.accountId ? { accountId: variant.accountId } : {}), ...(variant.accountLabel ? { accountLabel: variant.accountLabel } : {}) };

function cleanReel(format: BroadcastFormat, reel: Reel | undefined): Reel | undefined {
  if (format !== "reel" || !reel) return undefined;
  const coverMs = reel.coverMs !== undefined && Number.isFinite(reel.coverMs) ? Math.round(Math.min(Math.max(reel.coverMs, 0), COVER_MAX_MS)) : undefined;
  const music = reel.music?.trim().slice(0, MUSIC_MAX);
  return { ...(coverMs !== undefined ? { coverMs } : {}), ...(music ? { music } : {}) };
}

function cleanVariants(input: readonly VariantInput[], previous: readonly Variant[]): Variant[] {
  if (!input.length) throw new Error("Choose at least one channel");
  const seen = new Set<string>();
  return input.map((item) => {
    const { channel, text } = item;
    if (seen.has(channel)) throw new Error(`${channel} is listed twice`);
    seen.add(channel);
    if (text.length > TEXT_MAX) throw new Error("Post text is too long");
    const before = previous.find((variant) => variant.channel === channel);
    return before?.result === "published" ? before : { channel, text, ...accountOf(item) };
  });
}

function problemsOf(post: Pick<Doc<"broadcastPosts">, "variants" | "format">, media: readonly BroadcastMediaKind[]): string[] {
  const open = post.variants.filter((variant) => variant.result !== "published");
  return [
    ...(post.format === "reel" ? reelProblems(open.map((variant) => variant.channel), media) : []),
    ...open.flatMap((variant) => channelProblems(variant.channel, variant.text, media)),
  ];
}

export const list = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const posts = await ctx.db.query("broadcastPosts").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(POSTS_SHOWN);
    return {
      canEdit: canEdit(member),
      posts: await Promise.all(posts.map(async (post) => ({ ...post, media: await mediaOf(ctx, post.projectId, post.assetIds), needsApproval: needsApproval(post) }))),
    };
  },
});

export const save = mutation({
  args: {
    sessionToken: v.string(), projectId: v.id("projects"), postId: v.optional(v.id("broadcastPosts")),
    variants: v.array(variantInput), assetIds: v.array(v.id("designAssets")), agent: v.optional(agentInput),
    format: v.optional(broadcastFormat), reel: v.optional(broadcastReel),
  },
  returns: v.id("broadcastPosts"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    if (args.assetIds.length > ASSETS_MAX) throw new Error(`A post takes up to ${ASSETS_MAX} files`);
    for (const assetId of args.assetIds) {
      const asset = await ctx.db.get(assetId);
      if (!asset || asset.projectId !== args.projectId) throw new Error("A media file is not one of this project's assets");
    }
    const agent = args.agent ? { botId: args.agent.botId.slice(0, AGENT_NAME_MAX), name: args.agent.name.trim().slice(0, AGENT_NAME_MAX) || "Agent" } : null;
    const now = Date.now();
    const format = args.format ?? "post";
    const reel = cleanReel(format, args.reel);
    if (!args.postId) {
      return ctx.db.insert("broadcastPosts", {
        projectId: args.projectId, variants: cleanVariants(args.variants, []), assetIds: [...new Set(args.assetIds)], status: "draft",
        ...(format === "reel" ? { format, ...(reel ? { reel } : {}) } : {}),
        authorUserId: user._id, ...(agent ? { agentName: agent.name, agentBotId: agent.botId } : {}), createdAt: now, updatedAt: now,
      });
    }
    const post = await ctx.db.get(args.postId);
    if (!post || post.projectId !== args.projectId) throw new Error("Post not found");
    if (post.status === "publishing") throw new Error("This post is being published");
    if (post.status === "published") throw new Error("This post is already published");
    await ctx.db.patch(post._id, {
      variants: cleanVariants(args.variants, post.variants), assetIds: [...new Set(args.assetIds)], updatedAt: now,
      ...(args.format !== undefined ? { format: args.format === "reel" ? "reel" as const : undefined, reel } : {}),
      ...(post.status === "failed" ? { status: "draft" as const } : {}),
      ...(agent ? {
        agentName: agent.name, agentBotId: agent.botId, approvedBy: undefined, approvedAt: undefined,
        ...(post.status === "scheduled" ? { status: "draft" as const, scheduledAt: undefined, publisherUserId: undefined } : {}),
      } : {}),
    });
    return post._id;
  },
});

export const approve = mutation({
  args: { sessionToken: v.string(), postId: v.id("broadcastPosts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { post, user } = await postFor(ctx, args.postId, args.sessionToken);
    if (!post.agentName) throw new Error("Only an agent's post needs approval");
    await ctx.db.patch(post._id, { approvedBy: user._id, approvedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

export const schedule = mutation({
  args: { sessionToken: v.string(), postId: v.id("broadcastPosts"), at: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { post, user } = await postFor(ctx, args.postId, args.sessionToken);
    if (post.status === "publishing" || post.status === "published") throw new Error(`This post is already ${post.status}`);
    if (needsApproval(post)) throw new Error("A person must approve this post before it is scheduled");
    const media = await mediaOf(ctx, post.projectId, post.assetIds);
    if (media.some((item) => !item.url)) throw new Error("A media file has no address to publish from");
    const problems = problemsOf(post, media.map((item) => item.kind));
    if (problems.length) throw new Error(problems.join("; "));
    const now = Date.now();
    const at = Math.max(args.at ?? now, now);
    if (!Number.isFinite(at) || at > now + SCHEDULE_AHEAD_MS) throw new Error("Choose a time within a year");
    await ctx.db.patch(post._id, {
      status: "scheduled", scheduledAt: at, publisherUserId: user._id, updatedAt: now,
      variants: post.variants.map(pending),
    });
    return at;
  },
});

export const unschedule = mutation({
  args: { sessionToken: v.string(), postId: v.id("broadcastPosts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { post } = await postFor(ctx, args.postId, args.sessionToken);
    if (post.status !== "scheduled") throw new Error("This post is not scheduled");
    await ctx.db.patch(post._id, { status: "draft", scheduledAt: undefined, publisherUserId: undefined, updatedAt: Date.now() });
    return null;
  },
});

/** Moves a scheduled post to another time, keeping who publishes it. */
export const reschedule = mutation({
  args: { sessionToken: v.string(), postId: v.id("broadcastPosts"), at: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { post } = await postFor(ctx, args.postId, args.sessionToken);
    if (post.status !== "scheduled") throw new Error("Only a scheduled post can be moved");
    const now = Date.now();
    if (!Number.isFinite(args.at) || args.at <= now) throw new Error("Choose a time in the future");
    if (args.at > now + SCHEDULE_AHEAD_MS) throw new Error("Choose a time within a year");
    await ctx.db.patch(post._id, { scheduledAt: args.at, updatedAt: now });
    return args.at;
  },
});

const METRICS_BATCH = 200;
const metricCount = (value: number) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Stores the engagement a member's app read back from the channels for this project's published posts. */
export const recordMetrics = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), metrics: v.array(metricInput) },
  returns: v.number(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    if (args.metrics.length > METRICS_BATCH) throw new Error(`Record up to ${METRICS_BATCH} numbers at once`);
    const at = Date.now();
    let recorded = 0;
    for (const postId of new Set(args.metrics.map((metric) => metric.postId))) {
      const post = await ctx.db.get(postId);
      if (!post || post.projectId !== args.projectId) continue;
      const variants = post.variants.map((variant) => {
        const metric = args.metrics.find((item) => item.postId === postId && item.channel === variant.channel);
        if (!metric || variant.result !== "published") return variant;
        recorded += 1;
        return {
          ...variant,
          metrics: {
            likes: metricCount(metric.likes), reposts: metricCount(metric.reposts), replies: metricCount(metric.replies), at,
            ...(metric.impressions !== undefined ? { impressions: metricCount(metric.impressions) } : {}),
          },
        };
      });
      await ctx.db.patch(post._id, { variants });
    }
    return recorded;
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), postId: v.id("broadcastPosts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { post } = await postFor(ctx, args.postId, args.sessionToken);
    if (post.status === "publishing") throw new Error("This post is being published");
    await ctx.db.delete(post._id);
    return null;
  },
});

/** Hands the caller's app the posts it scheduled that are now due, marking them publishing so no other run takes them. */
export const claimDue = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const now = Date.now();
    const stale = await ctx.db.query("broadcastPosts").withIndex("by_status_and_claimedAt", (q) => q.eq("status", "publishing").lt("claimedAt", now - CLAIM_STALE_MS)).take(20);
    for (const post of stale) {
      if (post.publisherUserId !== user._id) continue;
      await ctx.db.patch(post._id, {
        status: "failed", claimedAt: undefined, updatedAt: now,
        variants: post.variants.map((variant) => variant.result ? variant : { ...variant, result: "failed" as const, error: "Publishing stopped part-way; check the channel before trying again" }),
      });
    }
    const due = await ctx.db.query("broadcastPosts").withIndex("by_status_and_scheduledAt", (q) => q.eq("status", "scheduled").lte("scheduledAt", now)).take(100);
    const claimed = [];
    for (const post of due.filter((candidate) => candidate.publisherUserId === user._id).slice(0, CLAIM_BATCH)) {
      const access = await requireMember(ctx, post.projectId, args.sessionToken).catch(() => null);
      if (!access || !canEdit(access.member) || needsApproval(post)) {
        await ctx.db.patch(post._id, {
          status: "failed", updatedAt: now,
          variants: post.variants.map((variant) => variant.result ? variant : { ...variant, result: "failed" as const, error: access ? "Waiting for a person's approval" : "The publisher no longer edits this project" }),
        });
        continue;
      }
      await ctx.db.patch(post._id, { status: "publishing", claimedAt: now, updatedAt: now });
      claimed.push({
        postId: post._id, projectId: post.projectId, format: post.format ?? "post", ...(post.reel ? { reel: post.reel } : {}),
        variants: post.variants.filter((variant) => variant.result !== "published").map(({ channel, text, accountId }) => ({ channel, text, ...(accountId ? { accountId } : {}) })),
        media: await mediaOf(ctx, post.projectId, post.assetIds),
      });
    }
    return claimed;
  },
});

export const finish = mutation({
  args: { sessionToken: v.string(), postId: v.id("broadcastPosts"), results: v.array(resultInput) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const post = await ctx.db.get(args.postId);
    if (!post || post.status !== "publishing" || post.publisherUserId !== user._id) throw new Error("This post is not being published by you");
    const now = Date.now();
    const variants = post.variants.map((variant): Variant => {
      const result = args.results.find((item) => item.channel === variant.channel);
      if (!result || variant.result === "published") return variant;
      return result.ok
        ? { ...pending(variant), result: "published", publishedAt: now, ...(result.url ? { url: result.url.slice(0, 2_000) } : {}) }
        : { ...pending(variant), result: "failed", error: (result.error ?? "Publishing failed").slice(0, 1_000) };
    });
    await ctx.db.patch(post._id, { variants, status: variants.every((variant) => variant.result === "published") ? "published" : "failed", claimedAt: undefined, updatedAt: now });
    return null;
  },
});
