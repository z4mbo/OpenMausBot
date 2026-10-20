import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, Send, ShieldCheck } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { BROADCAST_CHANNELS, BROADCAST_RULES, type BroadcastChannel, type BroadcastStatus } from "../../../shared/broadcast";
import { CloudGate, EmptyState, Loading, PageHeader, Segmented, cardClass, chipButton, iconButton, pageClass, primaryButton, type OriginPageProps } from "../origin-pages/ui";
import { BroadcastComposer } from "./BroadcastComposer";
import { ChannelMark } from "./ChannelMark";
import {
  defaultSlot, isPast, listOrder, matchesFilter, placeInWeek, postTime, sameDay, shiftWeek, weekDays, weekStart,
  type BroadcastList, type BroadcastPost, type ListFilter,
} from "./broadcast-model";

type Connected = Partial<Record<BroadcastChannel, boolean>>;

function useConnectedChannels(): Connected | null {
  const [connected, setConnected] = useState<Connected | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api<{ channels: Connected }>("/api/origin/broadcast/channels").then((body) => { if (live) setConnected(body.channels); }, () => undefined);
    load();
    window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("focus", load); };
  }, []);
  return connected;
}

export function BroadcastPage({ agent: _agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Broadcast">{({ projectId, canEdit }) => <Broadcast projectId={projectId} canEdit={canEdit} />}</CloudGate>;
}

const STATUS_LABEL: Record<BroadcastStatus, string> = { draft: "Draft", scheduled: "Scheduled", publishing: "Publishing", published: "Published", failed: "Failed" };

function StatusPill({ post }: { post: BroadcastPost }) {
  if (post.needsApproval) return <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning"><ShieldCheck size={11} />Needs approval</span>;
  const tone = post.status === "published" ? "bg-success/15 text-success" : post.status === "failed" ? "bg-danger/10 text-danger"
    : post.status === "scheduled" || post.status === "publishing" ? "bg-accent/15 text-accent-text" : "bg-raised text-ink-secondary";
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", tone, post.status === "publishing" && "motion-safe:animate-pulse")}>{STATUS_LABEL[post.status]}</span>;
}

function Channels({ post }: { post: BroadcastPost }) {
  return (
    <span className="flex items-center gap-1 text-ink-secondary">
      {post.variants.map((variant) => (
        <span key={variant.channel} title={`${BROADCAST_RULES[variant.channel].label}${variant.result ? ` · ${variant.result}` : ""}`}
          className={cn(variant.result === "failed" && "text-danger", variant.result === "published" && "text-success")}>
          <ChannelMark channel={variant.channel} size={12} />
        </span>
      ))}
    </span>
  );
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateTimeOf = (at: number) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const excerpt = (post: BroadcastPost) => post.variants[0]?.text.trim() || (post.media.length ? `${post.media.length} media` : "Empty post");

function Broadcast({ projectId, canEdit: projectEdit }: { projectId: string; canEdit: boolean }) {
  const data = useCloudQuery<BroadcastList>("broadcast:list", { projectId });
  const connected = useConnectedChannels();
  const { dispatch } = useStore();
  const [view, setView] = useState<"week" | "list">("week");
  const [start, setStart] = useState(() => weekStart(Date.now()));
  const [filter, setFilter] = useState<ListFilter>("all");
  const [open, setOpen] = useState<{ post: BroadcastPost | null; slot?: number } | null>(null);
  const connect = useCallback(() => dispatch({ type: "toggleAppSettings", open: true, section: "integrations" }), [dispatch]);
  if (!data) return <Loading label="Loading posts" variant="board" />;
  const canEdit = projectEdit && data.canEdit;
  const posts = data.posts;
  const pending = posts.filter((post) => post.needsApproval).length;
  const live = open?.post ? posts.find((post) => post._id === open.post!._id) ?? null : null;
  const missing = connected ? BROADCAST_CHANNELS.filter((channel) => connected[channel] === false) : [];

  return (
    <section className={pageClass} aria-label="Broadcast">
      <PageHeader title="Broadcast" count={posts.length}>
        <Segmented label="Broadcast view" value={view} onChange={setView}
          options={[{ value: "week", label: <><CalendarDays size={13} />Week</> }, { value: "list", label: <><List size={13} />List</> }]} />
        {canEdit && <button type="button" className={primaryButton} onClick={() => setOpen({ post: null })}><Plus size={14} />New post</button>}
      </PageHeader>

      {missing.length > 0 && missing.length < BROADCAST_CHANNELS.length && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-tertiary">
          <span>Not connected:</span>
          {missing.map((channel) => (
            <button key={channel} type="button" onClick={connect} className={cn(chipButton, "h-7 px-2.5 text-[12px]")} title={`Connect ${BROADCAST_RULES[channel].label}`}>
              <ChannelMark channel={channel} size={12} />{BROADCAST_RULES[channel].label}
            </button>
          ))}
        </div>
      )}
      {missing.length === BROADCAST_CHANNELS.length && (
        <div className={cn(cardClass, "mb-3 flex flex-wrap items-center gap-3 px-4 py-3")}>
          <span className="flex items-center gap-1.5 text-ink-secondary">{BROADCAST_CHANNELS.map((channel) => <ChannelMark key={channel} channel={channel} size={14} />)}</span>
          <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">Connect a channel to publish from this computer. Drafts and approvals work without one.</p>
          <button type="button" className={cn(chipButton, "h-8")} onClick={connect}>Connect channels</button>
        </div>
      )}

      {pending > 0 && view === "week" && (
        <button type="button" onClick={() => { setView("list"); setFilter("approval"); }}
          className="mb-3 flex w-full items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-left text-[12.5px] text-warning transition-colors duration-150 hover:bg-warning/15">
          <ShieldCheck size={14} />{pending} {pending === 1 ? "post waits" : "posts wait"} for your approval
          <ChevronRight size={14} className="ml-auto" />
        </button>
      )}

      {view === "week"
        ? <Week posts={posts} start={start} onStart={setStart} canEdit={canEdit} onOpen={(post) => setOpen({ post })} onNew={(slot) => setOpen({ post: null, slot })} />
        : <PostList posts={posts} filter={filter} onFilter={setFilter} onOpen={(post) => setOpen({ post })} />}

      {open && (
        <BroadcastComposer key={open.post?._id ?? "new"} projectId={projectId} post={open.post ? live ?? open.post : null} slot={open.slot}
          canEdit={canEdit} connected={connected} onConnect={() => { setOpen(null); connect(); }} onClose={() => setOpen(null)} />
      )}
    </section>
  );
}

function PostCard({ post, onOpen, compact }: { post: BroadcastPost; onOpen(): void; compact?: boolean }) {
  const at = postTime(post);
  return (
    <button type="button" onClick={onOpen}
      className={cn("group flex w-full min-w-0 flex-col gap-1.5 rounded-lg border bg-panel p-2 text-left outline-none transition-[border-color,transform] duration-150 hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.99]",
        post.needsApproval ? "border-warning/40" : "border-hairline/40")}>
      <span className="flex w-full items-center gap-1.5 text-[11px] text-ink-tertiary">
        {at !== undefined && <span className="tabular-nums text-ink-secondary">{compact ? timeOf(at) : dateTimeOf(at)}</span>}
        <Channels post={post} />
        {post.media.length > 0 && <span>· {post.media.length}</span>}
      </span>
      <span className={cn("text-[12.5px] leading-snug text-ink", compact ? "line-clamp-3" : "line-clamp-2")}>{excerpt(post)}</span>
      {(post.needsApproval || post.status !== "scheduled") && <span className="flex"><StatusPill post={post} /></span>}
    </button>
  );
}

function Week({ posts, start, onStart, canEdit, onOpen, onNew }: {
  posts: BroadcastPost[]; start: Date; onStart(start: Date): void; canEdit: boolean; onOpen(post: BroadcastPost): void; onNew(slot: number): void;
}) {
  const days = weekDays(start);
  const { days: placed, unscheduled } = placeInWeek(posts, start);
  const today = new Date();
  const end = days[6];
  const range = `${start.toLocaleDateString([], { day: "numeric", month: "short" })} – ${end.toLocaleDateString([], { day: "numeric", month: "short", year: start.getFullYear() === today.getFullYear() ? undefined : "numeric" })}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <button type="button" className={iconButton} aria-label="Previous week" onClick={() => onStart(shiftWeek(start, -1))}><ChevronLeft size={16} /></button>
        <button type="button" className={iconButton} aria-label="Next week" onClick={() => onStart(shiftWeek(start, 1))}><ChevronRight size={16} /></button>
        <span className="ml-1 text-[13px] font-medium text-ink">{range}</span>
        {!sameDay(start, weekStart(Date.now())) && (
          <button type="button" className="ml-2 rounded-md px-2 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-raised hover:text-ink" onClick={() => onStart(weekStart(Date.now()))}>This week</button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day, index) => {
          const isToday = sameDay(day, today);
          const past = isPast(day);
          return (
            <div key={day.toISOString()} className={cn("group/day flex min-w-0 flex-col gap-1.5 rounded-xl bg-inset/60 p-1.5 lg:min-h-[240px]", past && "opacity-70")}>
              <div className="flex items-center gap-1.5 px-1 pt-0.5">
                <span className={cn("text-[11.5px] font-medium uppercase tracking-wide", isToday ? "text-accent-text" : "text-ink-tertiary")}>{day.toLocaleDateString([], { weekday: "short" })}</span>
                <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] tabular-nums", isToday ? "bg-accent text-accent-ink" : "text-ink-secondary")}>{day.getDate()}</span>
                {canEdit && !past && (
                  <button type="button" aria-label={`New post on ${day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}`} onClick={() => onNew(defaultSlot(day))}
                    className="ml-auto flex size-6 items-center justify-center rounded-md text-ink-tertiary opacity-0 transition-opacity duration-150 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100 touch:opacity-100 max-lg:opacity-100">
                    <Plus size={13} />
                  </button>
                )}
              </div>
              {placed[index].map((post) => <PostCard key={post._id} post={post} compact onOpen={() => onOpen(post)} />)}
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-ink-secondary">Unscheduled <span className="tabular-nums text-ink-tertiary">{unscheduled.length}</span></h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
            {unscheduled.sort((a, b) => Number(b.needsApproval) - Number(a.needsApproval) || b.updatedAt - a.updatedAt)
              .map((post) => <PostCard key={post._id} post={post} onOpen={() => onOpen(post)} />)}
          </div>
        </div>
      )}
      {!posts.length && <EmptyState compact icon={<Send size={22} />} title="No posts yet" body="Plan posts for X, Bluesky, LinkedIn, Facebook, Instagram and TikTok. Agents can draft them too." />}
    </div>
  );
}

const FILTERS: readonly { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "approval", label: "Approval" }, { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" }, { value: "published", label: "Published" }, { value: "failed", label: "Failed" },
];

function PostList({ posts, filter, onFilter, onOpen }: { posts: BroadcastPost[]; filter: ListFilter; onFilter(filter: ListFilter): void; onOpen(post: BroadcastPost): void }) {
  const shown = listOrder(posts.filter((post) => matchesFilter(post, filter)));
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto [scrollbar-width:none]"><Segmented label="Filter posts" value={filter} onChange={onFilter} options={FILTERS} /></div>
      {!shown.length ? <EmptyState compact icon={<Send size={22} />} title={filter === "all" ? "No posts yet" : "Nothing here"} /> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
          {shown.map((post) => {
            const at = postTime(post);
            return (
              <button key={post._id} type="button" onClick={() => onOpen(post)}
                className="flex w-full min-w-0 items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-raised/40 focus-visible:bg-raised/40">
                <span className="w-[112px] shrink-0"><StatusPill post={post} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{excerpt(post)}</span>
                  <span className="flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
                    <Channels post={post} />
                    {post.media.length > 0 && <span>· {post.media.length} media</span>}
                    {post.agentName && <span className="truncate">· by {post.agentName}</span>}
                  </span>
                </span>
                <span className="hidden shrink-0 text-[12px] tabular-nums text-ink-secondary sm:block">{at !== undefined ? dateTimeOf(at) : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
