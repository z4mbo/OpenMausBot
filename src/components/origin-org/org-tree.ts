export type OrgPhase = "idle" | "queued" | "working" | "waiting_approval";

export interface OrgNode {
  _id: string; kind: "head" | "chief" | "agent"; name: string; title?: string; color: string; projectId?: string; engine: string; model: string;
  phase: OrgPhase; task?: string; liveRuns: number; runs: number; tokens: number; costUsd: number;
}
export interface OrgProject { _id: string; name: string; accent: string }
export interface OrgTree { agents: OrgNode[]; projects: OrgProject[]; truncated: boolean }

export const PHASE_LABEL: Record<OrgPhase, string> = { idle: "Idle", queued: "Queued", working: "Working", waiting_approval: "Needs approval" };

const PHASE_ORDER: Record<OrgPhase, number> = { waiting_approval: 0, working: 1, queued: 2, idle: 3 };
const byActivity = (a: OrgNode, b: OrgNode) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.name.localeCompare(b.name);

/** Heads on top; each visible project with its Chiefs then its agents, busiest first; agents outside any project under the heads. */
export function groupOrg(tree: OrgTree) {
  const heads = tree.agents.filter((node) => node.kind === "head").sort(byActivity);
  const unplaced = tree.agents.filter((node) => node.kind !== "head" && !node.projectId).sort(byActivity);
  const projects = tree.projects.map((project) => {
    const members = tree.agents.filter((node) => node.kind !== "head" && node.projectId === project._id);
    return { project, chiefs: members.filter((node) => node.kind === "chief").sort(byActivity), agents: members.filter((node) => node.kind === "agent").sort(byActivity) };
  }).sort((a, b) => {
    const live = (group: typeof a) => [...group.chiefs, ...group.agents].filter((node) => node.phase !== "idle").length;
    return live(b) - live(a) || a.project.name.localeCompare(b.project.name);
  });
  return { heads, unplaced, projects };
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
