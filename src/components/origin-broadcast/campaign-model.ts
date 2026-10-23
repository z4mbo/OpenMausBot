import { BROADCAST_RULES } from "../../../shared/broadcast";
import type { CampaignDetail, CampaignMetric, CampaignPost, CampaignSummary } from "../../../shared/origin-campaigns";
import type { BroadcastPost } from "./broadcast-model";

export type CampaignForm = {
  name: string;
  goal: string;
  audience: string;
  channels: CampaignSummary["channels"];
  startDate: string;
  endDate: string;
  budgetNote: string;
};

export const emptyCampaignForm = (): CampaignForm => ({ name: "", goal: "", audience: "", channels: [], startDate: "", endDate: "", budgetNote: "" });

export function formOf(campaign: CampaignSummary): CampaignForm {
  return {
    name: campaign.name, goal: campaign.goal, audience: campaign.audience, channels: campaign.channels,
    startDate: campaign.startDate ?? "", endDate: campaign.endDate ?? "", budgetNote: campaign.budgetNote ?? "",
  };
}

/** What the form says is wrong, or "" when it can be saved. */
export function formProblem(form: CampaignForm): string {
  if (!form.name.trim()) return "Name the campaign";
  if (form.startDate && form.endDate && form.endDate < form.startDate) return "The end date is before the start date";
  return "";
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });

export function dateRange(campaign: Pick<CampaignSummary, "startDate" | "endDate">): string {
  if (campaign.startDate && campaign.endDate) return `${dayLabel(campaign.startDate)} – ${dayLabel(campaign.endDate)}`;
  if (campaign.startDate) return `From ${dayLabel(campaign.startDate)}`;
  if (campaign.endDate) return `Until ${dayLabel(campaign.endDate)}`;
  return "";
}

/** The brief a Chief plans the campaign from: it breaks the work into issues and drafts the creatives and posts. */
export function campaignBrief(campaign: CampaignSummary, projectName: string): string {
  const facts = [
    campaign.goal.trim() && `Goal: ${campaign.goal.trim()}`,
    campaign.audience.trim() && `Audience: ${campaign.audience.trim()}`,
    campaign.channels.length ? `Channels: ${campaign.channels.map((channel) => BROADCAST_RULES[channel].label).join(", ")}` : "",
    dateRange(campaign) && `Dates: ${[campaign.startDate, campaign.endDate].filter(Boolean).join(" to ")}`,
    campaign.budgetNote && `Budget: ${campaign.budgetNote}`,
    `utm_campaign: ${campaign.slug}`,
  ].filter(Boolean);
  const { posts, generations, openIssues } = campaign.counts;
  const linked = posts || generations || openIssues ? `Already linked: ${posts} posts, ${generations} generations, ${openIssues} open issues (read them with origin_campaign_get).` : "";
  return [
    `Plan the "${campaign.name}" campaign in ${projectName} (campaign id ${campaign._id}).`,
    facts.join("\n"),
    linked,
    "Break it into Origin issues with origin_create_issue and attach each with origin_campaign_link, handing them to the right agents. "
      + "Make the creatives with origin_studio_generate and attach the keepers; draft the posts per channel with origin_broadcast_draft and attach them too. "
      + `Tag every link to the site with utm_campaign=${campaign.slug} so its traffic counts toward it. `
      + "Posts wait for my approval in Publish, so tell me when they are ready, and set the campaign to running with origin_campaign_create when it starts.",
  ].filter(Boolean).join("\n\n");
}

/** When a campaign post goes or went out: its schedule, else its latest publish. */
export function campaignPostTime(post: CampaignPost): number | undefined {
  const published = post.variants.reduce((latest, variant) => Math.max(latest, variant.publishedAt ?? 0), 0);
  return post.scheduledAt ?? (published || undefined);
}

/** Posts in the order they go out; the ones with no time yet come last. */
export function timelineOrder(posts: readonly CampaignPost[]): CampaignPost[] {
  return [...posts].sort((a, b) => (campaignPostTime(a) ?? Infinity) - (campaignPostTime(b) ?? Infinity));
}

export type VariantState = "published" | "failed" | "scheduled" | "approval" | "draft";

export function variantState(post: CampaignPost, variant: CampaignPost["variants"][number]): VariantState {
  if (variant.result) return variant.result;
  if (post.needsApproval) return "approval";
  return post.status === "scheduled" || post.status === "publishing" ? "scheduled" : "draft";
}

export function metricFor(detail: Pick<CampaignDetail, "metrics">, postId: string, channel: string): CampaignMetric | undefined {
  return detail.metrics.find((metric) => metric.postId === postId && metric.channel === channel);
}

export function metricTotals(metrics: readonly CampaignMetric[]): { likes: number; reposts: number; replies: number } {
  return metrics.reduce((sum, metric) => ({ likes: sum.likes + metric.likes, reposts: sum.reposts + metric.reposts, replies: sum.replies + metric.replies }), { likes: 0, reposts: 0, replies: 0 });
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat([], { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const STATUS_RANK: Record<CampaignSummary["status"], number> = { running: 0, planning: 1, done: 2 };

/** Running campaigns first, then the ones being planned, then the finished; each group as the backend sorted it. */
export function campaignOrder<T extends Pick<CampaignSummary, "status">>(campaigns: readonly T[]): T[] {
  return campaigns.map((campaign, index) => ({ campaign, index }))
    .sort((a, b) => STATUS_RANK[a.campaign.status] - STATUS_RANK[b.campaign.status] || a.index - b.index).map(({ campaign }) => campaign);
}

/** When the campaign's next scheduled post goes out, from the posts it lists. */
export function nextPostAt(campaign: Pick<CampaignSummary, "postIds">, posts: readonly Pick<BroadcastPost, "_id" | "status" | "scheduledAt">[]): number | undefined {
  const linked = new Set(campaign.postIds ?? []);
  const times = posts.filter((post) => linked.has(post._id) && post.status === "scheduled" && post.scheduledAt !== undefined).map((post) => post.scheduledAt!);
  return times.length ? Math.min(...times) : undefined;
}
