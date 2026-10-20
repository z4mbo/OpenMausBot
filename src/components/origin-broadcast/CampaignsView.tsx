import { useState, type ReactNode } from "react";
import {
  AudioLines, Check, ChevronLeft, CircleDot, Copy, Film, Heart, Link2, MessageCircle, Megaphone, Pencil, Plus, RefreshCw, Repeat2, Sparkles, Trash2,
} from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { handOff } from "@/lib/origin-handoff";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { requestIssueFocus } from "@/lib/origin-issue-focus";
import { requestLeadFocus } from "@/lib/origin-lead-focus";
import { openSales } from "@/lib/origin-publish-mode";
import { useShowThreads } from "@/lib/thread-preferences";
import { BROADCAST_RULES } from "../../../shared/broadcast";
import { originIssueKey } from "../../../shared/origin-issues";
import { formatLeadValue } from "../../../shared/origin-pipeline";
import {
  CAMPAIGN_METRIC_CHANNELS, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUSES, type CampaignDetail, type CampaignLinkKind, type CampaignList, type CampaignPost, type CampaignStatus, type CampaignSummary,
} from "../../../shared/origin-campaigns";
import { EmptyState, Loading, Notice, Segmented, cardClass, ghostButton, iconButton, primaryButton } from "../origin-pages/ui";
import { ChannelMark } from "./ChannelMark";
import { CampaignDialog, LinkDialog } from "./CampaignDialogs";
import { campaignBrief, campaignPostTime, compactNumber, dateRange, metricFor, metricTotals, timelineOrder, variantState, type VariantState } from "./campaign-model";
import type { BroadcastPost } from "./broadcast-model";

const STATUS_TONE: Record<CampaignStatus, string> = { planning: "bg-raised text-ink-secondary", running: "bg-accent/15 text-accent-text", done: "bg-success/15 text-success" };
const VARIANT_TONE: Record<VariantState, string> = { published: "text-success", failed: "text-danger", scheduled: "text-accent-text", approval: "text-warning", draft: "text-ink-tertiary" };
const VARIANT_LABEL: Record<VariantState, string> = { published: "Published", failed: "Failed", scheduled: "Scheduled", approval: "Needs approval", draft: "Draft" };

function StatusPill({ status }: { status: CampaignStatus }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[status])}>{CAMPAIGN_STATUS_LABEL[status]}</span>;
}

const dateTimeOf = (at: number) => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CampaignsView({ projectId, projectName, canEdit, agent, posts, creating, onCreating, onOpenPost }: {
  projectId: string;
  projectName: string;
  canEdit: boolean;
  agent: Bot;
  posts: readonly BroadcastPost[];
  creating: boolean;
  onCreating(open: boolean): void;
  onOpenPost(postId: string): void;
}) {
  const data = useCloudQuery<CampaignList>("campaigns:list", { projectId });
  const [openId, setOpenId] = useState<string | null>(null);
  if (!data) return <Loading label="Loading campaigns" variant="grid" />;
  const editable = canEdit && data.canEdit;
  const open = openId ? data.campaigns.find((campaign) => campaign._id === openId) : undefined;
  return (
    <>
      {open
        ? <CampaignDetailView key={open._id} projectId={projectId} projectName={projectName} summary={open} canEdit={editable} agent={agent} posts={posts}
          onBack={() => setOpenId(null)} onOpenPost={onOpenPost} />
        : <CampaignGrid campaigns={data.campaigns} canEdit={editable} onOpen={setOpenId} onNew={() => onCreating(true)} />}
      {creating && <CampaignDialog projectId={projectId} campaign={null} onClose={() => onCreating(false)} onSaved={(id) => { onCreating(false); setOpenId(id); }} />}
    </>
  );
}

function CampaignGrid({ campaigns, canEdit, onOpen, onNew }: { campaigns: CampaignSummary[]; canEdit: boolean; onOpen(id: string): void; onNew(): void }) {
  if (!campaigns.length) {
    return <EmptyState icon={<Megaphone size={22} />} title="No campaigns yet" body="Group a launch's posts, Studio content, leads and issues, and let your Chief plan it."
      action={canEdit ? <button type="button" className={primaryButton} onClick={onNew}><Plus size={14} />New campaign</button> : undefined} />;
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {campaigns.map((campaign) => (
        <button key={campaign._id} type="button" onClick={() => onOpen(campaign._id)}
          className={cn(cardClass, "flex flex-col gap-2 p-3 text-left outline-none transition-[border-color,transform] duration-(--motion-fast) hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.99]")}>
          <span className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{campaign.name}</span>
            <StatusPill status={campaign.status} />
          </span>
          {campaign.goal && <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-secondary">{campaign.goal}</span>}
          <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums text-ink-tertiary">
            {dateRange(campaign) && <span>{dateRange(campaign)}</span>}
            {campaign.channels.length > 0 && <span className="flex items-center gap-1 text-ink-secondary">{campaign.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={11} />)}</span>}
            <span>{campaign.counts.published}/{campaign.counts.posts} posts</span>
            <span>{campaign.counts.leads} leads</span>
            {campaign.counts.openIssues > 0 && <span>{campaign.counts.openIssues} open</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

type Sections = "studio" | "issues";

function CampaignDetailView({ projectId, projectName, summary, canEdit, agent, posts, onBack, onOpenPost }: {
  projectId: string; projectName: string; summary: CampaignSummary; canEdit: boolean; agent: Bot; posts: readonly BroadcastPost[]; onBack(): void; onOpenPost(postId: string): void;
}) {
  const detail = useCloudQuery<CampaignDetail | null>("campaigns:get", { projectId, campaignId: summary._id });
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState<CampaignLinkKind | null>(null);
  const [error, setError] = useState("");
  const utm = useCopyFeedback(summary.slug);
  const go = (section: Sections) => setChiefSectionOf(agent.id, section);
  const setStatus = (status: CampaignStatus) => void cloudMutation("campaigns:update", { projectId, campaignId: summary._id, status }).catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not change the status"));
  const remove = async () => {
    if (!window.confirm(`Delete the campaign "${summary.name}"? Its posts, content, leads and issues stay.`)) return;
    try {
      await cloudMutation("campaigns:remove", { projectId, campaignId: summary._id });
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the campaign");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(iconButton, "-ml-1.5")} aria-label="All campaigns" title="All campaigns" onClick={onBack}><ChevronLeft size={16} /></button>
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink max-sm:basis-[calc(100%-2.5rem)]">{summary.name}</h3>
        {canEdit
          ? <Segmented label="Campaign status" value={summary.status} onChange={setStatus} options={CAMPAIGN_STATUSES.map((status) => ({ value: status, label: CAMPAIGN_STATUS_LABEL[status] }))} />
          : <StatusPill status={summary.status} />}
        {canEdit && <button type="button" className={iconButton} aria-label="Edit campaign" title="Edit" onClick={() => setEditing(true)}><Pencil size={15} /></button>}
        {canEdit && <button type="button" className={iconButton} aria-label="Delete campaign" title="Delete" onClick={() => void remove()}><Trash2 size={15} /></button>}
        {canEdit && <button type="button" className={primaryButton} onClick={() => handOff(dispatch, agent, campaignBrief(summary, projectName), showThreads)}><Sparkles size={14} />Plan with {agent.name}</button>}
      </div>

      <div className={cn(cardClass, "flex flex-col gap-2 px-4 py-3")}>
        {summary.goal ? <p className="whitespace-pre-wrap text-[13.5px] text-ink">{summary.goal}</p> : <p className="text-[13px] text-ink-tertiary">No goal yet</p>}
        {summary.audience && <p className="whitespace-pre-wrap text-[12.5px] text-ink-secondary">{summary.audience}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-tertiary">
          {dateRange(summary) && <span className="tabular-nums">{dateRange(summary)}</span>}
          {summary.channels.length > 0 && <span className="flex items-center gap-1.5 text-ink-secondary">{summary.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={12} />)}</span>}
          {summary.budgetNote && <span>{summary.budgetNote}</span>}
          <button type="button" onClick={utm.copy} title="Copy the utm_campaign value"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink">
            utm_campaign={summary.slug}{utm.state === "copied" ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>
          {summary.agentName && <span>by {summary.agentName}</span>}
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {detail === undefined ? <Loading label="Loading campaign" variant="list" /> : detail === null ? <Notice tone="danger">This campaign was deleted.</Notice> : (
        <>
          <Stats detail={detail} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Timeline projectId={projectId} detail={detail} canEdit={canEdit} onOpenPost={onOpenPost} onLink={() => setLinking("post")} />
              <Issues detail={detail} canEdit={canEdit} onLink={() => setLinking("issue")} onOpen={(issueId) => { requestIssueFocus({ projectId, issueId }); go("issues"); }} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Gallery detail={detail} canEdit={canEdit} onLink={() => setLinking("generation")} onOpen={() => go("studio")} />
              <Leads detail={detail} canEdit={canEdit} onLink={() => setLinking("lead")} onOpen={(leadId) => { requestLeadFocus({ projectId, leadId }); openSales(agent.id); }} />
            </div>
          </div>
          {linking && <LinkDialog projectId={projectId} detail={detail} kind={linking} posts={posts} onClose={() => setLinking(null)} />}
        </>
      )}
      {editing && <CampaignDialog projectId={projectId} campaign={summary} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

function Stats({ detail }: { detail: CampaignDetail }) {
  const totals = metricTotals(detail.metrics);
  const won = detail.stages.find((row) => row.stage === "Won");
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Posts published", value: `${detail.counts.published}/${detail.counts.posts}` },
    { label: "Engagement", value: compactNumber(totals.likes + totals.reposts + totals.replies), note: detail.metrics.length ? `${compactNumber(totals.likes)} likes · ${compactNumber(totals.reposts)} reposts` : "Not read yet" },
    { label: "Leads", value: String(detail.leads.length), note: won?.count ? `${won.count} won${won.value ? ` · ${formatLeadValue(won.value, detail.currency)}` : ""}` : undefined },
    { label: "Open issues", value: String(detail.counts.openIssues), note: detail.issues.length ? `of ${detail.issues.length}` : undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-inset/60 px-3 py-2.5">
          <span className="text-[11.5px] text-ink-tertiary">{tile.label}</span>
          <span className="text-[19px] font-semibold tabular-nums text-ink">{tile.value}</span>
          <span className="min-h-[16px] truncate text-[11.5px] tabular-nums text-ink-secondary">{tile.note ?? ""}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-8 items-center gap-2">
        <h4 className="text-[12.5px] font-medium text-ink-secondary">{title} <span className="tabular-nums text-ink-tertiary">{count}</span></h4>
        <div className="ml-auto flex items-center gap-1">{action}</div>
      </div>
      {children}
    </section>
  );
}

const linkButton = (onLink: () => void, label: string) => (
  <button type="button" className={cn(ghostButton, "h-7 px-2 text-[12px]")} onClick={onLink} aria-label={label} title={label}><Link2 size={13} />Link</button>
);

function Timeline({ projectId, detail, canEdit, onOpenPost, onLink }: { projectId: string; detail: CampaignDetail; canEdit: boolean; onOpenPost(postId: string): void; onLink(): void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const publishedOn = new Set(detail.posts.flatMap((post) => post.variants.filter((variant) => variant.result === "published").map((variant) => variant.channel)));
  const readable = [...publishedOn].some((channel) => CAMPAIGN_METRIC_CHANNELS.includes(channel));
  const unread = [...publishedOn].filter((channel) => !CAMPAIGN_METRIC_CHANNELS.includes(channel)).map((channel) => BROADCAST_RULES[channel].label);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await api<{ read: number; notes: string[] }>("/api/origin/campaigns/metrics", { method: "POST", body: JSON.stringify({ projectId, campaignId: detail._id }) });
      setNotes(result.notes);
    } catch (err) {
      setNotes([err instanceof Error ? err.message : "Could not read the numbers"]);
    } finally {
      setRefreshing(false);
    }
  };
  const posts = timelineOrder(detail.posts);
  return (
    <Section title="Timeline" count={posts.length} action={<>
      {canEdit && readable && (
        <button type="button" className={cn(ghostButton, "h-7 px-2 text-[12px]")} onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh metrics"
          title={detail.metricsAt ? `Numbers read ${dateTimeOf(detail.metricsAt)}` : "Read likes and reposts"}>
          <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />{detail.metricsAt ? dateTimeOf(detail.metricsAt) : "Metrics"}
        </button>
      )}
      {canEdit && linkButton(onLink, "Link posts")}
    </>}>
      {!posts.length ? <p className="rounded-xl bg-inset/60 px-3 py-4 text-[12.5px] text-ink-tertiary">No posts yet. Your Chief drafts them with the campaign, or link existing ones.</p> : (
        <ol className="relative flex flex-col gap-1.5 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-hairline/40">
          {posts.map((post) => <TimelineRow key={post._id} post={post} detail={detail} onOpen={() => onOpenPost(post._id)} />)}
        </ol>
      )}
      {(notes.length > 0 || unread.length > 0) && (
        <div className="flex flex-col gap-0.5 text-[11.5px] text-ink-tertiary">
          {notes.map((note) => <span key={note} className="text-warning">{note}</span>)}
          {unread.length > 0 && <span>{unread.join(", ")} numbers need an API review; only X and Bluesky are read here.</span>}
        </div>
      )}
    </Section>
  );
}

function TimelineRow({ post, detail, onOpen }: { post: CampaignPost; detail: CampaignDetail; onOpen(): void }) {
  const at = campaignPostTime(post);
  const states = post.variants.map((variant) => variantState(post, variant));
  const dot = states.includes("failed") ? "bg-danger" : states.every((state) => state === "published") ? "bg-success" : states.includes("approval") ? "bg-warning" : states.includes("scheduled") ? "bg-accent" : "bg-ink-tertiary/60";
  return (
    <li className="relative pl-6">
      <span className={cn("absolute left-[3px] top-3.5 size-[9px] rounded-full", dot)} aria-hidden="true" />
      <button type="button" onClick={onOpen}
        className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-left outline-none transition-colors duration-(--motion-fast) hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="flex w-full items-center gap-2 text-[11.5px] text-ink-tertiary">
          <span className="tabular-nums text-ink-secondary">{at !== undefined ? dateTimeOf(at) : "Not scheduled"}</span>
        </span>
        <span className="line-clamp-2 text-[12.5px] leading-snug text-ink">{post.excerpt || "Media post"}</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {post.variants.map((variant, index) => {
            const metric = metricFor(detail, post._id, variant.channel);
            return (
              <span key={variant.channel} className={cn("flex items-center gap-1 text-[11.5px]", VARIANT_TONE[states[index]])} title={`${BROADCAST_RULES[variant.channel].label} · ${VARIANT_LABEL[states[index]]}${variant.error ? `: ${variant.error}` : ""}`}>
                <ChannelMark channel={variant.channel} size={11} />
                <span>{VARIANT_LABEL[states[index]]}</span>
                {metric && (
                  <span className="ml-1 flex items-center gap-2 tabular-nums text-ink-secondary">
                    <span className="flex items-center gap-0.5"><Heart size={11} />{compactNumber(metric.likes)}</span>
                    <span className="flex items-center gap-0.5"><Repeat2 size={11} />{compactNumber(metric.reposts)}</span>
                    <span className="flex items-center gap-0.5"><MessageCircle size={11} />{compactNumber(metric.replies)}</span>
                  </span>
                )}
              </span>
            );
          })}
        </span>
      </button>
    </li>
  );
}

function Gallery({ detail, canEdit, onLink, onOpen }: { detail: CampaignDetail; canEdit: boolean; onLink(): void; onOpen(): void }) {
  return (
    <Section title="Content" count={detail.generations.length} action={canEdit && linkButton(onLink, "Link Studio content")}>
      {!detail.generations.length ? <p className="rounded-xl bg-inset/60 px-3 py-4 text-[12.5px] text-ink-tertiary">No Studio content linked.</p> : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-3">
          {detail.generations.map((row) => (
            <button key={row._id} type="button" onClick={onOpen} title={row.prompt}
              className="group relative aspect-square overflow-hidden rounded-lg bg-inset outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              {row.kind === "image" && row.output
                ? <img src={row.output} alt={row.prompt} loading="lazy" className="size-full object-cover transition-transform duration-(--motion-base) group-hover:scale-[1.03]" />
                : <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-ink-tertiary">
                  {row.kind === "video" ? <Film size={18} /> : row.kind === "audio" ? <AudioLines size={18} /> : <CircleDot size={18} />}
                  <span className="line-clamp-2 text-center text-[10.5px] leading-tight">{row.status === "done" ? row.modelLabel : row.status}</span>
                </span>}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function Leads({ detail, canEdit, onLink, onOpen }: { detail: CampaignDetail; canEdit: boolean; onLink(): void; onOpen(leadId: string): void }) {
  const max = Math.max(1, ...detail.stages.map((row) => row.count));
  return (
    <Section title="Leads" count={detail.leads.length} action={canEdit && linkButton(onLink, "Link leads")}>
      <div className="flex flex-col gap-1 rounded-xl bg-inset/60 px-3 py-2.5">
        {detail.stages.map((row) => (
          <div key={row.stage} className="grid grid-cols-[72px_minmax(0,1fr)_28px] items-center gap-2 text-[11.5px]">
            <span className="truncate text-ink-secondary">{row.stage}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-raised">
              <span className={cn("block h-full rounded-full transition-[width] duration-(--motion-base)", row.stage === "Lost" ? "bg-ink-tertiary/50" : "bg-accent")} style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-ink">{row.count}</span>
          </div>
        ))}
      </div>
      {detail.leads.length === 0
        ? <p className="text-[11.5px] text-ink-tertiary">Leads count here when captured with source or utm_campaign {detail.slug}.</p>
        : (
          <div className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
            {detail.leads.slice(0, 12).map((lead) => (
              <button key={lead._id} type="button" onClick={() => onOpen(lead._id)}
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/40 focus-visible:bg-raised/40">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{lead.name}{lead.company && <span className="text-ink-tertiary"> · {lead.company}</span>}</span>
                <span className="shrink-0 text-[11.5px] text-ink-secondary">{lead.stage}</span>
              </button>
            ))}
            {detail.leads.length > 12 && <span className="block px-3 py-2 text-[11.5px] text-ink-tertiary">{detail.leads.length - 12} more in Pipeline</span>}
          </div>
        )}
    </Section>
  );
}

function Issues({ detail, canEdit, onLink, onOpen }: { detail: CampaignDetail; canEdit: boolean; onLink(): void; onOpen(issueId: string): void }) {
  const issues = [...detail.issues].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <Section title="Issues" count={issues.length} action={canEdit && linkButton(onLink, "Link issues")}>
      {!issues.length ? <p className="rounded-xl bg-inset/60 px-3 py-4 text-[12.5px] text-ink-tertiary">No issues yet. Plan with your Chief to break the campaign into issues.</p> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
          {issues.map((issue) => (
            <button key={issue._id} type="button" onClick={() => onOpen(issue._id)}
              className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/40 focus-visible:bg-raised/40">
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", issue.done ? "border-success bg-success/20 text-success" : "border-hairline")}>{issue.done && <Check size={10} />}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : originIssueKey(issue._id)}</span>
              <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", issue.done ? "text-ink-tertiary line-through" : "text-ink")}>{issue.title}</span>
              <span className="hidden shrink-0 text-[11.5px] text-ink-secondary sm:block">{issue.done ? "Done" : issue.column}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
