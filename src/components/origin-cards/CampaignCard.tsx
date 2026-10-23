import { useState } from "react";
import { CheckCheck, Loader2, Megaphone, Play, ShieldCheck } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { campaignCardItem } from "../../../shared/origin-chat-card-items";
import type { OriginCampaignCardItem, OriginChatCard } from "../../../shared/origin-chat-cards";
import type { CampaignStatus } from "../../../shared/origin-campaigns";
import { CampaignProgress, CampaignStatusPill } from "../origin-broadcast/CampaignBits";
import { ChannelMark } from "../origin-broadcast/ChannelMark";
import { dateRange } from "../origin-broadcast/campaign-model";
import { errorText } from "../origin-pages/repo-url";
import { CardFrame, More, quietButton, rowButton, solidButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "campaign" }>;
type ListCard = Extract<OriginChatCard, { kind: "campaigns" }>;
type Live = { canEdit: boolean; campaigns: Array<{ _id: string }> };

function useLiveCampaigns(projectId: string) {
  const live = useCloudQuery<Live>("campaigns:list", { projectId });
  const fresh = (item: OriginCampaignCardItem) => {
    const row = live?.campaigns.find((candidate) => candidate._id === item.id);
    return row ? campaignCardItem(row) : item;
  };
  return { fresh, canEdit: live?.canEdit ?? false };
}

const NEXT: Partial<Record<CampaignStatus, { status: CampaignStatus; label: string; solid: boolean }>> = {
  planning: { status: "running", label: "Start campaign", solid: true },
  running: { status: "done", label: "Mark done", solid: false },
};

function CampaignActions({ projectId, campaign, onReview }: { projectId: string; campaign: OriginCampaignCardItem; onReview(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = NEXT[campaign.status];
  const approval = campaign.counts.approval ?? 0;
  if (!next && !approval) return null;
  const advance = async () => {
    if (!next) return;
    setBusy(true);
    setError("");
    try { await cloudMutation("campaigns:update", { projectId, campaignId: campaign.id, status: next.status }); } catch (cause) { setError(errorText(cause, "Could not change the campaign")); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 flex flex-col gap-1.5" role="group" aria-label="Campaign actions">
      <div className="flex flex-wrap items-center gap-2">
        {approval > 0 && (
          <button type="button" className={cn(quietButton, "text-warning")} onClick={onReview}>
            <ShieldCheck size={13} aria-hidden="true" />Review {approval} {approval === 1 ? "post" : "posts"}
          </button>
        )}
        {next && (
          <button type="button" className={cn(next.solid ? solidButton : quietButton, "ml-auto")} disabled={busy} onClick={() => void advance()}>
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : next.status === "running" ? <Play size={13} aria-hidden="true" /> : <CheckCheck size={13} aria-hidden="true" />}{next.label}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function CampaignCard({ card }: { card: Card }) {
  const { fresh, canEdit } = useLiveCampaigns(card.projectId);
  const campaign = fresh(card.campaign);
  const opener = useItemOpener(card.projectId);
  const open = () => opener.open({ kind: "campaign", itemId: campaign.id });
  const stats = [
    { label: "Studio pieces", value: String(campaign.counts.generations) },
    { label: "Open issues", value: String(campaign.counts.openIssues) },
    { label: "Need approval", value: String(campaign.counts.approval ?? 0) },
  ];
  return (
    <CardFrame kind="campaign" label={`Campaign ${campaign.name}`} icon={Megaphone}
      title={<span className="flex items-center gap-2"><span className="truncate">{campaign.name}</span><CampaignStatusPill status={campaign.status} className="rounded-md px-1.5 py-px" /></span>}
      meta={[card.projectName, dateRange(campaign), campaign.slug && `utm_campaign=${campaign.slug}`].filter(Boolean).join(" · ")}
      openLabel="Open campaign" onOpen={open} openable={opener.openable}>
      <button type="button" className={cn(rowButton, "-mx-2 mt-1.5 w-[calc(100%+1rem)] flex-col items-stretch gap-2")} onClick={open} disabled={!opener.openable} title={opener.title}>
        {campaign.goal && <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-secondary">{campaign.goal}</span>}
        <CampaignProgress published={campaign.counts.published} posts={campaign.counts.posts} />
        <dl className="grid grid-cols-3 gap-2">
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
      {canEdit && opener.openable && <CampaignActions projectId={card.projectId} campaign={campaign} onReview={() => opener.open({ kind: "post" })} />}
    </CardFrame>
  );
}

export function CampaignsCard({ card }: { card: ListCard }) {
  const { fresh } = useLiveCampaigns(card.projectId);
  const opener = useItemOpener(card.projectId);
  return (
    <CardFrame kind="campaigns" label={card.heading} icon={Megaphone} title={card.heading} meta={card.projectName}
      openLabel="Open campaigns" onOpen={() => opener.open({ kind: "campaign" })} openable={opener.openable}>
      <ul className="-mx-2 mt-2 flex flex-col gap-0.5" aria-label="Campaigns">
        {card.campaigns.map(fresh).map((campaign) => (
          <li key={campaign.id}>
            <button type="button" className={cn(rowButton, "flex-col items-stretch gap-1")} disabled={!opener.openable} title={opener.title}
              onClick={() => opener.open({ kind: "campaign", itemId: campaign.id })}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{campaign.name}</span>
                {(campaign.counts.approval ?? 0) > 0 && <span className="shrink-0 text-[11px] text-warning">{campaign.counts.approval} to approve</span>}
                <CampaignStatusPill status={campaign.status} className="rounded-md px-1.5 py-px" />
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {campaign.channels.length > 0 && <span className="flex shrink-0 items-center gap-1 text-ink-tertiary">{campaign.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={11} />)}</span>}
                <CampaignProgress published={campaign.counts.published} posts={campaign.counts.posts} className="flex-1" />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <More count={card.more} where="Campaigns" />
    </CardFrame>
  );
}
