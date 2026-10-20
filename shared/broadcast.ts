/** A social channel a Broadcast post can go to. */
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
