import { useState, type ReactNode } from "react";
import {
  AudioLines, CalendarClock, Check, ChevronLeft, CircleDot, Copy, Film, Heart, Link2, MessageCircle, Megaphone, Pencil, Plus, RefreshCw, Repeat2, ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useItemFocus } from "@/lib/origin-item-focus";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { useCopyFeedback } from "@/lib/copy-text";
import { handOff } from "@/lib/origin-handoff";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { requestIssueFocus } from "@/lib/origin-issue-focus";
import { useShowThreads } from "@/lib/thread-preferences";
import { BROADCAST_RULES } from "../../../shared/broadcast";
import { originIssueKey } from "../../../shared/origin-issues";
import {
  CAMPAIGN_METRIC_CHANNELS, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUSES, type CampaignDetail, type CampaignLinkKind, type CampaignList, type CampaignPost, type CampaignStatus, type CampaignSummary,
} from "../../../shared/origin-campaigns";
import { EmptyState, Loading, Notice, Segmented, cardClass, ghostButton, iconButton, primaryButton } from "../origin-pages/ui";
import { ChannelMark } from "./ChannelMark";
import { CampaignProgress, CampaignStatusPill } from "./CampaignBits";
import { CampaignDialog, LinkDialog } from "./CampaignDialogs";
import { campaignBrief, campaignOrder, campaignPostTime, compactNumber, dateRange, metricFor, metricTotals, nextPostAt, timelineOrder, variantState, type VariantState } from "./campaign-model";
import type { BroadcastPost } from "./broadcast-model";

const VARIANT_TONE: Record<VariantState, string> = { published: "text-success", failed: "text-danger", scheduled: "text-accent-text", approval: "text-warning", draft: "text-ink-tertiary" };
const VARIANT_LABEL: Record<VariantState, string> = { published: "Published", failed: "Failed", scheduled: "Scheduled", approval: "Needs approval", draft: "Draft" };

const dateTimeOf = (at: number) => new Date(at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function CampaignsView({ projectId, projectName, canEdit, agent, posts, creating, onCreating, onOpenPost, onNewPost, onReviewApprovals }: {
  projectId: string;
  projectName: string;
  canEdit: boolean;
  agent: Bot;
  posts: readonly BroadcastPost[];
  creating: boolean;
  onCreating(open: boolean): void;
  onOpenPost(postId: string): void;
  onNewPost(campaignId: string): void;
  onReviewApprovals(campaignId: string): void;
}) {
  const data = useCloudQuery<CampaignList>("campaigns:list", { projectId });
  const [openId, setOpenId] = useState<string | null>(null);
  useItemFocus(projectId, {
    campaign: (campaignId) => {
      if (data?.campaigns.some((campaign) => campaign._id === campaignId)) setOpenId(campaignId);
      return true;
    },
  }, Boolean(data));
  if (!data) return <Loading label="Loading campaigns" variant="grid" />;
  const editable = canEdit && data.canEdit;
  const open = openId ? data.campaigns.find((campaign) => campaign._id === openId) : undefined;
  return (
    <>
      {open
        ? <CampaignDetailView key={open._id} projectId={projectId} projectName={projectName} summary={open} canEdit={editable} agent={agent} posts={posts}
          onBack={() => setOpenId(null)} onOpenPost={onOpenPost} onNewPost={() => onNewPost(open._id)} onReviewApprovals={() => onReviewApprovals(open._id)} />
        : <CampaignGrid campaigns={data.campaigns} posts={posts} canEdit={editable} onOpen={setOpenId} onNew={() => onCreating(true)} />}
      {creating && <CampaignDialog projectId={projectId} campaign={null} onClose={() => onCreating(false)} onSaved={(id) => { onCreating(false); setOpenId(id); }} />}
    </>
  );
}

type StatusFilter = CampaignStatus | "all";

function CampaignGrid({ campaigns, posts, canEdit, onOpen, onNew }: { campaigns: CampaignSummary[]; posts: readonly BroadcastPost[]; canEdit: boolean; onOpen(id: string): void; onNew(): void }) {
  const [status, setStatus] = useState<StatusFilter>("all");
  if (!campaigns.length) {
    return <EmptyState icon={<Megaphone size={22} />} title="No campaigns yet" body="Group a launch's posts, Studio content and issues, and let your Chief plan it."
      action={canEdit ? <button type="button" className={primaryButton} onClick={onNew}><Plus size={14} />New campaign</button> : undefined} />;
  }
  const count = (value: CampaignStatus) => campaigns.filter((campaign) => campaign.status === value).length;
  const shown = campaignOrder(campaigns.filter((campaign) => status === "all" || campaign.status === status));
  return (
    <div className="flex flex-col gap-3">
      {campaigns.length > 1 && (
        <div className="w-fit max-w-full overflow-x-auto [scrollbar-width:none]">
          <Segmented label="Filter campaigns" value={status} onChange={setStatus}
            options={[{ value: "all", label: <>All <span className="tabular-nums text-ink-tertiary">{campaigns.length}</span></> },
              ...CAMPAIGN_STATUSES.map((value) => ({ value, label: <>{CAMPAIGN_STATUS_LABEL[value]} <span className="tabular-nums text-ink-tertiary">{count(value)}</span></> }))]} />
        </div>
      )}
      {!shown.length ? <EmptyState compact icon={<Megaphone size={22} />} title={`No ${CAMPAIGN_STATUS_LABEL[status as CampaignStatus].toLowerCase()} campaigns`} /> : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((campaign) => {
            const next = nextPostAt(campaign, posts);
            const approval = campaign.counts.approval ?? 0;
            return (
              <button key={campaign._id} type="button" onClick={() => onOpen(campaign._id)} data-origin-item={campaign._id}
                className={cn(cardClass, "flex flex-col gap-2 p-3 text-left outline-none transition-[border-color,transform] duration-(--motion-fast) hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.99]")}>
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{campaign.name}</span>
                  <CampaignStatusPill status={campaign.status} />
                </span>
                {campaign.goal && <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-secondary">{campaign.goal}</span>}
                <CampaignProgress published={campaign.counts.published} posts={campaign.counts.posts} className="mt-auto" />
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] tabular-nums text-ink-tertiary">
                  {dateRange(campaign) && <span>{dateRange(campaign)}</span>}
                  {campaign.channels.length > 0 && <span className="flex items-center gap-1 text-ink-secondary">{campaign.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={11} />)}</span>}
                  {next !== undefined && <span className="inline-flex items-center gap-1 text-accent-text"><CalendarClock size={11} />Next {dateTimeOf(next)}</span>}
                  {approval > 0 && <span className="inline-flex items-center gap-1 text-warning"><ShieldCheck size={11} />{approval} to approve</span>}
                  {campaign.counts.openIssues > 0 && <span>{campaign.counts.openIssues} open {campaign.counts.openIssues === 1 ? "issue" : "issues"}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Sections = "studio" | "issues";

function CampaignDetailView({ projectId, projectName, summary, canEdit, agent, posts, onBack, onOpenPost, onNewPost, onReviewApprovals }: {
  projectId: string; projectName: string; summary: CampaignSummary; canEdit: boolean; agent: Bot; posts: readonly BroadcastPost[];
  onBack(): void; onOpenPost(postId: string): void; onNewPost(): void; onReviewApprovals(): void;
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
  const unlink = (kind: CampaignLinkKind, itemId: string) => void cloudMutation("campaigns:link", { projectId, campaignId: summary._id, kind, itemId, remove: true })
    .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not detach it"));
  const remove = async () => {
    if (!window.confirm(`Delete the campaign "${summary.name}"? Its posts, content and issues stay.`)) return;
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
          : <CampaignStatusPill status={summary.status} />}
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
          {(summary.counts.approval ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
              <ShieldCheck size={14} className="shrink-0" />
              <span className="min-w-0 flex-1">{summary.counts.approval} {summary.counts.approval === 1 ? "post an agent wrote waits" : "posts agents wrote wait"} for your approval.</span>
              <button type="button" className="rounded-md px-2 py-0.5 font-medium transition-colors duration-(--motion-fast) hover:bg-warning/15" onClick={onReviewApprovals}>Review</button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Timeline projectId={projectId} detail={detail} canEdit={canEdit} onOpenPost={onOpenPost} onLink={() => setLinking("post")} onNewPost={onNewPost} onUnlink={(postId) => unlink("post", postId)} />
              <Issues detail={detail} canEdit={canEdit} onLink={() => setLinking("issue")} onOpen={(issueId) => { requestIssueFocus({ projectId, issueId }); go("issues"); }} onUnlink={(issueId) => unlink("issue", issueId)} />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Gallery detail={detail} canEdit={canEdit} onLink={() => setLinking("generation")} onOpen={() => go("studio")} onUnlink={(generationId) => unlink("generation", generationId)} />
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
  const next = detail.posts.filter((post) => post.status === "scheduled" && post.scheduledAt !== undefined).map((post) => post.scheduledAt!).sort((a, b) => a - b)[0];
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Published", value: `${detail.counts.published}/${detail.counts.posts}`, note: detail.counts.posts ? `${Math.round((detail.counts.published / detail.counts.posts) * 100)}% out` : "No posts yet" },
    { label: "Next post", value: next !== undefined ? new Date(next).toLocaleDateString([], { day: "numeric", month: "short" }) : "–", note: next !== undefined ? new Date(next).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Nothing scheduled" },
    { label: "Engagement", value: compactNumber(totals.likes + totals.reposts + totals.replies), note: detail.metrics.length ? `${compactNumber(totals.likes)} likes · ${compactNumber(totals.reposts)} reposts` : "Not read yet" },
    { label: "Open issues", value: String(detail.counts.openIssues), note: detail.issues.length ? `of ${detail.issues.length}` : undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-inset/60 px-3 py-2.5">
          <span className="truncate text-[11.5px] text-ink-tertiary">{tile.label}</span>
          <span className="text-[17px] font-semibold sm:text-[19px] tabular-nums text-ink">{tile.value}</span>
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

function UnlinkButton({ label, onUnlink, className }: { label: string; onUnlink(): void; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onUnlink(); }}
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary opacity-0 transition-[opacity,background-color,color] duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100 max-sm:opacity-100", className)}>
      <X size={13} />
    </button>
  );
}

const linkButton = (onLink: () => void, label: string) => (
  <button type="button" className={cn(ghostButton, "h-7 px-2 text-[12px]")} onClick={onLink} aria-label={label} title={label}><Link2 size={13} />Link</button>
);

function Timeline({ projectId, detail, canEdit, onOpenPost, onLink, onNewPost, onUnlink }: {
  projectId: string; detail: CampaignDetail; canEdit: boolean; onOpenPost(postId: string): void; onLink(): void; onNewPost(): void; onUnlink(postId: string): void;
}) {
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
      {canEdit && <button type="button" className={cn(ghostButton, "h-7 px-2 text-[12px]")} onClick={onNewPost} aria-label="New post in this campaign" title="New post in this campaign"><Plus size={13} />Post</button>}
    </>}>
      {!posts.length ? <p className="rounded-xl bg-inset/60 px-3 py-4 text-[12.5px] text-ink-tertiary">No posts yet. Your Chief drafts them with the campaign, or link existing ones.</p> : (
        <ol className="relative flex flex-col gap-1.5 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-hairline/40">
          {posts.map((post) => <TimelineRow key={post._id} post={post} detail={detail} onOpen={() => onOpenPost(post._id)} onUnlink={canEdit ? () => onUnlink(post._id) : undefined} />)}
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

function TimelineRow({ post, detail, onOpen, onUnlink }: { post: CampaignPost; detail: CampaignDetail; onOpen(): void; onUnlink?(): void }) {
  const at = campaignPostTime(post);
  const states = post.variants.map((variant) => variantState(post, variant));
  const dot = states.includes("failed") ? "bg-danger" : states.every((state) => state === "published") ? "bg-success" : states.includes("approval") ? "bg-warning" : states.includes("scheduled") ? "bg-accent" : "bg-ink-tertiary/60";
  return (
    <li className="group relative pl-6">
      <span className={cn("absolute left-[3px] top-3.5 size-[9px] rounded-full", dot)} aria-hidden="true" />
      <button type="button" onClick={onOpen}
        className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-left outline-none transition-colors duration-(--motion-fast) hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="flex w-full items-center gap-2 text-[11.5px] text-ink-tertiary">
          <span className="tabular-nums text-ink-secondary">{at !== undefined ? dateTimeOf(at) : "Not scheduled"}</span>
          {post.needsApproval && <span className="inline-flex items-center gap-1 text-warning"><ShieldCheck size={11} />Needs approval</span>}
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
      {onUnlink && <UnlinkButton label="Detach from the campaign" onUnlink={onUnlink} className="absolute right-1.5 top-1.5" />}
    </li>
  );
}

function Gallery({ detail, canEdit, onLink, onOpen, onUnlink }: { detail: CampaignDetail; canEdit: boolean; onLink(): void; onOpen(): void; onUnlink(generationId: string): void }) {
  return (
    <Section title="Content" count={detail.generations.length} action={canEdit && linkButton(onLink, "Link Studio content")}>
      {!detail.generations.length ? <p className="rounded-xl bg-inset/60 px-3 py-4 text-[12.5px] text-ink-tertiary">No Studio content linked.</p> : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-3">
          {detail.generations.map((row) => (
            <div key={row._id} className="group relative">
              <button type="button" onClick={onOpen} title={row.prompt}
                className="relative block aspect-square w-full overflow-hidden rounded-lg bg-inset outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              {row.kind === "image" && row.output
                ? <img src={row.output} alt={row.prompt} loading="lazy" className="size-full object-cover transition-transform duration-(--motion-base) group-hover:scale-[1.03]" />
                : <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-ink-tertiary">
                  {row.kind === "video" ? <Film size={18} /> : row.kind === "audio" ? <AudioLines size={18} /> : <CircleDot size={18} />}
                  <span className="line-clamp-2 text-center text-[10.5px] leading-tight">{row.status === "done" ? row.modelLabel : row.status}</span>
                </span>}
              </button>
              {canEdit && <UnlinkButton label="Detach from the campaign" onUnlink={() => onUnlink(row._id)} className="absolute right-1 top-1 bg-panel/80" />}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Issues({ detail, canEdit, onLink, onOpen, onUnlink }: { detail: CampaignDetail; canEdit: boolean; onLink(): void; onOpen(issueId: string): void; onUnlink(issueId: string): void }) {
  const issues = [...detail.issues].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <Section title="Issues" count={issues.length} action={canEdit && linkButton(onLink, "Link issues")}>
      {!issues.length ? <p className="rounded-xl bg-inset/60 px-3 py-4 text-[12.5px] text-ink-tertiary">No issues yet. Plan with your Chief to break the campaign into issues.</p> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
          {issues.map((issue) => (
            <div key={issue._id} className="group flex min-w-0 items-center pr-1.5 transition-colors duration-(--motion-fast) hover:bg-raised/40 focus-within:bg-raised/40">
              <button type="button" onClick={() => onOpen(issue._id)}
                className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none">
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", issue.done ? "border-success bg-success/20 text-success" : "border-hairline")}>{issue.done && <Check size={10} />}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{issue.githubIssueNumber ? `#${issue.githubIssueNumber}` : originIssueKey(issue._id)}</span>
              <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", issue.done ? "text-ink-tertiary line-through" : "text-ink")}>{issue.title}</span>
              <span className="hidden shrink-0 text-[11.5px] text-ink-secondary sm:block">{issue.done ? "Done" : issue.column}</span>
              </button>
              {canEdit && <UnlinkButton label="Detach from the campaign" onUnlink={() => onUnlink(issue._id)} />}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
