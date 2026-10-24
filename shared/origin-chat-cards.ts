export type OriginCardMediaKind = "image" | "video" | "audio" | "other";

/** A file a card previews. `url` is absent when the file has no address the app can load. */
export interface OriginCardMedia {
  name: string;
  kind: OriginCardMediaKind;
  url?: string;
}

export interface OriginAssetCardItem {
  id: string;
  name: string;
  /** The asset type a member chose (logo, image, video, document, …). */
  type: string;
  kind: OriginCardMediaKind;
  url?: string;
  folder?: string;
}

/** A vault entry as a card shows it. Security: a card never carries a value, username or note, only what names the entry. */
export interface OriginVaultCardItem {
  id: string;
  title: string;
  kind: string;
  agentUse: boolean;
}

export interface OriginRepoCardItem {
  /** owner/name. */
  slug: string;
  url: string;
  defaultBranch?: string;
  /** Whether the default branch requires a reviewed pull request; "unknown" when Origin could not read it. */
  protection: "on" | "off" | "unknown";
  pulls: Array<{ number: number; title: string; url: string; branch?: string; author?: string; draft?: boolean; checks?: string; review?: string }>;
  commits: Array<{ sha: string; message: string; author?: string; at?: number }>;
}

export interface OriginFeedbackCardItem {
  id: string;
  title: string;
  body: string;
  kind: "bug" | "idea";
  status: "new" | "planned" | "completed" | "dismissed";
  taskId?: string;
  createdAt: number;
}

export interface OriginCallCardItem {
  id: string;
  callName: string;
  startedAt: number;
  minutes: number;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ title: string; owner?: string; taskId?: string }>;
}

interface CardBase {
  projectId: string;
  projectName?: string;
}

/** An asset, vault entry, repository, feedback or call an Origin agent tool returned, drawn in chat as a card that opens it in its project. Clients that do not know a kind ignore it. */
export type OriginChatCard = CardBase & (
  | { kind: "assets"; heading: string; assets: OriginAssetCardItem[]; more?: number }
  | { kind: "vault"; items: OriginVaultCardItem[]; more?: number }
  | { kind: "repo"; repo: OriginRepoCardItem }
  | { kind: "feedback"; teamId: string; heading: string; entries: OriginFeedbackCardItem[]; more?: number }
  | { kind: "call"; note: OriginCallCardItem }
);

export type OriginChatCardKind = OriginChatCard["kind"];

/** How many items one card lists; the rest are counted in `more`. */
export const ORIGIN_CARD_ITEMS_MAX = 8;

function mapStrings(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]));
  return value;
}

export function redactOriginCard(card: OriginChatCard, redact: (text: string) => string): OriginChatCard {
  return mapStrings(card, redact) as OriginChatCard;
}

export function capped<T>(items: readonly T[], max = ORIGIN_CARD_ITEMS_MAX): { items: T[]; more?: number } {
  return items.length > max ? { items: items.slice(0, max), more: items.length - max } : { items: [...items] };
}
