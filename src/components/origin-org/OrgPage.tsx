import { Network } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { EmptyState, Loading, Notice, type WorkspaceContext } from "../origin-pages/ui";
import { formatTokens, groupOrg, PHASE_LABEL, type OrgNode, type OrgTree } from "./org-tree";

const PHASE_TONE: Record<OrgNode["phase"], string> = {
  idle: "bg-ink-tertiary/50",
  queued: "bg-ink-secondary",
  working: "bg-success motion-safe:animate-status-pulse",
  waiting_approval: "bg-warning motion-safe:animate-status-pulse",
};

function Node({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-raised/40", depth > 0 && "ml-5")} data-org-node={node._id}>
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: node.color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <strong className="truncate text-[13px] font-semibold text-ink">{node.name}</strong>
          {node.title && <span className="truncate text-[12px] text-ink-tertiary">{node.title}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-secondary" aria-label={`Phase: ${PHASE_LABEL[node.phase]}`}>
            <span className={cn("size-1.5 rounded-full", PHASE_TONE[node.phase])} aria-hidden="true" />
            {PHASE_LABEL[node.phase]}{node.liveRuns > 1 ? ` · ${node.liveRuns}` : ""}
          </span>
        </div>
        {node.task && <p className="truncate text-[12px] text-ink-secondary" title={node.task}>{node.task}</p>}
        <p className="text-[11.5px] tabular-nums text-ink-tertiary">
          {node.runs ? `${node.runs} run${node.runs === 1 ? "" : "s"} · ${formatTokens(node.tokens)} tokens${node.costUsd ? ` · $${node.costUsd.toFixed(2)}` : ""} this week` : "No runs this week"}
          <span className="hidden sm:inline"> · {node.model}</span>
        </p>
      </div>
    </div>
  );
}

/** The live org: the workspace's boss, each project's Chief and the agents under it. */
export function OrgPage({ teamId }: WorkspaceContext) {
  const tree = useCloudQuery<OrgTree>("org:tree", { teamId });
  if (tree === undefined) return <Loading label="Loading the org" />;
  const org = groupOrg(tree);
  if (!org.heads.length && !org.projects.length && !org.unplaced.length) {
    return <EmptyState icon={<Network size={22} />} title="No agents yet" body="Publish the workspace's boss and each project's Chief, and they show here with what they are working on." />;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-[var(--glass-top,0px)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        {tree.truncated && <Notice>Showing the most recent agents and runs.</Notice>}
        {(org.heads.length > 0 || org.unplaced.length > 0) && (
          <section aria-label="Workspace" className="rounded-xl border border-hairline/40 bg-panel p-1.5">
            {org.heads.map((node) => <Node key={node._id} node={node} />)}
            {org.unplaced.map((node) => <Node key={node._id} node={node} depth={org.heads.length ? 1 : 0} />)}
          </section>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {org.projects.map(({ project, chiefs, agents }) => (
            <section key={project._id} aria-label={project.name} className="rounded-xl border border-hairline/40 bg-panel p-1.5">
              <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-ink-secondary">
                <span className="size-2 rounded-sm" style={{ backgroundColor: project.accent }} aria-hidden="true" />{project.name}
                <span className="ml-auto tabular-nums text-ink-tertiary">{chiefs.length + agents.length}</span>
              </div>
              {chiefs.map((node) => <Node key={node._id} node={node} />)}
              {agents.map((node) => <Node key={node._id} node={node} depth={chiefs.length ? 1 : 0} />)}
              {!chiefs.length && !agents.length && <p className="px-2.5 pb-2 text-[12px] text-ink-tertiary">No Chief yet.</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
