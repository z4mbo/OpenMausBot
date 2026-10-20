import { Megaphone } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { CAMPAIGN_STATUS_LABEL } from "../../../shared/origin-campaigns";
import { campaignCardItem } from "../../../shared/origin-chat-card-items";
import type { OriginChatCard } from "../../../shared/origin-chat-cards";
import { ChannelMark } from "../origin-broadcast/ChannelMark";
import { CardFrame, rowButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "campaign" }>;

const STATUS_TONE = { planning: "bg-raised/70 text-ink-secondary", running: "bg-accent/12 text-accent-text", done: "bg-success/12 text-success" } as const;

export function CampaignCard({ card }: { card: Card }) {
  const live = useCloudQuery<{ campaigns: Array<{ _id: string }> }>("campaigns:list", { projectId: card.projectId });
  const row = live?.campaigns.find((candidate) => candidate._id === card.campaign.id);
  const campaign = row ? campaignCardItem(row) : card.campaign;
  const opener = useItemOpener(card.projectId);
  const open = () => opener.open({ kind: "campaign", itemId: campaign.id });
  const dates = [campaign.startDate, campaign.endDate].filter(Boolean).join(" – ");
  const stats = [
    { label: "Posts published", value: `${campaign.counts.published}/${campaign.counts.posts}` },
    { label: "Studio pieces", value: String(campaign.counts.generations) },
    { label: "Leads won", value: `${campaign.counts.won}/${campaign.counts.leads}` },
    { label: "Open issues", value: String(campaign.counts.openIssues) },
  ];
  return (
    <CardFrame kind="campaign" label={`Campaign ${campaign.name}`} icon={Megaphone}
      title={<span className="flex items-center gap-2"><span className="truncate">{campaign.name}</span>
        <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium", STATUS_TONE[campaign.status])}>{CAMPAIGN_STATUS_LABEL[campaign.status]}</span></span>}
      meta={[card.projectName, dates, campaign.slug && `utm_campaign=${campaign.slug}`].filter(Boolean).join(" · ")}
      openLabel="Open campaign" onOpen={open} openable={opener.openable}>
      <button type="button" className={cn(rowButton, "mt-1.5 flex-col items-stretch gap-2 px-1")} onClick={open} disabled={!opener.openable} title={opener.title}>
        {campaign.goal && <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-secondary">{campaign.goal}</span>}
        <dl className="grid grid-cols-4 gap-2">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="truncate text-[11px] text-ink-tertiary">{stat.label}</dt>
              <dd className="text-[14px] font-semibold tabular-nums text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {campaign.channels.length > 0 && (
          <span className="flex items-center gap-1.5 text-ink-tertiary" aria-label={`Channels: ${campaign.channels.join(", ")}`}>
            {campaign.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={12} />)}
          </span>
        )}
      </button>
    </CardFrame>
  );
}
