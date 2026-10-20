import { useState } from "react";
import { Network, Wallet } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { budgetCaption, type BudgetLine, type BudgetOverview } from "@/lib/agent-budget";
import { EmptyState, Loading, Notice, type WorkspaceContext } from "../origin-pages/ui";
import { BudgetBadge, BudgetEditor, type BudgetTarget } from "./BudgetEditor";
import { formatTokens, groupOrg, PHASE_LABEL, type OrgNode, type OrgTree } from "./org-tree";

const PHASE_TONE: Record<OrgNode["phase"], string> = {
  idle: "bg-ink-tertiary/50",
  queued: "bg-ink-secondary",
  working: "bg-success motion-safe:animate-status-pulse",
  waiting_approval: "bg-warning motion-safe:animate-status-pulse",
};

const editButton = "ml-1 shrink-0 rounded px-1 text-[11.5px] text-ink-tertiary opacity-0 outline-none transition-[opacity,color] duration-(--motion-fast) hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/60 group-hover:opacity-100 touch:opacity-100";

type Budgets = { lines: Map<string, BudgetLine>; teamId: string; canEdit: boolean; editing: string | null; edit(key: string | null): void };

const keyOf = (target: BudgetTarget) => ("agentId" in target ? target.agentId : target.projectId);

function BudgetButton({ budgets, target, label }: { budgets: Budgets; target: BudgetTarget; label: string }) {
  if (!budgets.canEdit || budgets.editing === keyOf(target)) return null;
  const set = budgets.lines.get(keyOf(target))?.monthlyUsd !== undefined;
  return (
    <button type="button" className={editButton} onClick={() => budgets.edit(keyOf(target))} aria-label={`${set ? "Change" : "Set"} the monthly budget for ${label}`}>
      {set ? "Edit" : "Set budget"}
    </button>
  );
}

/** This month's spend under the node, with its budget editor in place while it is open. */
function BudgetRow({ budgets, target, label }: { budgets: Budgets; target: BudgetTarget; label: string }) {
  const line = budgets.lines.get(keyOf(target));
  const caption = budgetCaption(line);
  if (budgets.editing === keyOf(target)) {
    return <BudgetEditor teamId={budgets.teamId} target={target} label={label} monthlyUsd={line?.monthlyUsd} onDone={() => budgets.edit(null)} />;
  }
  if (!caption) return null;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] tabular-nums text-ink-tertiary">
      <span className="truncate">{caption}</span>
      <BudgetButton budgets={budgets} target={target} label={label} />
    </p>
  );
}

function Node({ node, budgets, depth = 0 }: { node: OrgNode; budgets: Budgets; depth?: number }) {
  return (
    <div className={cn("group flex min-w-0 items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-raised/40", depth > 0 && "ml-5")} data-org-node={node._id}>
      <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: node.color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <strong className="truncate text-[13px] font-semibold text-ink">{node.name}</strong>
          {node.title && <span className="truncate text-[12px] text-ink-tertiary">{node.title}</span>}
          <BudgetBadge line={budgets.lines.get(node._id)} />
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-secondary" aria-label={`Phase: ${PHASE_LABEL[node.phase]}`}>
            <span className={cn("size-1.5 rounded-full", PHASE_TONE[node.phase])} aria-hidden="true" />
            {PHASE_LABEL[node.phase]}{node.liveRuns > 1 ? ` · ${node.liveRuns}` : ""}
          </span>
        </div>
        {node.task && <p className="truncate text-[12px] text-ink-secondary" title={node.task}>{node.task}</p>}
        <p className="text-[11.5px] tabular-nums text-ink-tertiary">
          {node.runs ? `${node.runs} run${node.runs === 1 ? "" : "s"} · ${formatTokens(node.tokens)} tokens${node.costUsd ? ` · $${node.costUsd.toFixed(2)}` : ""} this week` : "No runs this week"}
          <span className="hidden sm:inline"> · {node.model}</span>
          {!budgetCaption(budgets.lines.get(node._id)) && <BudgetButton budgets={budgets} target={{ agentId: node._id }} label={node.name} />}
        </p>
        <BudgetRow budgets={budgets} target={{ agentId: node._id }} label={node.name} />
      </div>
    </div>
  );
}

/** The live org: the workspace's boss, each project's Chief and the agents under it, with their monthly budgets. */
export function OrgPage({ teamId }: WorkspaceContext) {
  const tree = useCloudQuery<OrgTree>("org:tree", { teamId });
  const overview = useCloudQuery<BudgetOverview>("budgets:overview", { teamId });
  const [editing, setEditing] = useState<string | null>(null);
  if (tree === undefined) return <Loading label="Loading the org" />;
  const org = groupOrg(tree);
  if (!org.heads.length && !org.projects.length && !org.unplaced.length) {
    return <EmptyState icon={<Network size={22} />} title="No agents yet" body="Publish the workspace's boss and each project's Chief, and they show here with what they are working on." />;
  }
  const budgets: Budgets = {
    lines: new Map<string, BudgetLine>([
      ...(overview?.agents ?? []).map((row) => [row.agentId, row] as const),
      ...(overview?.projects ?? []).map((row) => [row.projectId, row] as const),
    ]),
    teamId, canEdit: overview?.canEdit ?? false, editing, edit: setEditing,
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-[var(--glass-top,0px)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        {tree.truncated && <Notice>Showing the most recent agents and runs.</Notice>}
        {(org.heads.length > 0 || org.unplaced.length > 0) && (
          <section aria-label="Workspace" className="rounded-xl border border-hairline/40 bg-panel p-1.5">
            {org.heads.map((node) => <Node key={node._id} node={node} budgets={budgets} />)}
            {org.unplaced.map((node) => <Node key={node._id} node={node} budgets={budgets} depth={org.heads.length ? 1 : 0} />)}
          </section>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {org.projects.map(({ project, chiefs, agents }) => (
            <section key={project._id} aria-label={project.name} className="rounded-xl border border-hairline/40 bg-panel p-1.5">
              <div className="group px-2.5 pb-1 pt-1.5">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
                  <span className="size-2 rounded-sm" style={{ backgroundColor: project.accent }} aria-hidden="true" />{project.name}
                  <BudgetBadge line={budgets.lines.get(project._id)} />
                  {!budgetCaption(budgets.lines.get(project._id)) && <BudgetButton budgets={budgets} target={{ projectId: project._id }} label={project.name} />}
                  <span className="ml-auto tabular-nums text-ink-tertiary">{chiefs.length + agents.length}</span>
                </div>
                <div className="flex items-center gap-1 pl-4">
                  {budgetCaption(budgets.lines.get(project._id)) && budgets.editing !== project._id && <Wallet size={11} className="shrink-0 text-ink-tertiary" aria-hidden="true" />}
                  <BudgetRow budgets={budgets} target={{ projectId: project._id }} label={project.name} />
                </div>
              </div>
              {chiefs.map((node) => <Node key={node._id} node={node} budgets={budgets} />)}
              {agents.map((node) => <Node key={node._id} node={node} budgets={budgets} depth={chiefs.length ? 1 : 0} />)}
              {!chiefs.length && !agents.length && <p className="px-2.5 pb-2 text-[12px] text-ink-tertiary">No Chief yet.</p>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
