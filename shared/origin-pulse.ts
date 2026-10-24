export const PULSE_RANGES = [7, 30] as const;
export type PulseRange = (typeof PULSE_RANGES)[number];

export const PULSE_STAGES = ["idea", "build"] as const;
export type PulseStage = (typeof PULSE_STAGES)[number];
export const PULSE_STAGE_LABEL: Record<PulseStage, string> = { idea: "Plan", build: "Build" };

export type PulseBudgetLevel = "ok" | "warn" | "over";

/** One number over the range with the same number for the range before it. */
export interface PulseCount { value: number; previous: number }

/** `pulse:project`: a project's signals over the last `days` UTC days; each series has one value per day in `days`, oldest first. */
export interface ProjectPulse {
  projectId: string;
  name: string;
  accent: string;
  range: PulseRange;
  /** The UTC days the series cover, `YYYY-MM-DD`. */
  days: string[];
  generatedAt: number;
  stage: PulseStage;
  reached: Record<PulseStage, boolean>;
  idea: { ideas: number };
  build: {
    open: number;
    done: PulseCount;
    opened: PulseCount;
    doneSeries: number[];
    openedSeries: number[];
    /** Open pull requests on issues: every one waits for a person to review or merge it. */
    prsWaiting: number;
    prsApproved: number;
    /** Median hours from an issue's creation to its completion, over the issues completed in range; null with none. */
    cycleHours: number | null;
  };
  team: {
    runs: PulseCount;
    runsSeries: number[];
    succeeded: number;
    failed: number;
    live: number;
    agents: number;
    approvalsWaiting: number;
    spendSeries: number[];
    spendRangeUsd: number;
    spendMonthUsd: number;
    budgetUsd: number | null;
    budgetLevel: PulseBudgetLevel;
  };
  attention: PulseAttention[];
  /** Some reads stopped at their bound, so a count may be low. */
  truncated: boolean;
}

export type PulseAttentionKind = "prs" | "approvals" | "failed" | "budget";
export interface PulseAttention { kind: PulseAttentionKind; count: number; tone: "warn" | "danger" }

export interface PulseStageInput {
  ideas: number;
  issues: number;
  runs: number;
  prs: number;
}

/** Each stage counts as reached on real data; the project sits at the furthest one reached. */
export function inferStage(input: PulseStageInput): { stage: PulseStage; reached: Record<PulseStage, boolean> } {
  const reached: Record<PulseStage, boolean> = {
    idea: true,
    build: input.issues > 0 || input.runs > 0 || input.prs > 0,
  };
  const stage = [...PULSE_STAGES].reverse().find((candidate) => reached[candidate]) ?? "idea";
  return { stage, reached };
}

export function pulseAttention(pulse: Pick<ProjectPulse, "build" | "team">): PulseAttention[] {
  const items: PulseAttention[] = [
    { kind: "prs", count: pulse.build.prsWaiting, tone: "warn" },
    { kind: "approvals", count: pulse.team.approvalsWaiting, tone: "warn" },
    { kind: "failed", count: pulse.team.failed, tone: "danger" },
    { kind: "budget", count: pulse.team.budgetLevel === "ok" ? 0 : 1, tone: pulse.team.budgetLevel === "over" ? "danger" : "warn" },
  ];
  return items.filter((item) => item.count > 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function attentionLabel(item: PulseAttention, budgetLevel: PulseBudgetLevel = "warn"): string {
  switch (item.kind) {
    case "prs": return `${plural(item.count, "PR", "PRs")} waiting`;
    case "approvals": return `${plural(item.count, "agent", "agents")} waiting for approval`;
    case "failed": return `${plural(item.count, "failed run", "failed runs")}`;
    case "budget": return budgetLevel === "over" ? "Budget reached" : "Budget at 80%";
  }
}

/** Orders projects so the one with the most to act on comes first. */
export function attentionScore(attention: readonly PulseAttention[]): number {
  return attention.reduce((sum, item) => sum + (item.tone === "danger" ? 100 : 10) + Math.min(item.count, 9), 0);
}

/** The UTC days of a range ending on the day of `now`, oldest first. */
export function pulseDays(now: number, range: number): string[] {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Array.from({ length: range }, (_, index) => new Date(today - (range - 1 - index) * 86_400_000).toISOString().slice(0, 10));
}

/** Change against the previous range as a signed whole percent, or null when there is nothing to compare with. */
export function pulseDelta(count: PulseCount): number | null {
  if (count.previous === 0) return null;
  return Math.round(((count.value - count.previous) / count.previous) * 100);
}

export function formatHours(hours: number | null): string {
  if (hours === null) return "–";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function formatUsd(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd).toLocaleString("en-US")}` : `$${usd.toFixed(2)}`;
}

export function formatCompact(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
