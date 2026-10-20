import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, GitPullRequest, MoveRight } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { openExternalLink } from "@/lib/app-links";
import { Loading } from "./ui";

type Issue = { taskId: string; title: string; column: string };
type Pull = { number: number; url: string; taskId: string; title: string; checks: string };
type Blocker = { kind: "approval" | "failed_run"; text: string; taskId?: string; agentName?: string };
export type Standup = {
  _id: string; projectId: string; projectName: string; accent: string; day: string; chiefName: string; since: number; createdAt: number;
  completed: Issue[]; moved: Issue[]; waiting: Pull[]; blockers: Blocker[];
};

function Section({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">{icon}{title}<span className="tabular-nums text-ink-tertiary">{count}</span></div>
      <ul className="flex flex-col gap-0.5 pl-5">{children}</ul>
    </div>
  );
}

const rowClass = "min-w-0 truncate text-[12.5px] text-ink";

/** The project Chief's daily standup, opened in place from its Inbox row. */
export function StandupDigest({ teamId, digestId, onOpenIssue }: { teamId: string; digestId: string; onOpenIssue(projectId: string, taskId: string): void }) {
  const digest = useCloudQuery<Standup | null>("standup:get", { teamId, digestId });
  if (digest === undefined) return <Loading label="Loading standup" variant="inline" />;
  if (!digest) return <p className="text-[12.5px] text-ink-tertiary">This standup is no longer available.</p>;
  const issue = (item: { taskId?: string; title: string }, extra?: ReactNode) => (
    <li key={`${item.taskId ?? ""}:${item.title}`} className="flex min-w-0 items-center gap-1.5">
      {item.taskId
        ? <button type="button" className={`${rowClass} text-left transition-colors duration-(--motion-fast) hover:text-accent-text`} onClick={() => onOpenIssue(digest.projectId, item.taskId!)}>{item.title}</button>
        : <span className={rowClass}>{item.title}</span>}
      {extra}
    </li>
  );
  return (
    <div className="flex flex-col gap-3 border-l-2 py-1 pl-3 motion-safe:animate-pop-in" style={{ borderColor: digest.accent }} aria-label={`${digest.chiefName}'s standup for ${digest.projectName}`}>
      <Section icon={<GitPullRequest size={12} className="text-accent-text" />} title="Waiting for your merge" count={digest.waiting.length}>
        {digest.waiting.map((pull) => (
          <li key={pull.number} className="flex min-w-0 items-center gap-1.5">
            <button type="button" className={`${rowClass} text-left transition-colors duration-(--motion-fast) hover:text-accent-text`} onClick={() => onOpenIssue(digest.projectId, pull.taskId)}>{pull.title}</button>
            <button type="button" className="shrink-0 text-[11.5px] tabular-nums text-ink-tertiary transition-colors duration-(--motion-fast) hover:text-ink" onClick={() => void openExternalLink(pull.url)}
              aria-label={`Open pull request #${pull.number} on GitHub`}>
              #{pull.number}<ExternalLink size={10} className="ml-0.5 inline" aria-hidden="true" />
            </button>
            {pull.checks !== "success" && pull.checks !== "none" && <span className="shrink-0 text-[11.5px] text-warning">checks {pull.checks}</span>}
          </li>
        ))}
      </Section>
      <Section icon={<AlertTriangle size={12} className="text-danger" />} title="Blockers" count={digest.blockers.length}>
        {digest.blockers.map((blocker) => issue(
          { ...(blocker.taskId ? { taskId: blocker.taskId } : {}), title: blocker.text },
          <span className="shrink-0 text-[11.5px] text-ink-tertiary">{blocker.kind === "approval" ? "needs approval" : "failed"}{blocker.agentName ? ` · ${blocker.agentName}` : ""}</span>,
        ))}
      </Section>
      <Section icon={<CheckCircle2 size={12} className="text-success" />} title="Done" count={digest.completed.length}>
        {digest.completed.map((item) => issue(item))}
      </Section>
      <Section icon={<MoveRight size={12} className="text-ink-secondary" />} title="Moved" count={digest.moved.length}>
        {digest.moved.map((item) => issue(item, item.column ? <span className="shrink-0 text-[11.5px] text-ink-tertiary">{item.column}</span> : null))}
      </Section>
    </div>
  );
}
