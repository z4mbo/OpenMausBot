import type { BroadcastChannel, BroadcastFormat, BroadcastMediaKind, BroadcastMetrics, BroadcastReel, BroadcastStatus } from "../../../shared/broadcast";

export type BroadcastVariant = {
  channel: BroadcastChannel;
  text: string;
  result?: "published" | "failed";
  url?: string;
  error?: string;
  publishedAt?: number;
  accountId?: string;
  accountLabel?: string;
  metrics?: BroadcastMetrics;
};

export type BroadcastMedia = { assetId: string; name: string; url: string | null; contentType: string | null; kind: BroadcastMediaKind };

export type BroadcastPost = {
  _id: string;
  projectId: string;
  variants: BroadcastVariant[];
  assetIds: string[];
  status: BroadcastStatus;
  format?: BroadcastFormat;
  reel?: BroadcastReel;
  scheduledAt?: number;
  agentName?: string;
  approvedAt?: number;
  createdAt: number;
  updatedAt: number;
  media: BroadcastMedia[];
  needsApproval: boolean;
};

export type BroadcastList = { canEdit: boolean; posts: BroadcastPost[] };

const DAY_MS = 86_400_000;

/** When a post goes or went out: its schedule, else when it was last published. */
export function postTime(post: BroadcastPost): number | undefined {
  const published = post.variants.map((variant) => variant.publishedAt ?? 0).reduce((latest, at) => Math.max(latest, at), 0);
  return post.scheduledAt ?? (published || undefined);
}

/** Local midnight of the Monday that starts `at`'s week. */
export function weekStart(at: number): Date {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function shiftWeek(start: Date, weeks: number): Date {
  const next = new Date(start);
  next.setDate(start.getDate() + weeks * 7);
  return next;
}

/** Posts on the calendar, by local day index within the week starting at `start`; the rest have no time yet. */
export function placeInWeek(posts: readonly BroadcastPost[], start: Date): { days: BroadcastPost[][]; unscheduled: BroadcastPost[] } {
  const days: BroadcastPost[][] = Array.from({ length: 7 }, () => []);
  const unscheduled: BroadcastPost[] = [];
  const end = shiftWeek(start, 1).getTime();
  for (const post of posts) {
    const at = postTime(post);
    if (at === undefined) {
      unscheduled.push(post);
      continue;
    }
    if (at < start.getTime() || at >= end) continue;
    const index = weekDays(start).findIndex((day) => sameDay(day, new Date(at)));
    if (index >= 0) days[index].push(post);
  }
  for (const day of days) day.sort((a, b) => (postTime(a) ?? 0) - (postTime(b) ?? 0));
  return { days, unscheduled };
}

/** The value a datetime-local input shows for `at`, in local time. */
export function toLocalInput(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): number | undefined {
  if (!value) return undefined;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : undefined;
}

/** A sensible default slot on `day`: 09:00, or the next full hour when the day is today. */
export function defaultSlot(day: Date, now = Date.now()): number {
  const slot = new Date(day);
  slot.setHours(9, 0, 0, 0);
  if (slot.getTime() > now) return slot.getTime();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  return next.getTime() + 3_600_000;
}

export function isPast(day: Date, now = Date.now()): boolean {
  return day.getTime() + DAY_MS <= now;
}

export type ListFilter = "all" | "approval" | "draft" | "scheduled" | "published" | "failed";

export function matchesFilter(post: BroadcastPost, filter: ListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "approval") return post.needsApproval;
  if (filter === "draft") return post.status === "draft" && !post.needsApproval;
  if (filter === "scheduled") return post.status === "scheduled" || post.status === "publishing";
  return post.status === filter;
}

/** Posts needing a decision first, then upcoming by time, then the rest newest first. */
export function listOrder(posts: readonly BroadcastPost[]): BroadcastPost[] {
  const rank = (post: BroadcastPost) => post.needsApproval ? 0 : post.status === "failed" ? 1 : post.status === "scheduled" || post.status === "publishing" ? 2 : post.status === "draft" ? 3 : 4;
  return [...posts].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 2 ? (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0) : (postTime(b) ?? b.updatedAt) - (postTime(a) ?? a.updatedAt)));
}

/** Local midnight of the first day of `at`'s month. */
export function monthStart(at: number): Date {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  day.setDate(1);
  return day;
}

export function shiftMonth(start: Date, months: number): Date {
  return new Date(start.getFullYear(), start.getMonth() + months, 1);
}

/** The Monday-first weeks that cover `start`'s month, as whole weeks of days. */
export function monthGrid(start: Date): Date[][] {
  const last = shiftMonth(start, 1).getTime() - 1;
  const weeks: Date[][] = [];
  for (let week = weekStart(start.getTime()); week.getTime() <= last; week = shiftWeek(week, 1)) weeks.push(weekDays(week));
  return weeks;
}

export const dayKey = (day: Date) => `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;

/** Posts with a time, by local day, earliest first. */
export function postsByDay(posts: readonly BroadcastPost[]): Map<string, BroadcastPost[]> {
  const days = new Map<string, BroadcastPost[]>();
  for (const post of posts) {
    const at = postTime(post);
    if (at === undefined) continue;
    const key = dayKey(new Date(at));
    days.set(key, [...days.get(key) ?? [], post]);
  }
  for (const list of days.values()) list.sort((a, b) => (postTime(a) ?? 0) - (postTime(b) ?? 0));
  return days;
}

/** Only a scheduled post moves; it keeps its time of day on the new date. */
export function canMove(post: BroadcastPost): boolean {
  return post.status === "scheduled" && !post.needsApproval && post.scheduledAt !== undefined;
}

export function movedTo(scheduledAt: number, day: Date): number {
  const from = new Date(scheduledAt);
  const to = new Date(day);
  to.setHours(from.getHours(), from.getMinutes(), 0, 0);
  return to.getTime();
}

/** Published channels with engagement read back, the input for best-time suggestions. */
export function metricSamples(posts: readonly BroadcastPost[]) {
  return posts.flatMap((post) => post.variants.flatMap((variant) => variant.publishedAt !== undefined && variant.metrics
    ? [{ channel: variant.channel, publishedAt: variant.publishedAt, metrics: variant.metrics }] : []));
}
