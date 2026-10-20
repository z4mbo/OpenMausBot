import { attentionScore, pulseDelta, type ProjectPulse, type PulseCount } from "../../../shared/origin-pulse";
import type { ChiefSection } from "@/lib/origin-chief-section";

export type { ProjectPulse };

export function deltaText(count: PulseCount, range: number): { text: string; title: string } | null {
  const delta = pulseDelta(count);
  if (delta === null) return null;
  return { text: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)}%`, title: `${count.previous.toLocaleString()} in the ${range} days before` };
}

export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export const ATTENTION_SECTION = { prs: "repo", replies: "pipeline", drafts: "pipeline", approvals: "agents", failed: "agents", budget: "agents" } as const satisfies Record<ProjectPulse["attention"][number]["kind"], ChiefSection>;

/** Project ids with the most to act on first, then by name; ones still loading keep their place at the end. */
export function orderByAttention(projects: readonly { _id: string; name: string }[], loaded: ReadonlyMap<string, ProjectPulse>): string[] {
  const score = (id: string) => { const pulse = loaded.get(id); return pulse ? attentionScore(pulse.attention) : -1; };
  return [...projects].sort((a, b) => score(b._id) - score(a._id) || a.name.localeCompare(b.name)).map((project) => project._id);
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
