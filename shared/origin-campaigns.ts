import type { BroadcastChannel, BroadcastStatus } from "./broadcast.ts";

export const CAMPAIGN_STATUSES = ["planning", "running", "done"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { planning: "Planning", running: "Running", done: "Done" };

export const CAMPAIGN_LINK_KINDS = ["post", "generation", "issue"] as const;
export type CampaignLinkKind = (typeof CAMPAIGN_LINK_KINDS)[number];

/** Per kind, how many items one campaign links by hand. */
export const CAMPAIGN_LINKS_MAX = 200;

export const CAMPAIGN_LIMITS = { name: 120, goal: 2_000, audience: 1_000, budget: 300, slug: 60 } as const;

/** Channels whose post metrics are read on demand with the member's own keys. */
export const CAMPAIGN_METRIC_CHANNELS: readonly BroadcastChannel[] = ["x", "bluesky"];

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

export function isCampaignLinkKind(value: unknown): value is CampaignLinkKind {
  return typeof value === "string" && (CAMPAIGN_LINK_KINDS as readonly string[]).includes(value);
}

/** The `utm_campaign` value of a campaign name: lower-case words joined by hyphens. */
export function campaignSlug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, CAMPAIGN_LIMITS.slug).replace(/-+$/, "") || "campaign";
}

/** The `utm_campaign` of a page address, lower-cased, or null. */
export function utmCampaignOf(page: string | undefined): string | null {
  if (!page) return null;
  const match = /[?&#]utm_campaign=([^&#\s]*)/i.exec(page);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].replace(/\+/g, " ")).trim().toLowerCase() || null;
  } catch {
    return match[1].trim().toLowerCase() || null;
  }
}

export type CampaignMetric = { postId: string; channel: BroadcastChannel; likes: number; reposts: number; replies: number; impressions?: number; at: number };

export type CampaignPost = {
  _id: string;
  status: BroadcastStatus;
  needsApproval: boolean;
  scheduledAt?: number;
  excerpt: string;
  variants: { channel: BroadcastChannel; result?: "published" | "failed"; url?: string; error?: string; publishedAt?: number }[];
};

export type CampaignGeneration = { _id: string; kind: "image" | "video" | "audio"; status: "queued" | "running" | "done" | "failed"; prompt: string; modelLabel: string; output?: string; createdAt: number };

export type CampaignIssue = { _id: string; title: string; done: boolean; column: string; priority: string; githubIssueNumber?: number; assignee?: string };

export type CampaignSummary = {
  _id: string;
  name: string;
  slug: string;
  goal: string;
  audience: string;
  channels: BroadcastChannel[];
  startDate?: string;
  endDate?: string;
  budgetNote?: string;
  status: CampaignStatus;
  agentName?: string;
  /** The linked Publish posts; absent from backends that predate it. */
  postIds?: string[];
  /** `approval`: linked posts an agent wrote that no person approved yet; absent from backends that predate it. */
  counts: { posts: number; published: number; generations: number; openIssues: number; approval?: number };
  createdAt: number;
  updatedAt: number;
};

export type CampaignDetail = CampaignSummary & {
  posts: CampaignPost[];
  generations: CampaignGeneration[];
  issues: CampaignIssue[];
  metrics: CampaignMetric[];
  metricsAt?: number;
};

export type CampaignList = { canEdit: boolean; campaigns: CampaignSummary[] };
