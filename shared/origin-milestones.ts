/** Lightweight project milestones: a name, an optional target day and the issues that belong to it. */
export const MILESTONE_LIMITS = { title: 120, description: 2_000, perProject: 30, assignAtOnce: 100, issues: 200 } as const;

export type MilestoneStatus = "planned" | "active" | "completed";

export interface MilestoneSummary {
  _id: string;
  title: string;
  description: string;
  /** YYYY-MM-DD, or empty when the milestone has no target day. */
  targetDate: string;
  status: MilestoneStatus;
  done: number;
  total: number;
}

export interface MilestoneList { canEdit: boolean; milestones: MilestoneSummary[] }

export const milestonePercent = (milestone: Pick<MilestoneSummary, "done" | "total">) =>
  milestone.total ? Math.round((milestone.done / milestone.total) * 100) : 0;

/** Dated milestones first, soonest first; undated ones keep their creation order after them. */
export function compareMilestones(a: { targetDate: string; createdAt: number }, b: { targetDate: string; createdAt: number }): number {
  if (a.targetDate && b.targetDate && a.targetDate !== b.targetDate) return a.targetDate < b.targetDate ? -1 : 1;
  if (Boolean(a.targetDate) !== Boolean(b.targetDate)) return a.targetDate ? -1 : 1;
  return a.createdAt - b.createdAt;
}

export function milestoneDay(targetDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return "";
  const [year, month, day] = targetDate.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
