import type {
  OriginAssetCardItem, OriginCallCardItem, OriginCardMediaKind, OriginFeedbackCardItem, OriginVaultCardItem,
} from "./origin-chat-cards.ts";

type Row = Record<string, unknown>;

const row = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? value as Row : {});
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.map(row) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const optional = <K extends string>(key: K, value: string): Partial<Record<K, string>> => (value ? { [key]: value } as Record<K, string> : {});
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

const FEEDBACK_STATUSES = new Set(["new", "planned", "completed", "dismissed"]);

export function mediaKindOf(contentType: string, type = "", name = ""): OriginCardMediaKind {
  const lower = contentType.toLowerCase();
  if (lower.startsWith("image/") || type === "image" || type === "icon" || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name)) return "image";
  if (lower.startsWith("video/") || type === "video" || /\.(mp4|mov|webm|m4v)$/i.test(name)) return "video";
  if (lower.startsWith("audio/") || type === "audio" || /\.(mp3|wav|m4a|ogg|flac)$/i.test(name)) return "audio";
  return "other";
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
