import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { cloudMutation } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { parseBudgetInput } from "@/lib/agent-budget";
import { ghostButton, inputClass, primaryButton, useAction } from "./origin-pages/ui";

type BudgetTarget = { agentId: string } | { projectId: string };

/** Sets, changes or clears one agent's or one project's monthly budget. Workspace admins only. */
export function BudgetEditor({ teamId, target, label, monthlyUsd, onDone }: { teamId: string; target: BudgetTarget; label: string; monthlyUsd?: number; onDone(): void }) {
  const [value, setValue] = useState(monthlyUsd === undefined ? "" : String(monthlyUsd));
  const action = useAction();
  const parsed = parseBudgetInput(value);
  const save = async (amount: number | null) => {
    if (await action.run(() => cloudMutation("budgets:set", { teamId, ...target, monthlyUsd: amount }), "Could not save the budget")) onDone();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed === "invalid") return action.setError("Enter a monthly amount from $1, or leave it blank for no budget.");
    void save(parsed);
  };
  return (
    <form onSubmit={submit} className="mt-1.5 flex flex-wrap items-center gap-2 motion-safe:animate-pop-in" aria-label={`Monthly budget for ${label}`}>
      <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
        Monthly budget
        <span className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12.5px] text-ink-tertiary">$</span>
          <input className={cn(inputClass, "w-28 pl-5 tabular-nums")} inputMode="decimal" value={value} autoFocus placeholder="No limit"
            onChange={(event) => { setValue(event.target.value); action.setError(""); }}
            onKeyDown={(event) => { if (event.key === "Escape") onDone(); }} />
        </span>
      </label>
      <button className={cn(primaryButton, "min-h-7 px-2.5 py-1 text-[12.5px]")} disabled={action.busy}>
        {action.busy && <Loader2 size={13} className="animate-spin" />}Save
      </button>
      {monthlyUsd !== undefined && (
        <button type="button" className={cn(ghostButton, "min-h-7 px-2.5 py-1 text-[12.5px]")} disabled={action.busy} onClick={() => void save(null)}>Remove</button>
      )}
      <button type="button" className="text-[12.5px] text-ink-tertiary transition-colors duration-(--motion-fast) hover:text-ink" onClick={onDone}>Cancel</button>
      {action.error && <p role="alert" className="basis-full text-[12px] text-danger">{action.error}</p>}
    </form>
  );
}
