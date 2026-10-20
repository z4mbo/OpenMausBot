import { attentionScore, pulseDelta, type ProjectPulse, type PulseCount, type PulseStage } from "../../../shared/origin-pulse";
import type { ChiefSection } from "@/lib/origin-chief-section";

export type { ProjectPulse };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function deltaText(count: PulseCount, range: number): { text: string; title: string } | null {
  const delta = pulseDelta(count);
  if (delta === null) return null;
  return { text: `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)}%`, title: `${count.previous.toLocaleString()} in the ${range} days before` };
}

export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The line under each stage of the strip, from the numbers that put the project there. */
export function stageLine(pulse: ProjectPulse, stage: PulseStage): string {
  switch (stage) {
    case "idea": return plural(pulse.idea.ideas, "idea", "ideas");
    case "build": return pulse.reached.build ? `${pulse.build.open.toLocaleString()} open · ${pulse.build.done.value.toLocaleString()} done` : "No issues yet";
    case "launch": return pulse.reached.launch ? `${plural(pulse.launch.pagesLive, "page", "pages")} · ${plural(pulse.launch.posts.value, "post", "posts")}` : "Nothing published";
    case "grow": return pulse.reached.grow ? plural(pulse.grow.total, "lead", "leads") : "No leads yet";
  }
}

export const STAGE_SECTION: Record<PulseStage, ChiefSection> = { idea: "issues", build: "issues", launch: "broadcast", grow: "pipeline" };

export const ATTENTION_SECTION = { prs: "repo", replies: "pipeline", drafts: "pipeline", approvals: "agents", failed: "agents", budget: "agents" } as const satisfies Record<ProjectPulse["attention"][number]["kind"], ChiefSection>;

/** Project ids with the most to act on first, then by name; ones still loading keep their place at the end. */
export function orderByAttention(projects: readonly { _id: string; name: string }[], loaded: ReadonlyMap<string, ProjectPulse>): string[] {
  const score = (id: string) => { const pulse = loaded.get(id); return pulse ? attentionScore(pulse.attention) : -1; };
  return [...projects].sort((a, b) => score(b._id) - score(a._id) || a.name.localeCompare(b.name)).map((project) => project._id);
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
