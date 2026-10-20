import { useCallback, useState, type ReactNode } from "react";
import { CalendarDays, CalendarRange, Clapperboard, Heart, List, Loader2, Megaphone, MessageCircle, Plus, Repeat2, RotateCw, Send, ShieldCheck } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useItemFocus } from "@/lib/origin-item-focus";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { BROADCAST_CHANNELS, BROADCAST_RULES, type BroadcastFormat } from "../../../shared/broadcast";
import { CloudGate, EmptyState, Loading, PageHeader, Segmented, cardClass, ghostButton, pageClass, primaryButton, useAction, type OriginPageProps } from "../origin-pages/ui";
import { BroadcastComposer } from "./BroadcastComposer";
import { Channels, MonthView, StatusPill, WeekView, dateTimeOf, excerpt } from "./BroadcastCalendar";
import { CampaignsView } from "./CampaignsView";
import { ChannelMark } from "./ChannelMark";
import { listOrder, matchesFilter, monthStart, movedTo, postTime, weekStart, type BroadcastList, type BroadcastPost, type ListFilter } from "./broadcast-model";
import { useBroadcastAccounts, type ChannelAccounts } from "./use-broadcast-accounts";

export function BroadcastPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Publish">{({ project, projectId, canEdit }) => <Broadcast projectId={projectId} projectName={project.name} canEdit={canEdit} agent={agent} />}</CloudGate>;
}

type View = "month" | "week" | "list";
type Opened = { post: BroadcastPost | null; slot?: number; format?: BroadcastFormat };

function Broadcast({ projectId, projectName, canEdit: projectEdit, agent }: { projectId: string; projectName: string; canEdit: boolean; agent: Bot }) {
  const data = useCloudQuery<BroadcastList>("broadcast:list", { projectId });
  const accounts = useBroadcastAccounts(projectId);
  const { dispatch } = useStore();
  const [mode, setMode] = useState<"posts" | "campaigns">("posts");
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [view, setView] = useState<View>("week");
  const [week, setWeek] = useState(() => weekStart(Date.now()));
  const [month, setMonth] = useState(() => monthStart(Date.now()));
  const [filter, setFilter] = useState<ListFilter>("all");
  const [open, setOpen] = useState<Opened | null>(null);
  const moving = useAction();
  const connect = useCallback(() => dispatch({ type: "toggleAppSettings", open: true, section: "integrations" }), [dispatch]);
  useItemFocus(projectId, {
    post: (postId) => {
      const post = data?.posts.find((candidate) => candidate._id === postId);
      setMode("posts");
      if (post) setOpen({ post });
      return true;
    },
    campaign: () => { setMode("campaigns"); return false; },
  }, Boolean(data));
  if (!data) return <Loading label="Loading posts" variant="board" />;
  const canEdit = projectEdit && data.canEdit;
  const posts = data.posts;
  const pending = posts.filter((post) => post.needsApproval).length;
  const live = open?.post ? posts.find((post) => post._id === open.post!._id) ?? null : null;
  const reviewApprovals = () => { setMode("posts"); setView("list"); setFilter("approval"); };
  const move = (post: BroadcastPost, day: Date) => void moving.run(() => cloudMutation("broadcast:reschedule", { postId: post._id, at: movedTo(post.scheduledAt!, day) }), "Could not move the post");
  const approvals = pending > 0 && (
    <button type="button" onClick={reviewApprovals}
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-warning/10 px-2 text-[12px] font-medium text-warning transition-colors duration-(--motion-fast) hover:bg-warning/15">
      <ShieldCheck size={13} />{pending} {pending === 1 ? "post waits" : "posts wait"} for your approval
    </button>
  );
  const views = (
    <Segmented label="Publish view" value={view} onChange={setView}
      options={[{ value: "month", label: <><CalendarRange size={13} /><span className="max-sm:sr-only">Month</span></> }, { value: "week", label: <><CalendarDays size={13} /><span className="max-sm:sr-only">Week</span></> }, { value: "list", label: <><List size={13} /><span className="max-sm:sr-only">List</span></> }]} />
  );
  const calendar = { posts, canEdit, onOpen: (post: BroadcastPost) => setOpen({ post }), onNew: (slot: number) => setOpen({ post: null, slot }), onMove: move, toolbar: <>{approvals}{views}</> };

  return (
    <section className={pageClass} aria-label="Publish">
      <PageHeader title="Publish">
        <Segmented label="Publish section" value={mode} onChange={setMode}
          options={[{ value: "posts", label: <><Send size={13} />Posts</> }, { value: "campaigns", label: <><Megaphone size={13} />Campaigns</> }]} />
        {canEdit && (mode === "posts" ? <>
          <button type="button" className={cn(ghostButton, "max-sm:ml-auto")} aria-label="New reel" title="New reel" onClick={() => setOpen({ post: null, format: "reel" })}><Clapperboard size={14} /><span className="max-sm:hidden">New reel</span></button>
          <button type="button" className={primaryButton} onClick={() => setOpen({ post: null })}><Plus size={14} />New post</button>
        </> : <button type="button" className={cn(primaryButton, "max-sm:ml-auto")} onClick={() => setCreatingCampaign(true)}><Plus size={14} />New campaign</button>)}
      </PageHeader>

      {mode === "posts" && <AccountsStrip accounts={accounts} onConnect={connect} />}
      {moving.error && <p role="alert" className="mb-3 text-[12.5px] text-danger">{moving.error}</p>}

      {mode === "campaigns" ? <>
        {approvals && <div className="mb-3">{approvals}</div>}
        <CampaignsView projectId={projectId} projectName={projectName} canEdit={canEdit} agent={agent} posts={posts} creating={creatingCampaign} onCreating={setCreatingCampaign}
          onOpenPost={(postId) => { const post = posts.find((candidate) => candidate._id === postId); if (post) setOpen({ post }); }} />
      </> : view === "month" ? <MonthView start={month} onStart={setMonth} {...calendar} />
        : view === "week" ? <WeekView start={week} onStart={setWeek} {...calendar} />
          : <PostList projectId={projectId} posts={posts} filter={filter} onFilter={setFilter} onOpen={(post) => setOpen({ post })} views={views} />}

      {open && (
        <BroadcastComposer key={open.post?._id ?? `new-${open.format ?? "post"}`} projectId={projectId} projectName={projectName} post={open.post ? live ?? open.post : null}
          slot={open.slot} format={open.format} canEdit={canEdit} accounts={accounts} posts={posts} onConnect={() => { setOpen(null); connect(); }} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

/** Which accounts post from this computer, and the channels still to connect. */
function AccountsStrip({ accounts, onConnect }: { accounts: ChannelAccounts | null; onConnect(): void }) {
  if (!accounts) return <div className="mb-4 h-7" />;
  const connected = [...new Map(BROADCAST_CHANNELS.flatMap((channel) => accounts[channel]).map((account) => [`${account.integration}:${account.id}`, account])).values()];
  const missing = BROADCAST_CHANNELS.filter((channel) => !accounts[channel].length);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Accounts">
      {connected.map((account) => (
        <span key={`${account.integration}:${account.id}`} title={`${account.channels.map((channel) => BROADCAST_RULES[channel].label).join(" and ")}${account.source === "shared" ? ", shared with the workspace" : ""}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-inset px-2 text-[12px] text-ink-secondary">
          {account.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={12} />)}<span className="max-w-[140px] truncate text-ink">{account.label}</span>
        </span>
      ))}
      {missing.length > 0 && (
        <span className="inline-flex items-center gap-1 pl-1">
          {missing.map((channel) => (
            <button key={channel} type="button" onClick={onConnect} title={`Connect ${BROADCAST_RULES[channel].label}`} aria-label={`Connect ${BROADCAST_RULES[channel].label}`}
              className="flex size-7 items-center justify-center rounded-md border border-dashed border-hairline/70 text-ink-tertiary transition-colors duration-(--motion-fast) hover:border-accent/60 hover:text-ink">
              <ChannelMark channel={channel} size={12} />
            </button>
          ))}
          <button type="button" onClick={onConnect} className="ml-1 text-[12px] text-ink-tertiary transition-colors duration-(--motion-fast) hover:text-ink">
            {connected.length ? "Connect more" : "Connect a channel to publish from this computer"}
          </button>
        </span>
      )}
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

function PostList({ projectId, posts, filter, onFilter, onOpen, views }: { projectId: string; posts: BroadcastPost[]; filter: ListFilter; onFilter(filter: ListFilter): void; onOpen(post: BroadcastPost): void; views: ReactNode }) {
  const shown = listOrder(posts.filter((post) => matchesFilter(post, filter)));
  const refresh = useAction();
  const [note, setNote] = useState("");
  const hasPublished = posts.some((post) => post.status === "published");
  const readNumbers = () => void refresh.run(async () => {
    const result = await api<{ read: number; notes: string[] }>("/api/origin/broadcast/metrics", { method: "POST", body: JSON.stringify({ projectId }) });
    setNote([`${result.read} ${result.read === 1 ? "post" : "posts"} updated`, ...result.notes].join(". "));
  }, "Could not read the numbers");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:none]"><Segmented label="Filter posts" value={filter} onChange={onFilter} options={FILTERS} /></div>
        <span className="ml-auto flex items-center gap-2">
          {hasPublished && (
            <button type="button" className={cn(ghostButton, "min-h-7 px-2.5 py-1 text-[12px]")} disabled={refresh.busy} onClick={readNumbers} aria-label="Refresh numbers" title="Read likes, reposts and replies of published X and Bluesky posts">
              {refresh.busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}<span className="max-sm:hidden">Refresh numbers</span>
            </button>
          )}
          {views}
        </span>
      </div>
      {(refresh.error || note) && <p className={cn("text-[12px]", refresh.error ? "text-danger" : "text-ink-tertiary")}>{refresh.error || note}</p>}
      {!shown.length ? <EmptyState compact icon={<Send size={22} />} title={filter === "all" ? "No posts yet" : "Nothing here"} /> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
          {shown.map((post) => {
            const at = postTime(post);
            return (
              <button key={post._id} type="button" onClick={() => onOpen(post)}
                className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-(--motion-fast) hover:bg-raised/40 focus-visible:bg-raised/40">
                <span className="w-[104px] shrink-0 max-sm:hidden"><StatusPill post={post} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{excerpt(post)}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-tertiary">
                    <span className="sm:hidden"><StatusPill post={post} /></span>
                    <Channels post={post} />
                    {post.format === "reel" && <span className="inline-flex items-center gap-1"><Clapperboard size={11} />Reel</span>}
                    {post.media.length > 0 && post.format !== "reel" && <span>· {post.media.length} media</span>}
                    {post.agentName && <span className="truncate">· by {post.agentName}</span>}
                  </span>
                </span>
                <Engagement post={post} />
                <span className="hidden w-[150px] shrink-0 text-right text-[12px] tabular-nums text-ink-secondary sm:block">{at !== undefined ? dateTimeOf(at) : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
