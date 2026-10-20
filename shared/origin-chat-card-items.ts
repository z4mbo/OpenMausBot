import { isBroadcastChannel, type BroadcastChannel, type BroadcastStatus } from "./broadcast.ts";
import { isCampaignStatus } from "./origin-campaigns.ts";
import type {
  OriginAssetCardItem, OriginCallCardItem, OriginCampaignCardItem, OriginCardMedia, OriginCardMediaKind, OriginFeedbackCardItem,
  OriginPostCardItem, OriginVaultCardItem,
} from "./origin-chat-cards.ts";

type Row = Record<string, unknown>;

const row = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? value as Row : {});
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(row) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const optional = <K extends string>(key: K, value: string): Partial<Record<K, string>> => (value ? { [key]: value } as Record<K, string> : {});
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

const POST_STATUSES = new Set<BroadcastStatus>(["draft", "scheduled", "publishing", "published", "failed"]);
const FEEDBACK_STATUSES = new Set(["new", "planned", "completed", "dismissed"]);
const TEXT_MAX = 4_000;

export function mediaKindOf(contentType: string, type = "", name = ""): OriginCardMediaKind {
  const lower = contentType.toLowerCase();
  if (lower.startsWith("image/") || type === "image" || type === "icon" || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name)) return "image";
  if (lower.startsWith("video/") || type === "video" || /\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  if (lower.startsWith("audio/") || type === "audio" || /\.(mp3|wav|m4a|ogg|flac)$/i.test(name)) return "audio";
  return "other";
}

export function postCardItem(value: unknown): OriginPostCardItem {
  const post = row(value);
  const status = text(post.status) as BroadcastStatus;
  return {
    id: text(post._id),
    status: POST_STATUSES.has(status) ? status : "draft",
    needsApproval: post.needsApproval === true,
    ...(post.format === "reel" ? { format: "reel" as const } : {}),
    ...optional("agentName", text(post.agentName)),
    ...(typeof post.scheduledAt === "number" ? { scheduledAt: post.scheduledAt } : {}),
    channels: rows(post.variants).filter((variant) => isBroadcastChannel(variant.channel)).map((variant) => ({
      channel: variant.channel as BroadcastChannel,
      text: clip(text(variant.text), TEXT_MAX),
      ...(text(variant.text).length > TEXT_MAX ? { truncated: true as const } : {}),
      ...(variant.result === "published" || variant.result === "failed" ? { result: variant.result } : {}),
      ...optional("url", text(variant.url)),
      ...optional("error", clip(text(variant.error), 240)),
    })),
    media: rows(post.media).map((item): OriginCardMedia => ({
      name: text(item.name), kind: item.kind === "image" || item.kind === "video" ? item.kind : mediaKindOf(text(item.contentType), "", text(item.name)),
      ...optional("url", text(item.url)),
    })),
  };
}

export function campaignCardItem(value: unknown): OriginCampaignCardItem {
  const campaign = row(value);
  const counts = row(campaign.counts);
  return {
    id: text(campaign._id),
    name: text(campaign.name),
    status: isCampaignStatus(campaign.status) ? campaign.status : "planning",
    ...optional("goal", clip(text(campaign.goal), 400)),
    ...optional("startDate", text(campaign.startDate)),
    ...optional("endDate", text(campaign.endDate)),
    channels: (Array.isArray(campaign.channels) ? campaign.channels : []).filter(isBroadcastChannel),
    ...optional("slug", text(campaign.slug)),
    counts: {
      posts: count(counts.posts), published: count(counts.published), generations: count(counts.generations),
      leads: count(counts.leads), won: count(counts.won), openIssues: count(counts.openIssues),
    },
  };
}

export function assetCardItem(value: unknown): OriginAssetCardItem {
  const asset = row(value);
  const type = text(asset.type) || "other";
  const url = text(asset.fileUrl) || text(asset.url);
  return {
    id: text(asset._id), name: text(asset.name), type, kind: mediaKindOf(text(asset.contentType), type, text(asset.name)),
    ...optional("url", url), ...optional("folder", text(asset.folder)),
  };
}

/** A credentials:list row reduced to what names it. Security: never reads a value, username, URL or note. */
export function vaultCardItem(value: unknown): OriginVaultCardItem {
  const item = row(value);
  return { id: text(item._id), title: text(item.title), kind: text(item.kind) || "secret", agentUse: item.agentUse === true };
}

export function feedbackCardItem(value: unknown): OriginFeedbackCardItem {
  const entry = row(value);
  const status = text(entry.status);
  return {
    id: text(entry._id), title: text(entry.title), body: clip(text(entry.body), 600), kind: entry.kind === "bug" ? "bug" : "idea",
    status: (FEEDBACK_STATUSES.has(status) ? status : "new") as OriginFeedbackCardItem["status"],
    ...optional("taskId", text(entry.taskId)), createdAt: count(entry.createdAt),
  };
}

export function callCardItem(value: unknown): OriginCallCardItem {
  const note = row(value);
  const strings = (list: unknown) => (Array.isArray(list) ? list.map(text).filter(Boolean) : []);
  return {
    id: text(note._id), callName: text(note.callName), startedAt: count(note.startedAt), minutes: count(note.minutes),
    keyPoints: strings(note.keyPoints), decisions: strings(note.decisions),
    actionItems: rows(note.actionItems).map((item) => ({ title: text(item.title), ...optional("owner", text(item.owner)), ...optional("taskId", text(item.taskId)) })),
  };
}
