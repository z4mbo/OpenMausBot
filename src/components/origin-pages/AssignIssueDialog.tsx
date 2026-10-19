import { useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import type { AssignableIssue } from "./IssuesPage";
import { CenteredDialog } from "../CenteredDialog";
import { iconButton } from "./ui";

export { implementBrief, issueBrief } from "../../../shared/origin-issues";

export function AssignIssueDialog({ issue, agents, onPick, onClose }: { issue: AssignableIssue; agents: Bot[]; onPick(agent: Bot): void; onClose(): void }) {
  const titleId = useId();
  return createPortal(
    <CenteredDialog label="Assign to an agent" labelledBy={titleId} onClose={onClose} className="p-5 sm:max-w-[420px]">{(dismiss) => <>
        <div className="mb-1 flex items-center justify-between">
          <h2 id={titleId} className="text-[16px] font-semibold text-ink">Assign to an agent</h2>
          <button type="button" aria-label="Close" onClick={dismiss} className={iconButton}><X size={16} /></button>
        </div>
        <p className="mb-4 truncate text-[12.5px] text-ink-secondary">{issue.key} · {issue.title}</p>
        {agents.length === 0
          ? <p className="text-[13px] text-ink-secondary">This project has no agents yet.</p>
          : <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {agents.map((agent, index) => (
              <li key={agent.id} className="origin-rise" style={{ animationDelay: `${Math.min(index, 6) * 20}ms` }}>
                <button type="button" onClick={() => onPick(agent)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60">
                  <BotAvatar bot={agent} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{agent.name}</span>
                </button>
              </li>
            ))}
          </ul>}
      </>}</CenteredDialog>,
    document.body,
  );
}
