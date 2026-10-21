import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Clapperboard, Plus, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { BROADCAST_RULES, type BroadcastStatus } from "../../../shared/broadcast";
import { EmptyState, iconButton } from "../origin-pages/ui";
import { ChannelMark } from "./ChannelMark";
import { CoverVideo } from "./ChannelPreview";
import {
  canMove, dayKey, defaultSlot, isPast, monthGrid, monthStart, postTime, postsByDay, sameDay, shiftMonth, shiftWeek, weekDays, weekStart, type BroadcastPost,
} from "./broadcast-model";

const DRAG_TYPE = "application/x-origin-broadcast-post";

const STATUS_LABEL: Record<BroadcastStatus, string> = { draft: "Draft", scheduled: "Scheduled", publishing: "Publishing", published: "Published", failed: "Failed" };

export function StatusPill({ post }: { post: BroadcastPost }) {
  if (post.needsApproval) return <span className="rounded-md bg-warning/12 px-1.5 py-px text-[11px] font-medium text-warning">Needs approval</span>;
  const tone = post.status === "published" ? "bg-success/12 text-success" : post.status === "failed" ? "bg-danger/10 text-danger"
    : post.status === "scheduled" || post.status === "publishing" ? "bg-accent/12 text-accent-text" : "bg-raised/70 text-ink-secondary";
  return <span className={cn("rounded-md px-1.5 py-px text-[11px] font-medium", tone, post.status === "publishing" && "motion-safe:animate-pulse")}>{STATUS_LABEL[post.status]}</span>;
}

export function Channels({ post, size = 12 }: { post: BroadcastPost; size?: number }) {
  return (
    <span className="flex items-center gap-1 text-ink-tertiary">
      {post.variants.map((variant) => (
        <span key={variant.channel} title={`${BROADCAST_RULES[variant.channel].label}${variant.accountLabel ? ` as ${variant.accountLabel}` : ""}${variant.result ? ` · ${variant.result}` : ""}`}
          className={cn(variant.result === "failed" && "text-danger", variant.result === "published" && "text-success")}>
          <ChannelMark channel={variant.channel} size={size} />
        </span>
      ))}
    </span>
  );
}

export const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const dateTimeOf = (at: number) => new Date(at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const excerpt = (post: BroadcastPost) => post.variants[0]?.text.trim() || (post.media.length ? `${post.media.length} media` : "Empty post");

function Thumb({ post, size }: { post: BroadcastPost; size: string }) {
  const first = post.media.find((item) => item.url && (item.kind === "image" || item.kind === "video"));
  if (!first) return null;
  return (
    <span className={cn("relative shrink-0 overflow-hidden rounded-md bg-inset", size, post.format === "reel" && "aspect-[9/16] h-auto")}>
      {first.kind === "video" ? <CoverVideo url={first.url} coverMs={post.reel?.coverMs} className="size-full" /> : <img src={first.url!} alt="" loading="lazy" className="size-full object-cover" />}
    </span>
  );
}

type Move = { dragging: string | null; start(post: BroadcastPost, event: DragEvent): void; end(): void };

export function PostCard({ post, onOpen, compact, move, canEdit }: { post: BroadcastPost; onOpen(): void; compact?: boolean; move?: Move; canEdit?: boolean }) {
  const at = postTime(post);
  const draggable = Boolean(move && canEdit && canMove(post));
  return (
    <button type="button" onClick={onOpen} draggable={draggable} onDragStart={draggable ? (event) => move!.start(post, event) : undefined} onDragEnd={move?.end}
      data-post={post._id}
      className={cn("group flex w-full min-w-0 gap-2 rounded-lg border bg-panel p-2 text-left outline-none transition-[border-color,opacity,transform] duration-(--motion-fast) hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.99]",
        post.needsApproval ? "border-warning/40" : "border-hairline/30", draggable && "cursor-grab active:cursor-grabbing", move?.dragging === post._id && "opacity-40")}>
      <Thumb post={post} size={compact ? "w-9 h-9" : "w-11 h-11"} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex w-full items-center gap-1.5 text-[11px] text-ink-tertiary">
          {at !== undefined && <span className="tabular-nums text-ink-secondary">{compact ? timeOf(at) : dateTimeOf(at)}</span>}
          <Channels post={post} size={11} />
          {post.format === "reel" && <Clapperboard size={11} aria-label="Reel" />}
        </span>
        <span className={cn("text-[12.5px] leading-snug text-ink", compact ? "line-clamp-2" : "line-clamp-2")}>{excerpt(post)}</span>
        {(post.needsApproval || post.status !== "scheduled") && <span className="flex"><StatusPill post={post} /></span>}
      </span>
    </button>
  );
}

/** Drag a scheduled post onto another day; it keeps its time of day. */
function useMove(onMove: (post: BroadcastPost, day: Date) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const posts = useRef(new Map<string, BroadcastPost>()).current;
  const move: Move = {
    dragging,
    start(post, event) {
      posts.set(post._id, post);
      event.dataTransfer.setData(DRAG_TYPE, post._id);
      event.dataTransfer.effectAllowed = "move";
      setDragging(post._id);
    },
    end() { setDragging(null); setOver(null); },
  };
  const target = (day: Date) => ({
    onDragOver(event: DragEvent) {
      if (!dragging || isPast(day)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (over !== dayKey(day)) setOver(dayKey(day));
    },
    onDragLeave() { if (over === dayKey(day)) setOver(null); },
    onDrop(event: DragEvent) {
      event.preventDefault();
      const post = posts.get(event.dataTransfer.getData(DRAG_TYPE) || dragging || "");
      setDragging(null);
      setOver(null);
      if (post && !isPast(day) && !sameDay(new Date(post.scheduledAt!), day)) onMove(post, day);
    },
    "data-drop-over": over === dayKey(day) ? "" : undefined,
  });
  return { move, target, over };
}

function Range({ label, onPrev, onNext, onToday, atToday, prevLabel, nextLabel, children }: {
  label: string; onPrev(): void; onNext(): void; onToday(): void; atToday: boolean; prevLabel: string; nextLabel: string; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" className={iconButton} aria-label={prevLabel} onClick={onPrev}><ChevronLeft size={16} /></button>
      <button type="button" className={iconButton} aria-label={nextLabel} onClick={onNext}><ChevronRight size={16} /></button>
      <span className="ml-1 text-[14px] font-semibold tracking-[-0.01em] text-ink">{label}</span>
      {!atToday && <button type="button" className="ml-1.5 rounded-md px-2 py-1 text-[12px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink" onClick={onToday}>Today</button>}
      <span className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</span>
    </div>
  );
}

function Unscheduled({ posts, onOpen }: { posts: BroadcastPost[]; onOpen(post: BroadcastPost): void }) {
  if (!posts.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Unscheduled">
      <h3 className="text-[12px] font-medium text-ink-secondary">Unscheduled <span className="tabular-nums text-ink-tertiary">{posts.length}</span></h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
        {[...posts].sort((a, b) => Number(b.needsApproval) - Number(a.needsApproval) || b.updatedAt - a.updatedAt)
          .map((post) => <PostCard key={post._id} post={post} onOpen={() => onOpen(post)} />)}
      </div>
    </section>
  );
}

type CalendarProps = {
  posts: BroadcastPost[];
  canEdit: boolean;
  onOpen(post: BroadcastPost): void;
  onNew(slot: number): void;
  onMove(post: BroadcastPost, day: Date): void;
  toolbar?: ReactNode;
};

const longDay = (day: Date) => day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

export function WeekView({ start, onStart, ...props }: CalendarProps & { start: Date; onStart(start: Date): void }) {
  const days = weekDays(start);
  const byDay = postsByDay(props.posts);
  const today = new Date();
  const { move, target } = useMove(props.onMove);
  const end = days[6];
  const label = `${start.toLocaleDateString([], { day: "numeric", month: "short" })} – ${end.toLocaleDateString([], { day: "numeric", month: "short", year: start.getFullYear() === today.getFullYear() ? undefined : "numeric" })}`;
  return (
    <div className="flex flex-col gap-4">
      <Range label={label} prevLabel="Previous week" nextLabel="Next week" onPrev={() => onStart(shiftWeek(start, -1))} onNext={() => onStart(shiftWeek(start, 1))}
        onToday={() => onStart(weekStart(Date.now()))} atToday={sameDay(start, weekStart(Date.now()))}>{props.toolbar}</Range>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day) => {
          const isToday = sameDay(day, today);
          const past = isPast(day);
          const posts = byDay.get(dayKey(day)) ?? [];
          return (
            <div key={day.toISOString()} aria-label={longDay(day)} {...target(day)}
              className={cn("group/day flex min-w-0 flex-col gap-1.5 rounded-xl border p-1.5 transition-colors duration-(--motion-fast) lg:min-h-[280px]",
                isToday ? "border-accent/35 bg-inset/70" : "border-transparent bg-inset/45", past && "opacity-60", "data-[drop-over]:border-accent/70 data-[drop-over]:bg-accent/8")}>
              <div className="flex items-center gap-1.5 px-1 pt-0.5">
                <span className={cn("text-[11px] font-medium uppercase tracking-wide", isToday ? "text-accent-text" : "text-ink-tertiary")}>{day.toLocaleDateString([], { weekday: "short" })}</span>
                <span className={cn("text-[12.5px] tabular-nums", isToday ? "font-semibold text-ink" : "text-ink-secondary")}>{day.getDate()}</span>
                {props.canEdit && !past && (
                  <button type="button" aria-label={`New post on ${longDay(day)}`} onClick={() => props.onNew(defaultSlot(day))}
                    className="ml-auto flex size-6 items-center justify-center rounded-md text-ink-tertiary opacity-0 transition-opacity duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100 touch:opacity-100 max-lg:opacity-100">
                    <Plus size={13} />
                  </button>
                )}
              </div>
              {posts.map((post) => <PostCard key={post._id} post={post} compact move={move} canEdit={props.canEdit} onOpen={() => props.onOpen(post)} />)}
            </div>
          );
        })}
      </div>
      <Unscheduled posts={props.posts.filter((post) => postTime(post) === undefined)} onOpen={props.onOpen} />
      {!props.posts.length && <EmptyState compact icon={<Send size={22} />} title="No posts yet" body="Plan posts and reels for X, Bluesky, LinkedIn, Facebook, Instagram and TikTok. Agents can draft them too." />}
    </div>
  );
}

const MONTH_CHIPS = 3;

export function MonthView({ start, onStart, ...props }: CalendarProps & { start: Date; onStart(start: Date): void }) {
  const weeks = monthGrid(start);
  const byDay = postsByDay(props.posts);
  const today = new Date();
  const [selected, setSelected] = useState<Date>(() => (sameDay(monthStart(Date.now()), start) ? today : start));
  const { move, target } = useMove(props.onMove);
  const chosen = byDay.get(dayKey(selected)) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Range label={start.toLocaleDateString([], { month: "long", year: "numeric" })} prevLabel="Previous month" nextLabel="Next month"
        onPrev={() => onStart(shiftMonth(start, -1))} onNext={() => onStart(shiftMonth(start, 1))} onToday={() => onStart(monthStart(Date.now()))}
        atToday={sameDay(start, monthStart(Date.now()))}>{props.toolbar}</Range>
      <div role="grid" aria-label="Month" className="overflow-hidden rounded-xl border border-hairline/40">
        <div role="row" className="grid grid-cols-7 border-b border-hairline/40 bg-inset/45">
          {weeks[0].map((day) => <span key={day.getDay()} role="columnheader" className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{day.toLocaleDateString([], { weekday: "short" })}</span>)}
        </div>
        {weeks.map((week) => (
          <div key={week[0].toISOString()} role="row" className="grid grid-cols-7 border-b border-hairline/30 last:border-b-0">
            {week.map((day) => {
              const inMonth = day.getMonth() === start.getMonth();
              const isToday = sameDay(day, today);
              const past = isPast(day);
              const posts = byDay.get(dayKey(day)) ?? [];
              return (
                <div key={day.toISOString()} role="gridcell" aria-label={longDay(day)} aria-selected={sameDay(day, selected)} {...target(day)}
                  onClick={() => setSelected(day)}
                  className={cn("group/day relative flex min-h-[64px] min-w-0 flex-col gap-1 border-r border-hairline/30 p-1 transition-colors duration-(--motion-fast) last:border-r-0 sm:min-h-[112px] sm:p-1.5",
                    inMonth && !past ? "bg-inset/40" : "", past && "text-ink-tertiary", "data-[drop-over]:bg-accent/10 data-[drop-over]:shadow-[inset_0_0_0_1.5px_var(--color-accent)]",
                    sameDay(day, selected) && "max-sm:bg-raised/40")}>
                  <div className="flex items-center gap-1">
                    <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11.5px] tabular-nums",
                      isToday ? "bg-accent font-semibold text-accent-ink" : inMonth ? "text-ink-secondary" : "text-ink-tertiary/70")}>{day.getDate()}</span>
                    {props.canEdit && !past && (
                      <button type="button" aria-label={`New post on ${longDay(day)}`} onClick={(event) => { event.stopPropagation(); props.onNew(defaultSlot(day)); }}
                        className="ml-auto hidden size-5 items-center justify-center rounded text-ink-tertiary opacity-0 transition-opacity duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/day:opacity-100 touch:opacity-100 sm:flex">
                        <Plus size={12} />
                      </button>
                    )}
                  </div>
                  <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {posts.slice(0, MONTH_CHIPS).map((post) => <MonthChip key={post._id} post={post} move={move} canEdit={props.canEdit} onOpen={() => props.onOpen(post)} />)}
                    {posts.length > MONTH_CHIPS && <span className="px-1 text-[11px] text-ink-tertiary">+{posts.length - MONTH_CHIPS} more</span>}
                  </div>
                  {posts.length > 0 && <span className="flex gap-0.5 px-1 sm:hidden" aria-label={`${posts.length} posts`}>{posts.slice(0, 4).map((post) => <span key={post._id} className={cn("size-1.5 rounded-full", dotTone(post))} />)}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <section className="flex flex-col gap-1.5 sm:hidden" aria-label={longDay(selected)}>
        <h3 className="flex items-center text-[12.5px] font-medium text-ink">{longDay(selected)}
          {props.canEdit && !isPast(selected) && <button type="button" className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink" onClick={() => props.onNew(defaultSlot(selected))}><Plus size={12} />Post</button>}
        </h3>
        {chosen.length ? chosen.map((post) => <PostCard key={post._id} post={post} compact onOpen={() => props.onOpen(post)} />) : <p className="text-[12px] text-ink-tertiary">Nothing planned.</p>}
      </section>
      <Unscheduled posts={props.posts.filter((post) => postTime(post) === undefined)} onOpen={props.onOpen} />
    </div>
  );
}

const dotTone = (post: BroadcastPost) => post.needsApproval ? "bg-warning" : post.status === "published" ? "bg-success" : post.status === "failed" ? "bg-danger" : "bg-accent";

function MonthChip({ post, move, canEdit, onOpen }: { post: BroadcastPost; move: Move; canEdit: boolean; onOpen(): void }) {
  const draggable = canEdit && canMove(post);
  const at = postTime(post);
  return (
    <button type="button" draggable={draggable} data-post={post._id} onDragStart={draggable ? (event) => move.start(post, event) : undefined} onDragEnd={move.end}
      onClick={(event) => { event.stopPropagation(); onOpen(); }}
      title={excerpt(post)}
      className={cn("flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-left text-[11.5px] outline-none transition-[background-color,opacity] duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-accent/60",
        post.status === "published" ? "bg-success/10 text-ink-secondary hover:bg-success/15" : post.status === "failed" ? "bg-danger/10 text-ink hover:bg-danger/15"
          : post.needsApproval ? "bg-warning/10 text-ink hover:bg-warning/15" : "bg-accent/12 text-ink hover:bg-accent/20",
        draggable && "cursor-grab active:cursor-grabbing", move.dragging === post._id && "opacity-40")}>
      {at !== undefined && <span className="shrink-0 tabular-nums text-ink-tertiary">{timeOf(at)}</span>}
      <span className="flex shrink-0"><ChannelMark channel={post.variants[0]?.channel ?? "x"} size={10} /></span>
      {post.format === "reel" && <Clapperboard size={10} className="shrink-0 text-ink-tertiary" aria-label="Reel" />}
      <span className="truncate">{excerpt(post)}</span>
    </button>
  );
}
