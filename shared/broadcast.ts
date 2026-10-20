/** A social channel a Publish post can go to. */
export const BROADCAST_CHANNELS = ["x", "bluesky", "linkedin", "facebook", "instagram", "tiktok"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export type BroadcastStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export type BroadcastMediaKind = "image" | "video" | "other";

/** What a channel accepts. `limit` counts as `countText` does; `media` "video" means exactly one video and nothing else. */
export interface BroadcastChannelRules {
  label: string;
  limit: number;
  maxImages: number;
  video: boolean;
  media: "optional" | "required" | "video";
  /** The id `server/integration-keys.ts` stores this channel's credentials under. */
  integration: string;
}

export const BROADCAST_RULES: Record<BroadcastChannel, BroadcastChannelRules> = {
  x: { label: "X", limit: 280, maxImages: 4, video: true, media: "optional", integration: "x" },
  bluesky: { label: "Bluesky", limit: 300, maxImages: 4, video: false, media: "optional", integration: "bluesky" },
  linkedin: { label: "LinkedIn", limit: 3_000, maxImages: 20, video: false, media: "optional", integration: "linkedin" },
  facebook: { label: "Facebook", limit: 63_206, maxImages: 10, video: true, media: "optional", integration: "meta" },
  instagram: { label: "Instagram", limit: 2_200, maxImages: 10, video: true, media: "required", integration: "meta" },
  tiktok: { label: "TikTok", limit: 2_200, maxImages: 0, video: true, media: "video", integration: "tiktok" },
};

export function isBroadcastChannel(value: unknown): value is BroadcastChannel {
  return typeof value === "string" && (BROADCAST_CHANNELS as readonly string[]).includes(value);
}

/** X counts every link as 23 characters (t.co) and wide characters (CJK, emoji) as two. */
const X_LINK = /https?:\/\/\S+/g;
const X_LINK_WEIGHT = 23;
const X_NARROW: readonly (readonly [number, number])[] = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];
const xWeight = (char: string) => (X_NARROW.some(([low, high]) => char.codePointAt(0)! >= low && char.codePointAt(0)! <= high) ? 1 : 2);

type GraphemeSegmenter = new (locale: undefined, options: { granularity: "grapheme" }) => { segment(text: string): Iterable<{ segment: string }> };

function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: GraphemeSegmenter }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment) : Array.from(text);
}

/** The length a channel measures `text` by against its limit. */
export function countText(channel: BroadcastChannel, text: string): number {
  if (channel === "x") {
    let links = 0;
    const rest = text.replace(X_LINK, () => { links += 1; return ""; });
    return links * X_LINK_WEIGHT + Array.from(rest).reduce((sum, char) => sum + xWeight(char), 0);
  }
  if (channel === "bluesky") return graphemes(text).length;
  return Array.from(text).length;
}

export function mediaKindOf(contentType: string | undefined, name = ""): BroadcastMediaKind {
  const type = (contentType ?? "").toLowerCase();
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type.startsWith("video/")) return "video";
  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  return "other";
}

/** Why a channel would refuse this text and media, in words the person or an agent can act on; empty when it is fine. */
export function channelProblems(channel: BroadcastChannel, text: string, media: readonly BroadcastMediaKind[]): string[] {
  const rules = BROADCAST_RULES[channel];
  const problems: string[] = [];
  const length = countText(channel, text);
  if (!text.trim() && !media.length) problems.push(`${rules.label} needs text or media`);
  if (length > rules.limit) problems.push(`${rules.label} allows ${rules.limit} characters; this is ${length}`);
  problems.push(...hashtagProblems(channel, text));
  const images = media.filter((kind) => kind === "image").length;
  const videos = media.filter((kind) => kind === "video").length;
  if (media.some((kind) => kind === "other")) problems.push(`${rules.label} takes only images and videos`);
  if (rules.media === "video") {
    if (videos !== 1 || images) problems.push(`${rules.label} needs exactly one video`);
    return problems;
  }
  if (rules.media === "required" && !media.length) problems.push(`${rules.label} needs an image or a video`);
  if (videos && !rules.video) problems.push(`${rules.label} takes images only here`);
  if (videos > 1 || (videos && images)) problems.push(`${rules.label} takes one video on its own`);
  if (images > rules.maxImages) problems.push(`${rules.label} takes up to ${rules.maxImages} images`);
  return problems;
}

/** "reel" is one vertical video (Instagram Reels, TikTok, Facebook and X video) with a chosen cover frame. */
export type BroadcastFormat = "post" | "reel";

export const REEL_CHANNELS: readonly BroadcastChannel[] = ["instagram", "tiktok", "facebook", "x"];

/** A reel's extras: the cover frame's offset into the video, and the sound to add in the app (no channel's API attaches licensed music). */
export interface BroadcastReel {
  coverMs?: number;
  music?: string;
}

/** Engagement read back from a published post; `at` is when it was read. */
export interface BroadcastMetrics {
  likes: number;
  reposts: number;
  replies: number;
  impressions?: number;
  at: number;
}

/** Instagram refuses a caption with more than 30 hashtags. */
const HASHTAG_LIMITS: Partial<Record<BroadcastChannel, number>> = { instagram: 30 };
const HASHTAG = /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;

export function hashtagsOf(text: string): string[] {
  return [...new Set([...text.matchAll(HASHTAG)].map((match) => match[0]))];
}

export function hashtagLimit(channel: BroadcastChannel): number | undefined {
  return HASHTAG_LIMITS[channel];
}

/** Appends `#tag` on its own trailing line, unless the text already carries it. */
export function withHashtag(text: string, tag: string): string {
  const clean = `#${tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;
  if (clean === "#" || hashtagsOf(text).some((existing) => existing.toLowerCase() === clean.toLowerCase())) return text;
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return clean;
  return /(^|\n)(#[\p{L}\p{N}_]+ ?)+$/u.test(trimmed) ? `${trimmed} ${clean}` : `${trimmed}\n\n${clean}`;
}

export function withoutHashtag(text: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?![\\p{L}\\p{N}_])`, "giu"), "").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

/** Why a reel cannot go out as it stands; empty when it can. */
export function reelProblems(channels: readonly BroadcastChannel[], media: readonly BroadcastMediaKind[]): string[] {
  const problems: string[] = [];
  const off = channels.filter((channel) => !REEL_CHANNELS.includes(channel));
  if (off.length) problems.push(`${off.map((channel) => BROADCAST_RULES[channel].label).join(" and ")} ${off.length === 1 ? "does" : "do"} not take reels`);
  if (media.length !== 1 || media[0] !== "video") problems.push("A reel is exactly one video");
  return problems;
}

export function hashtagProblems(channel: BroadcastChannel, text: string): string[] {
  const limit = HASHTAG_LIMITS[channel];
  const count = hashtagsOf(text).length;
  return limit !== undefined && count > limit ? [`${BROADCAST_RULES[channel].label} allows ${limit} hashtags; this has ${count}`] : [];
}

/** One weekly slot, in the viewer's local time: 0 is Sunday. */
export interface BroadcastSlot {
  weekday: number;
  hour: number;
}

export interface BestTime extends BroadcastSlot {
  /** Mean engagement of the posts measured in this slot; absent for a typical slot. */
  score?: number;
  posts: number;
}

/** Weekly slots that tend to do well on each channel, offered until a project has measured posts of its own. */
export const TYPICAL_SLOTS: Record<BroadcastChannel, readonly BroadcastSlot[]> = {
  x: [{ weekday: 2, hour: 9 }, { weekday: 3, hour: 12 }, { weekday: 4, hour: 9 }],
  bluesky: [{ weekday: 2, hour: 10 }, { weekday: 3, hour: 14 }, { weekday: 4, hour: 10 }],
  linkedin: [{ weekday: 2, hour: 8 }, { weekday: 3, hour: 10 }, { weekday: 4, hour: 9 }],
  facebook: [{ weekday: 1, hour: 9 }, { weekday: 3, hour: 13 }, { weekday: 5, hour: 9 }],
  instagram: [{ weekday: 1, hour: 11 }, { weekday: 3, hour: 11 }, { weekday: 5, hour: 10 }],
  tiktok: [{ weekday: 2, hour: 18 }, { weekday: 4, hour: 19 }, { weekday: 6, hour: 11 }],
};

/** Below this many measured posts on a channel the typical slots are offered instead. */
export const BEST_TIME_MIN_POSTS = 3;

export function engagementScore(metrics: Omit<BroadcastMetrics, "at">): number {
  return metrics.likes + 2 * metrics.reposts + 3 * metrics.replies + (metrics.impressions ?? 0) / 100;
}

/**
 * The weekly slots whose published posts on `channels` drew the most engagement, best first, in local time.
 * `measured` is false when there are too few measured posts and the slots are the channels' typical ones.
 */
export function bestTimes(
  samples: readonly { channel: BroadcastChannel; publishedAt: number; metrics: Omit<BroadcastMetrics, "at"> }[],
  channels: readonly BroadcastChannel[],
  count = 3,
): { measured: boolean; slots: BestTime[] } {
  const relevant = samples.filter((sample) => channels.includes(sample.channel));
  if (relevant.length >= BEST_TIME_MIN_POSTS) {
    const slots = new Map<string, { weekday: number; hour: number; total: number; posts: number }>();
    for (const sample of relevant) {
      const at = new Date(sample.publishedAt);
      const key = `${at.getDay()}-${at.getHours()}`;
      const slot = slots.get(key) ?? { weekday: at.getDay(), hour: at.getHours(), total: 0, posts: 0 };
      slot.total += engagementScore(sample.metrics);
      slot.posts += 1;
      slots.set(key, slot);
    }
    return {
      measured: true,
      slots: [...slots.values()].map(({ total, ...slot }) => ({ ...slot, score: total / slot.posts }))
        .sort((a, b) => b.score - a.score || b.posts - a.posts).slice(0, count),
    };
  }
  const typical = new Map<string, BestTime>();
  for (const channel of channels.length ? channels : BROADCAST_CHANNELS) {
    for (const slot of TYPICAL_SLOTS[channel]) typical.set(`${slot.weekday}-${slot.hour}`, { ...slot, posts: 0 });
  }
  return { measured: false, slots: [...typical.values()].slice(0, count) };
}

/** The next time `slot` comes round after `now`, in local time. */
export function nextSlot(slot: BroadcastSlot, now = Date.now()): number {
  const at = new Date(now);
  at.setHours(slot.hour, 0, 0, 0);
  at.setDate(at.getDate() + ((slot.weekday - at.getDay() + 7) % 7));
  if (at.getTime() <= now) at.setDate(at.getDate() + 7);
  return at.getTime();
}

/** One account a member's app can publish to a channel with, as GET /api/origin/broadcast/accounts lists it; it never carries a key. */
export interface BroadcastAccount {
  id: string;
  integration: "x" | "bluesky" | "linkedin" | "meta" | "tiktok";
  channels: BroadcastChannel[];
  label: string;
  /** The key saved under Settings, Integrations; the others were added as extra accounts. */
  isDefault: boolean;
  /** The projects an extra account is offered in; null for every project. */
  projectIds: string[] | null;
  source: "yours" | "shared";
}
