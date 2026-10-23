import { useCallback, useState, type ReactNode } from "react";
import { Select } from "../Select";
import {
  AlertTriangle, CalendarClock, CalendarDays, CalendarRange, Clapperboard, Copy, Heart, List, Loader2, Megaphone, MessageCircle, Plus, Repeat2, RotateCcw, RotateCw, Search, Send, ShieldCheck, X,
} from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useItemFocus } from "@/lib/origin-item-focus";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { BROADCAST_CHANNELS, BROADCAST_RULES, type BroadcastFormat } from "../../../shared/broadcast";
import type { CampaignList, CampaignSummary } from "../../../shared/origin-campaigns";
import { CloudGate, EmptyState, Loading, PageHeader, Segmented, cardClass, ghostButton, iconButton, inputClass, pageClass, primaryButton, useAction, type OriginPageProps } from "../origin-pages/ui";
import { BroadcastComposer } from "./BroadcastComposer";
import { Channels, MonthView, StatusPill, WeekView, dateTimeOf, excerpt } from "./BroadcastCalendar";
import { CampaignsView } from "./CampaignsView";
import { ChannelMark } from "./ChannelMark";
import { compactNumber } from "./campaign-model";
import {
  campaignsByPost, listOrder, matchesFilter, matchesSearch, monthStart, movedTo, postTime, publishOverview, weekStart,
  type BroadcastList, type BroadcastPost, type ListFilter, type PostCampaign,
} from "./broadcast-model";
import { duplicatePost, publishNow } from "./post-actions";
import { useBroadcastAccounts, type ChannelAccounts } from "./use-broadcast-accounts";

export function BroadcastPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Publish">{({ project, projectId, canEdit }) => <Broadcast key={projectId} projectId={projectId} projectName={project.name} canEdit={canEdit} agent={agent} />}</CloudGate>;
}

type View = "month" | "week" | "list";
type Opened = { postId: string } | { postId: null; slot?: number; format?: BroadcastFormat; campaignId?: string };

function Broadcast({ projectId, projectName, canEdit: projectEdit, agent }: { projectId: string; projectName: string; canEdit: boolean; agent: Bot }) {
  const data = useCloudQuery<BroadcastList>("broadcast:list", { projectId });
  const campaignData = useCloudQuery<CampaignList>("campaigns:list", { projectId });
  const accounts = useBroadcastAccounts(projectId);
  const { dispatch } = useStore();
  const [mode, setMode] = useState<"posts" | "campaigns">("posts");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [view, setView] = useState<View>("week");
  const [week, setWeek] = useState(() => weekStart(Date.now()));
  const [month, setMonth] = useState(() => monthStart(Date.now()));
  const [filter, setFilter] = useState<ListFilter>("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Opened | null>(null);
  const moving = useAction();
  const connect = useCallback(() => dispatch({ type: "toggleAppSettings", open: true, section: "integrations" }), [dispatch]);
  useItemFocus(projectId, {
    post: (postId) => {
      setMode("posts");
      if (data?.posts.some((candidate) => candidate._id === postId)) setOpen({ postId });
      return true;
    },
    campaign: () => { setMode("campaigns"); return false; },
  }, Boolean(data));
  if (!data) return <Loading label="Loading posts" variant="board" />;
  const canEdit = projectEdit && data.canEdit;
  const posts = data.posts;
  const campaigns = campaignData?.campaigns ?? [];
  const byPost = campaignsByPost(campaigns);
  const opened = open?.postId ? posts.find((post) => post._id === open.postId) : null;
  const showList = (next: ListFilter, campaignId = "all") => { setMode("posts"); setView("list"); setFilter(next); setCampaignFilter(campaignId); setSearch(""); };
  const move = (post: BroadcastPost, day: Date) => void moving.run(() => cloudMutation("broadcast:reschedule", { postId: post._id, at: movedTo(post.scheduledAt!, day) }), "Could not move the post");
  const views = (
    <Segmented label="Publish view" value={view} onChange={setView}
      options={[{ value: "month", label: <><CalendarRange size={13} /><span className="max-sm:sr-only">Month</span></> }, { value: "week", label: <><CalendarDays size={13} /><span className="max-sm:sr-only">Week</span></> }, { value: "list", label: <><List size={13} /><span className="max-sm:sr-only">List</span></> }]} />
  );
  const calendar = { posts, canEdit, onOpen: (post: BroadcastPost) => setOpen({ postId: post._id }), onNew: (slot: number) => setOpen({ postId: null, slot }), onMove: move, toolbar: views };

  return (
    <section className={pageClass} aria-label="Publish">
      <PageHeader title="Publish">
        <Segmented label="Publish section" value={mode} onChange={setMode}
          options={[{ value: "posts", label: <><Send size={13} />Posts</> }, { value: "campaigns", label: <><Megaphone size={13} />Campaigns</> }]} />
        {canEdit && (mode === "posts" ? <>
          <button type="button" className={cn(ghostButton, "max-sm:ml-auto")} aria-label="New reel" title="New reel" onClick={() => setOpen({ postId: null, format: "reel" })}><Clapperboard size={14} /><span className="max-sm:hidden">New reel</span></button>
          <button type="button" className={primaryButton} onClick={() => setOpen({ postId: null })}><Plus size={14} />New post</button>
        </> : <button type="button" className={cn(primaryButton, "max-sm:ml-auto")} onClick={() => setCreatingCampaign(true)}><Plus size={14} />New campaign</button>)}
      </PageHeader>

      {mode === "posts" && <AccountsStrip accounts={accounts} onConnect={connect} />}
      {mode === "posts" && posts.length > 0 && <Overview posts={posts} active={view === "list" && campaignFilter === "all" ? filter : null} onPick={(next) => showList(next)} />}
      {moving.error && <p role="alert" className="mb-3 text-[12.5px] text-danger">{moving.error}</p>}

      {mode === "campaigns" ? <>
        <CampaignsView projectId={projectId} projectName={projectName} canEdit={canEdit} agent={agent} posts={posts} creating={creatingCampaign} onCreating={setCreatingCampaign}
          onOpenPost={(postId) => setOpen({ postId })} onNewPost={(campaignId) => setOpen({ postId: null, campaignId })} onReviewApprovals={(campaignId) => showList("approval", campaignId)} />
      </> : view === "month" ? <MonthView start={month} onStart={setMonth} {...calendar} />
        : view === "week" ? <WeekView start={week} onStart={setWeek} {...calendar} />
          : <PostList projectId={projectId} posts={posts} canEdit={canEdit} filter={filter} onFilter={setFilter} search={search} onSearch={setSearch}
            campaigns={campaigns} campaignFilter={campaignFilter} onCampaignFilter={setCampaignFilter} byPost={byPost}
            onOpen={(post) => setOpen({ postId: post._id })} views={views} />}

      {open && (open.postId === null || opened) && (
        <BroadcastComposer key={open.postId ?? `new-${open.format ?? "post"}`} projectId={projectId} projectName={projectName} post={opened ?? null}
          slot={open.postId === null ? open.slot : undefined} format={open.postId === null ? open.format : undefined} canEdit={canEdit} accounts={accounts} posts={posts}
          campaigns={campaigns} postCampaigns={opened ? byPost.get(opened._id) ?? [] : []} initialCampaignId={open.postId === null ? open.campaignId : undefined}
          onOpenPost={(postId) => setOpen({ postId })} onConnect={() => { setOpen(null); connect(); }} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

/** Which accounts post from this computer, and the channels still to connect. */
function AccountsStrip({ accounts, onConnect }: { accounts: ChannelAccounts | null; onConnect(): void }) {
  if (!accounts) return <p role="status" className="mb-4 text-[12px] text-ink-secondary">Connections are not confirmed on this computer. Drafts and approvals remain available.</p>;
  const connected = [...new Map(BROADCAST_CHANNELS.flatMap((channel) => accounts[channel]).map((account) => [`${account.integration}:${account.id}`, account])).values()];
  const missing = BROADCAST_CHANNELS.filter((channel) => !accounts[channel].length);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Accounts">
      {connected.map((account) => (
        <span key={`${account.integration}:${account.id}`} title={`${account.channels.map((channel) => BROADCAST_RULES[channel].label).join(" and ")}${account.source === "shared" ? ", shared with the workspace" : ""}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-inset px-2 text-[12px] text-ink-secondary">
          {account.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={12} />)}<span className="max-w-[140px] truncate text-ink">{account.label}</span>
        </span>
      ))}
      {missing.length > 0 && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 pl-1">
          {!connected.length && <p className="basis-full text-[12px] text-ink-secondary">Connect a channel to publish from this computer. Drafts and approvals work without one.</p>}
          {missing.map((channel) => (
            <button key={channel} type="button" onClick={onConnect} title={`Connect ${BROADCAST_RULES[channel].label}`} aria-label={`Connect ${BROADCAST_RULES[channel].label}`}
              className="flex size-7 items-center justify-center rounded-md border border-dashed border-hairline/70 text-ink-tertiary transition-colors duration-(--motion-fast) hover:border-accent/60 hover:text-ink">
              <ChannelMark channel={channel} size={12} />
            </button>
          ))}
          <button type="button" onClick={onConnect} className="ml-1 min-w-0 text-left text-[12px] text-ink-tertiary transition-colors duration-(--motion-fast) hover:text-ink">
            {connected.length ? "Connect more" : "Connect channels"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The four numbers the Posts tab leads with; each opens the list filtered to it. */
function Overview({ posts, active, onPick }: { posts: readonly BroadcastPost[]; active: ListFilter | null; onPick(filter: ListFilter): void }) {
  const numbers = publishOverview(posts);
  const tiles: { filter: ListFilter; label: string; value: number; note: string; icon: ReactNode; tone?: string }[] = [
    { filter: "approval", label: "Needs approval", value: numbers.approval, note: numbers.approval ? "Agents' drafts to review" : "Nothing waiting", icon: <ShieldCheck size={13} />, tone: numbers.approval ? "text-warning" : undefined },
    { filter: "scheduled", label: "Next 7 days", value: numbers.upcoming, note: numbers.upcoming === 1 ? "post scheduled" : "posts scheduled", icon: <CalendarClock size={13} />, tone: numbers.upcoming ? "text-accent-text" : undefined },
    { filter: "failed", label: "Failed", value: numbers.failed, note: numbers.failed ? "Open to retry" : "All went out", icon: <AlertTriangle size={13} />, tone: numbers.failed ? "text-danger" : undefined },
    { filter: "published", label: "Published, 30 days", value: numbers.published, note: numbers.engagement ? `${compactNumber(numbers.engagement)} likes, reposts and replies` : "No numbers read yet", icon: <Send size={13} />, tone: numbers.published ? "text-success" : undefined },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Overview">
      {tiles.map((tile) => (
        <button key={tile.filter} type="button" aria-pressed={active === tile.filter} onClick={() => onPick(tile.filter)}
          className={cn("flex min-w-0 flex-col gap-0.5 rounded-xl bg-inset/60 px-3 py-2.5 text-left outline-none transition-[background-color,box-shadow] duration-(--motion-fast) hover:bg-inset focus-visible:ring-2 focus-visible:ring-accent/60",
            active === tile.filter && "bg-inset ring-1 ring-hairline")}>
          <span className={cn("flex items-center gap-1.5 truncate text-[11.5px] text-ink-tertiary", tile.tone)}>{tile.icon}{tile.label}</span>
          <span className="text-[19px] font-semibold tabular-nums text-ink">{tile.value}</span>
          <span className="truncate text-[11.5px] text-ink-secondary">{tile.note}</span>
        </button>
      ))}
    </div>
  );
}

const FILTERS: readonly { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "approval", label: "Approval" }, { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" }, { value: "published", label: "Published" }, { value: "failed", label: "Failed" },
];

function Engagement({ post }: { post: BroadcastPost }) {
  const measured = post.variants.filter((variant) => variant.metrics);
  if (!measured.length) return null;
  const sum = (key: "likes" | "reposts" | "replies") => measured.reduce((total, variant) => total + variant.metrics![key], 0);
  return (
    <span className="hidden shrink-0 items-center gap-2.5 text-[11.5px] tabular-nums text-ink-tertiary md:flex" aria-label="Engagement">
      <span className="inline-flex items-center gap-1"><Heart size={11} />{sum("likes")}</span>
      <span className="inline-flex items-center gap-1"><Repeat2 size={12} />{sum("reposts")}</span>
      <span className="inline-flex items-center gap-1"><MessageCircle size={11} />{sum("replies")}</span>
    </span>
  );
}

function PostList({ projectId, posts, canEdit, filter, onFilter, search, onSearch, campaigns, campaignFilter, onCampaignFilter, byPost, onOpen, views }: {
  projectId: string;
  posts: BroadcastPost[];
  canEdit: boolean;
  filter: ListFilter;
  onFilter(filter: ListFilter): void;
  search: string;
  onSearch(search: string): void;
  campaigns: readonly CampaignSummary[];
  campaignFilter: string;
  onCampaignFilter(campaignId: string): void;
  byPost: Map<string, PostCampaign[]>;
  onOpen(post: BroadcastPost): void;
  views: ReactNode;
}) {
  const inCampaign = (post: BroadcastPost) => campaignFilter === "all" || (byPost.get(post._id) ?? []).some((campaign) => campaign.id === campaignFilter);
  const shown = listOrder(posts.filter((post) => matchesFilter(post, filter) && matchesSearch(post, search) && inCampaign(post)));
  const refresh = useAction();
  const quick = useAction();
  const [note, setNote] = useState("");
  const hasPublished = posts.some((post) => post.status === "published");
  const narrowed = Boolean(search.trim()) || campaignFilter !== "all";
  const readNumbers = () => void refresh.run(async () => {
    const result = await api<{ read: number; notes: string[] }>("/api/origin/broadcast/metrics", { method: "POST", body: JSON.stringify({ projectId }) });
    setNote([`${result.read} ${result.read === 1 ? "post" : "posts"} updated`, ...result.notes].join(". "));
  }, "Could not read the numbers");
  const duplicate = (post: BroadcastPost) => void quick.run(async () => { await duplicatePost(projectId, post, byPost.get(post._id) ?? []); setNote("Copied as a new draft"); }, "Could not copy the post");
  const retry = (post: BroadcastPost) => void quick.run(() => publishNow(post._id), "Could not publish the post");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none]"><Segmented label="Filter posts" value={filter} onChange={onFilter} options={FILTERS} /></div>
        <label className="relative flex min-w-0 flex-1 items-center max-sm:basis-full sm:max-w-[240px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
          <input type="search" aria-label="Search posts" placeholder="Search posts" value={search} onChange={(event) => onSearch(event.target.value)} className={cn(inputClass, "h-8 py-1 pl-7")} />
        </label>
        {campaigns.length > 0 && (
          <Select size="sm" className="max-w-[180px]" aria-label="Campaign" value={campaignFilter} onChange={(event) => onCampaignFilter(event.target.value)}>
            <option value="all">All campaigns</option>
            {campaigns.map((campaign) => <option key={campaign._id} value={campaign._id}>{campaign.name}</option>)}
          </Select>
        )}
        <span className="ml-auto flex items-center gap-2">
          {hasPublished && (
            <button type="button" className={cn(ghostButton, "min-h-7 px-2.5 py-1 text-[12px]")} disabled={refresh.busy} onClick={readNumbers} aria-label="Refresh numbers" title="Read likes, reposts and replies of published X and Bluesky posts">
              {refresh.busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}<span className="max-sm:hidden">Refresh numbers</span>
            </button>
          )}
          {views}
        </span>
      </div>
      {(refresh.error || quick.error || note) && <p role={refresh.error || quick.error ? "alert" : undefined} className={cn("text-[12px]", refresh.error || quick.error ? "text-danger" : "text-ink-tertiary")}>{refresh.error || quick.error || note}</p>}
      {!shown.length ? (
        <EmptyState compact icon={<Send size={22} />} title={filter === "all" && !narrowed ? "No posts yet" : "Nothing here"}
          action={narrowed ? <button type="button" className={ghostButton} onClick={() => { onSearch(""); onCampaignFilter("all"); }}><X size={13} />Clear search</button> : undefined} />
      ) : (
        <div className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
          {shown.map((post) => {
            const at = postTime(post);
            const tags = byPost.get(post._id) ?? [];
            return (
              <div key={post._id} data-origin-item={post._id} className="group flex min-w-0 items-center transition-colors duration-(--motion-fast) hover:bg-raised/40 focus-within:bg-raised/40">
                <button type="button" onClick={() => onOpen(post)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 pr-2 text-left outline-none">
                  <span className="w-[104px] shrink-0 max-sm:hidden"><StatusPill post={post} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{excerpt(post)}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-tertiary">
                      <span className="sm:hidden"><StatusPill post={post} /></span>
                      <Channels post={post} />
                      {post.format === "reel" && <span className="inline-flex items-center gap-1"><Clapperboard size={11} />Reel</span>}
                      {post.media.length > 0 && post.format !== "reel" && <span>· {post.media.length} media</span>}
                      {tags.map((tag) => <span key={tag.id} className="inline-flex min-w-0 items-center gap-1 truncate text-accent-text"><Megaphone size={11} className="shrink-0" />{tag.name}</span>)}
                      {post.agentName && <span className="truncate max-sm:hidden">· by {post.agentName}</span>}
                    </span>
                  </span>
                  <Engagement post={post} />
                  <span className="hidden w-[150px] shrink-0 text-right text-[12px] tabular-nums text-ink-secondary sm:block">{at !== undefined ? dateTimeOf(at) : ""}</span>
                </button>
                {canEdit && (
                  <span className="flex shrink-0 items-center gap-1 pr-2">
                    {post.status === "failed" && !post.needsApproval && (
                      <button type="button" className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} disabled={quick.busy} onClick={() => retry(post)} title="Publish the channels that failed now">
                        <RotateCcw size={12} />Retry
                      </button>
                    )}
                    <button type="button" className={cn(iconButton, "size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100 max-sm:opacity-100")} disabled={quick.busy}
                      aria-label="Duplicate post" title="Duplicate as a new draft" onClick={() => duplicate(post)}>
                      <Copy size={13} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
