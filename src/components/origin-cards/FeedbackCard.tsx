import { useState } from "react";
import { ArrowUpRight, Bug, CirclePlus, Lightbulb, MessageSquareHeart } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useOpenOriginIssue } from "@/lib/origin-issue-focus";
import { cn } from "@/lib/cn";
import { originIssueKey } from "../../../shared/origin-issues";
import type { OriginChatCard, OriginFeedbackCardItem } from "../../../shared/origin-chat-cards";
import { ConvertFeedback } from "../origin-pages/FeedbackPage";
import { CardFrame, More, quietButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "feedback" }>;

const STATUS_TONE: Record<OriginFeedbackCardItem["status"], string> = {
  new: "bg-accent/12 text-accent-text", planned: "bg-raised/70 text-ink-secondary", completed: "bg-success/12 text-success", dismissed: "bg-raised/70 text-ink-tertiary",
};

export function FeedbackCard({ card }: { card: Card }) {
  const opener = useItemOpener(card.projectId);
  const openIssue = useOpenOriginIssue();
  const project = useCloudQuery<{ memberRole?: string }>("projects:get", { projectId: card.projectId });
  const canEdit = Boolean(project?.memberRole) && project?.memberRole !== "viewer";
  const [created, setCreated] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState<OriginFeedbackCardItem | null>(null);
  const single = card.entries.length === 1;
  return (
    <CardFrame kind="feedback" label={`Feedback: ${card.heading}`} icon={MessageSquareHeart} title={single ? card.entries[0]!.title : card.heading} meta={card.projectName}
      openLabel="Open in Feedback" onOpen={() => opener.open({ kind: "feedback", ...(single ? { itemId: card.entries[0]!.id } : {}) })} openable={opener.openable}>
      <ul className="mt-2 flex flex-col gap-1.5" aria-label="Feedback">
        {card.entries.map((entry) => {
          const taskId = created[entry.id] ?? entry.taskId;
          return (
            <li key={entry.id} className="rounded-xl bg-raised/40 px-2.5 py-2">
              <div className="flex items-center gap-2">
                {entry.kind === "bug" ? <Bug size={13} className="shrink-0 text-danger" aria-label="Bug" /> : <Lightbulb size={13} className="shrink-0 text-warning" aria-label="Idea" />}
                {!single && <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{entry.title}</span>}
                <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium capitalize", single && "mr-auto", STATUS_TONE[taskId ? "planned" : entry.status])}>{taskId && entry.status === "new" ? "planned" : entry.status}</span>
              </div>
              <p className={cn("mt-1 text-[12.5px] leading-snug text-ink-secondary [overflow-wrap:anywhere]", single ? "line-clamp-6" : "line-clamp-2")}>{entry.body}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {taskId ? (
                  <button type="button" className={quietButton} disabled={!opener.openable} title={opener.title} onClick={() => openIssue({ projectId: card.projectId, issueId: taskId })}>
                    <ArrowUpRight size={12} aria-hidden="true" />Issue {originIssueKey(taskId)}
                  </button>
                ) : canEdit && entry.status !== "dismissed" ? (
                  <button type="button" className={quietButton} onClick={() => setConverting(entry)}><CirclePlus size={12} aria-hidden="true" />Create issue</button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <More count={card.more} where="Feedback" />
      {converting && (
        <ConvertFeedback teamId={card.teamId} projectId={card.projectId} canEdit={canEdit} onClose={() => setConverting(null)}
          entry={{ _id: converting.id, title: converting.title, body: converting.body, kind: converting.kind, status: converting.status, createdAt: converting.createdAt }}
          onCreated={(taskId) => { setCreated((current) => ({ ...current, [converting.id]: taskId })); setConverting(null); }} />
      )}
    </CardFrame>
  );
}
