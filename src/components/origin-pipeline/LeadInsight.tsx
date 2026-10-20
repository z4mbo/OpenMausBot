import { useState } from "react";
import { ChevronDown, CircleAlert, CircleDollarSign, Clock3, Flag, Reply, Send, ShieldCheck, UserRoundPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NextAction, NextActionKind } from "../../../shared/origin-pipeline-score";
import type { LeadInsight } from "./pipeline-model";

const ACTION_ICON: Record<NextActionKind, typeof Reply> = {
  reply: Reply, approve: ShieldCheck, overdue: CircleAlert, contact_info: UserRoundPlus, first_touch: Send, follow_up: Clock3, close: Flag, set_value: CircleDollarSign,
};

export function NextActionChip({ action }: { action: NextAction }) {
  const Icon = ACTION_ICON[action.kind];
  return (
    <span title={action.why} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[11px]",
      action.kind === "reply" ? "border-accent/40 text-accent-text" : action.kind === "overdue" ? "border-danger/40 text-danger" : "border-hairline/50 text-ink-secondary")}>
      <Icon size={10} aria-hidden="true" />{action.label}<span className="sr-only">: {action.why}</span>
    </span>
  );
}

const reasonText = (insight: LeadInsight) => insight.reasons.map((reason) => `${reason.points >= 0 ? "+" : ""}${reason.points} ${reason.label}`).join("\n");

export function ScoreBadge({ score }: { score: LeadInsight }) {
  return (
    <span title={reasonText(score)} aria-label={`Score ${score.score}: ${score.reasons.map((reason) => reason.label).join(", ")}`}
      className={cn("inline-flex min-w-7 justify-end tabular-nums", score.score >= 60 ? "font-medium text-ink" : score.score >= 30 ? "text-ink-secondary" : "text-ink-tertiary")}>
      {score.score}
    </span>
  );
}

/** The score and next steps in the lead drawer, with every rule that moved the score. */
export function InsightRow({ insight }: { insight: LeadInsight }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          className="flex h-6 items-center gap-1 rounded-full px-1.5 text-[12px] text-ink-secondary outline-none transition-colors hover:bg-raised/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
          Score <strong className="font-semibold tabular-nums text-ink">{insight.score}</strong>
          <ChevronDown size={12} className={cn("transition-transform duration-(--motion-fast)", open && "rotate-180")} aria-hidden="true" />
        </button>
        {insight.actions.map((action) => <NextActionChip key={action.kind} action={action} />)}
      </div>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-0.5 rounded-lg bg-raised/40 px-3 py-2 text-[12px] motion-safe:animate-[pop-in_var(--motion-fast)_var(--ease-out)]">
          {insight.reasons.map((reason) => (
            <li key={reason.label} className="flex items-center gap-2 text-ink-secondary">
              <span className={cn("w-8 text-right tabular-nums", reason.points > 0 ? "text-success" : reason.points < 0 ? "text-danger" : "text-ink-tertiary")}>{reason.points > 0 ? "+" : ""}{reason.points}</span>
              {reason.label}
            </li>
          ))}
          {insight.actions.map((action) => <li key={action.kind} className="pl-10 text-ink-tertiary">{action.label}: {action.why}</li>)}
        </ul>
      )}
    </div>
  );
}
