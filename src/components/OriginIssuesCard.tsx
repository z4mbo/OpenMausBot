import { Circle, CircleDot } from "lucide-react";
import type { Message } from "@/state/store";
import { useCanOpenOriginProject, useOpenOriginIssue } from "@/lib/origin-issue-focus";
import type { CloudTask } from "./origin-pages/cloud-types";
import { laneTone } from "./origin-pages/issue-fields";
import { TaskCard } from "./origin-pages/IssuesPage";
import type { OriginIssueCard } from "../../shared/origin-issues";
import { CardFrame, More } from "./origin-cards/CardFrame";

function asTask(issue: OriginIssueCard): CloudTask {
  return {
    _id: issue.id, columnId: issue.status, title: issue.title, priority: issue.priority, done: issue.done,
    ...(issue.due ? { dueDate: issue.due } : {}), ...(issue.labels ? { labels: issue.labels } : {}),
    ...(issue.assignee ? { assignedToName: issue.assignee } : {}),
    order: 0, createdAt: 0, updatedAt: 0,
  };
}

function ChatIssue({ issue }: { issue: OriginIssueCard }) {
  const open = useOpenOriginIssue();
  const openable = useCanOpenOriginProject(issue.projectId);
  return (
    <li data-origin-issue={issue.id} data-openable={openable || undefined}
      title={openable ? undefined : "No project in this app is linked to this Origin project"}>
      <TaskCard task={asTask(issue)} columns={[]} canEdit={false} agents={[]}
        assignee={issue.assignee ? { email: issue.assignee, name: issue.assignee } : undefined}
        onOpen={() => { if (openable) open({ projectId: issue.projectId, issueId: issue.id }); }} />
    </li>
  );
}

/** Issues an Origin tool returned, drawn with the Issues board's own cards and lanes. */
export function OriginIssuesCard({ message }: { message: Message }) {
  const cards = message.originIssues;
  if (!cards?.issues.length) return null;
  const projects = new Set(cards.issues.map((issue) => issue.projectId));
  const lanes = new Map<string, OriginIssueCard[]>();
  for (const issue of cards.issues) {
    const lane = `${projects.size > 1 ? `${issue.projectName ?? issue.projectId} · ` : ""}${issue.status || "Open"}`;
    lanes.set(lane, [...(lanes.get(lane) ?? []), issue]);
  }
  return (
    <CardFrame kind="issues" data={{ "data-origin-issues": message.id }} label={cards.heading} icon={CircleDot} title={cards.heading}
      meta={projects.size === 1 ? cards.issues[0]!.projectName : undefined}>
      {[...lanes].map(([lane, issues]) => (
        <div key={lane} className="mt-2.5">
          <div className="flex items-center gap-2 px-0.5 pb-1.5">
            <Circle size={11} strokeWidth={2.5} className={laneTone(issues[0]!.done ? "done" : issues[0]!.status)} aria-hidden="true" />
            <strong className="truncate text-[12px] font-medium text-ink-secondary">{lane}</strong>
            <span className="text-[12px] tabular-nums text-ink-tertiary">{issues.length}</span>
          </div>
          <ol className="flex flex-col gap-2 p-0.5" aria-label={`${lane} issues`}>
            {issues.map((issue) => <ChatIssue key={`${issue.projectId}:${issue.id}`} issue={issue} />)}
          </ol>
        </div>
      ))}
      <More count={cards.more} where="Origin" />
    </CardFrame>
  );
}
