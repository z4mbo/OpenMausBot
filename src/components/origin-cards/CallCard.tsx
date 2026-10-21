import { useState } from "react";
import { CheckCircle2, Loader2, Phone } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useOpenOriginIssue } from "@/lib/origin-issue-focus";
import { callCardItem } from "../../../shared/origin-chat-card-items";
import type { OriginChatCard } from "../../../shared/origin-chat-cards";
import { originIssueKey } from "../../../shared/origin-issues";
import { pendingPicks } from "../origin-pages/CallActionItems";
import { errorText } from "../origin-pages/repo-url";
import { CardFrame, dateTime, solidButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "call" }>;
type Live = { _id: string; chiefName: string | null; canCreate: boolean } | null;

function Points({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <h4 className="text-[11.5px] font-medium text-ink-tertiary">{title}</h4>
      <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4 text-[12.5px] leading-snug text-ink-secondary marker:text-ink-tertiary">
        {items.slice(0, 4).map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}
      </ul>
    </div>
  );
}

export function CallCard({ card }: { card: Card }) {
  const live = useCloudQuery<Live>("callNotes:latest", { projectId: card.projectId });
  const current = live && live._id === card.note.id ? live : null;
  const note = current ? callCardItem(current) : card.note;
  const opener = useItemOpener(card.projectId);
  const openIssue = useOpenOriginIssue();
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picks = pendingPicks(note.actionItems, unticked);
  const remaining = note.actionItems.filter((item) => !item.taskId).length;
  const toggle = (index: number) => setUnticked((ticked) => {
    const next = new Set(ticked);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  const draft = async () => {
    setBusy(true);
    setError("");
    try { await cloudMutation("callNotes:createIssues", { noteId: note.id, indexes: picks }); } catch (cause) { setError(errorText(cause, "Could not draft the issues")); } finally { setBusy(false); }
  };
  const canCreate = current?.canCreate ?? false;
  return (
    <CardFrame kind="call" label={`Call ${note.callName}`} icon={Phone} title={note.callName}
      meta={[card.projectName, dateTime(note.startedAt), `${note.minutes} min`].filter(Boolean).join(" · ")}
      openLabel="Open Call" onOpen={() => opener.open({ kind: "call", itemId: note.id })} openable={opener.openable}>
      <Points title="Decisions" items={note.decisions} />
      <Points title="Key points" items={note.keyPoints} />
      {note.actionItems.length > 0 && (
        <div className="mt-2.5 border-t border-hairline/30 pt-2">
          <h4 className="px-1 text-[11.5px] font-medium text-ink-tertiary">Action items</h4>
          <ul className="mt-1 flex flex-col gap-0.5" aria-label="Action items">
            {note.actionItems.map((item, index) => (
              <li key={`${index}:${item.title}`}>
                {item.taskId ? (
                  <button type="button" onClick={() => openIssue({ projectId: card.projectId, issueId: item.taskId! })} disabled={!opener.openable}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent/60">
                    <CheckCircle2 size={14} className="shrink-0 text-success" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-tertiary">{originIssueKey(item.taskId)}</span>
                  </button>
                ) : (
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] text-ink transition-colors duration-(--motion-fast) hover:bg-raised/50">
                    <input type="checkbox" className="shrink-0 accent-[var(--color-accent)]" checked={!unticked.has(index)} disabled={!canCreate || busy} onChange={() => toggle(index)} />
                    <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
                    {item.owner && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{item.owner}</span>}
                  </label>
                )}
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="mt-1 px-1 text-[12px] text-danger">{error}</p>}
          {remaining > 0 && (canCreate ? (
            <div className="mt-1.5 flex items-center gap-2 px-1">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-tertiary">{current?.chiefName ? `Drafts for ${current.chiefName}` : "Drafts assigned to you"}</span>
              <button type="button" className={solidButton} disabled={busy || !picks.length} onClick={() => void draft()}>
                {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}{picks.length === 1 ? "Draft 1 issue" : `Draft ${picks.length} issues`}
              </button>
            </div>
          ) : live !== undefined && <p className="mt-1 px-1 text-[12px] text-ink-tertiary">An editor drafts these as issues.</p>)}
        </div>
      )}
    </CardFrame>
  );
}
