import { useEffect, useRef, useState, type Ref } from "react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCloudQuery } from "@/lib/origin-cloud";
import { budgetPercent, formatUsd, type AgentBudget } from "@/lib/agent-budget";
import type { SharedBotLink } from "../../shared/wire";
import { BudgetEditor } from "./BudgetEditor";

const pill = "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] text-ink";

export function AgentBudgetPillView({ budget, onRaise, raising, raiseRef }: { budget: AgentBudget; onRaise?: () => void; raising?: boolean; raiseRef?: Ref<HTMLButtonElement> }) {
  if (budget.level === "ok") return null;
  const over = budget.level === "over";
  const whose = budget.scope === "project" ? `${budget.name}'s project budget` : `${budget.name}'s budget`;
  return (
    <span role="status" data-testid="agent-budget" className={cn(pill, over ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10")}
      title={`${formatUsd(budget.spentUsd)} of ${formatUsd(budget.monthlyUsd)} this month`}>
      <Wallet size={13} className={cn("shrink-0", over ? "text-danger" : "text-warning")} aria-hidden="true" />
      <span className="tabular-nums">{over ? `${whose} is used up` : `${budgetPercent(budget)}% of ${whose}`}</span>
      {onRaise && (
        <button ref={raiseRef} type="button" aria-expanded={raising} className="rounded-full px-1.5 font-medium text-accent-text hover:underline" onClick={onRaise}>Raise budget</button>
      )}
    </span>
  );
}

/** A shared agent's monthly budget in its chat header: from 80% a warning, at 100% a stop an admin can lift here. */
export function AgentBudgetPill({ shared }: { shared?: SharedBotLink }) {
  const budget = useCloudQuery<AgentBudget | null>("budgets:forAgent", shared ? { agentId: shared.agentId } : "skip");
  const [raising, setRaising] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const raise = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!raising) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setRaising(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [raising]);
  if (!budget || budget.level === "ok") return null;
  const target = budget.scope === "project" && budget.projectId ? { projectId: budget.projectId } : { agentId: shared!.agentId };
  const close = () => {
    setRaising(false);
    raise.current?.focus();
  };
  return (
    <span ref={root} className="relative">
      <AgentBudgetPillView budget={budget} raising={raising} raiseRef={raise} onRaise={budget.canRaise ? () => setRaising((open) => !open) : undefined} />
      {raising && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-max max-w-[calc(100vw-32px)] rounded-xl border border-hairline/50 bg-menu p-2.5 origin-sheet-in"
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
          <BudgetEditor teamId={budget.teamId} target={target} label={budget.name} monthlyUsd={budget.monthlyUsd} onDone={close} />
        </div>
      )}
    </span>
  );
}
