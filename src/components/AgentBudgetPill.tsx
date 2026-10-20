import { useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Wallet, X } from "lucide-react";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { useCloudQuery } from "@/lib/origin-cloud";
import { budgetPercent, formatUsd, type AgentBudget } from "@/lib/agent-budget";
import type { SharedBotLink } from "../../shared/wire";
import { BudgetEditor, type BudgetTarget } from "./origin-org/BudgetEditor";

const pill = "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] text-ink";

function budgetStatus(budget: AgentBudget) {
  const whose = budget.scope === "project" ? `${budget.name}'s project budget` : `${budget.name}'s budget`;
  return budget.level === "over" ? `${whose} is used up` : `${budgetPercent(budget)}% of ${whose}`;
}

export function AgentBudgetPillView({ budget, onRaise, onDetails, panelId, open }: {
  budget: AgentBudget;
  onRaise?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDetails?: (event: MouseEvent<HTMLButtonElement>) => void;
  panelId?: string;
  open?: boolean;
}) {
  if (budget.level === "ok") return null;
  const over = budget.level === "over";
  return (
    <span role="status" data-testid="agent-budget" className={cn(pill, onDetails && "@max-[48rem]/chathead:rounded-md @max-[48rem]/chathead:p-0", over ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10")}
      title={`${formatUsd(budget.spentUsd)} of ${formatUsd(budget.monthlyUsd)} this month`}>
      {onDetails && <button type="button" aria-label="Monthly budget details" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
        className="hidden size-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus @max-[48rem]/chathead:flex" onClick={onDetails}>
        <Wallet size={16} className={over ? "text-danger" : "text-warning"} aria-hidden="true" /><span className="sr-only">{budgetStatus(budget)}</span>
      </button>}
      <span className={cn("contents", onDetails && "@max-[48rem]/chathead:hidden")}>
        <Wallet size={13} className={cn("shrink-0", over ? "text-danger" : "text-warning")} aria-hidden="true" />
        <span className="tabular-nums">{budgetStatus(budget)}</span>
        {onRaise && <button type="button" aria-haspopup={onDetails ? "dialog" : undefined} aria-expanded={open} aria-controls={open ? panelId : undefined}
          className="rounded-full px-1.5 font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={onRaise}>Raise budget</button>}
      </span>
    </span>
  );
}

function AgentBudgetControl({ budget, target }: { budget: AgentBudget; target: BudgetTarget }) {
  const [panel, setPanel] = useState<"details" | "edit" | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const boundary = useRef({ contains: (target: unknown) => target instanceof Node && Boolean(root.current?.contains(target) || dialog.current?.contains(target)) });
  const close = () => { setPanel(null); opener.current?.focus(); };
  usePopoverDismiss(panel !== null, boundary, close);
  useLayoutEffect(() => {
    if (!panel || !root.current) return;
    const header = root.current.closest<HTMLElement>('[data-glass-bar="top"]') ?? root.current;
    const update = () => {
      const width = Math.min(320, Math.max(0, window.innerWidth - 16));
      const top = Math.max(8, Math.min(header.getBoundingClientRect().bottom + 8, window.innerHeight - 96));
      setPosition({ width, top, left: Math.max(8, Math.min(root.current!.getBoundingClientRect().right - width, window.innerWidth - width - 8)), maxHeight: Math.max(80, window.innerHeight - top - 8) });
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(header);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [panel]);
  const toggle = (next: "details" | "edit", event: MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    setPanel(current => current === next ? null : next);
  };
  return (
    <span ref={root} className="shrink-0">
      <AgentBudgetPillView budget={budget} panelId={id} open={panel !== null} onDetails={event => toggle("details", event)} onRaise={budget.canRaise ? event => toggle("edit", event) : undefined} />
      {panel && position && createPortal(<div ref={dialog} id={id} role="dialog" aria-label="Monthly budget" aria-modal="false" style={position}
        className="fixed z-[45] overflow-y-auto rounded-xl border border-hairline/60 bg-menu p-3 text-[12.5px] text-ink">
        <div className="flex items-start justify-between gap-2"><span role="status" className="min-w-0 break-words">{budgetStatus(budget)}</span><button type="button" aria-label="Close monthly budget" autoFocus={panel === "details"} onClick={close} className="shrink-0 rounded p-1 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><X size={13} /></button></div>
        <p className="mt-1 text-ink-secondary">{formatUsd(budget.spentUsd)} of {formatUsd(budget.monthlyUsd)} this month</p>
        {panel === "edit" && budget.canRaise ? <BudgetEditor teamId={budget.teamId} target={target} label={budget.name} monthlyUsd={budget.monthlyUsd} onDone={close} />
          : budget.canRaise && <button type="button" onClick={() => setPanel("edit")} className="mt-2 rounded px-1 py-1 font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Raise budget</button>}
      </div>, document.body)}
    </span>
  );
}

export function AgentBudgetPill({ shared }: { shared?: SharedBotLink }) {
  const budget = useCloudQuery<AgentBudget | null>("budgets:forAgent", shared ? { agentId: shared.agentId } : "skip");
  if (!shared || !budget || budget.level === "ok") return null;
  const target = budget.scope === "project" && budget.projectId ? { projectId: budget.projectId } : { agentId: shared.agentId };
  return <AgentBudgetControl key={"projectId" in target ? target.projectId : target.agentId} budget={budget} target={target} />;
}
