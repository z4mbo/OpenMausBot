import { useState } from "react";
import { CheckCircle2, ListChecks, Loader2, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Notice, cardClass, iconButton, primaryButton, useAction } from "./ui";

type ActionItem = { title: string; owner?: string; taskId?: string };
export type CallNote = {
  _id: string; callName: string; startedAt: number; minutes: number; keyPoints: string[]; decisions: string[];
  actionItems: ActionItem[]; chiefName: string | null; canCreate: boolean;
};

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Which items the person left ticked that are not issues yet. */
export function pendingPicks(items: readonly ActionItem[], unticked: ReadonlySet<number>): number[] {
  return items.flatMap((item, index) => (!item.taskId && !unticked.has(index) ? [index] : []));
}

export function CallActionItemsView({ note, busy, error, onCreate, onDismiss }: {
  note: CallNote; busy: boolean; error: string; onCreate(indexes: number[]): void; onDismiss(): void;
}) {
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const picks = pendingPicks(note.actionItems, unticked);
  const remaining = note.actionItems.filter((item) => !item.taskId).length;
  const toggle = (index: number) => setUnticked((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-4 md:px-6">
      <section className={cn(cardClass, "p-3 origin-rise")} aria-label="Action items from the last call">
        <div className="flex items-start gap-2">
          <ListChecks size={15} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-ink">Action items from {note.callName}</h3>
            <p className="text-[11.5px] text-ink-tertiary">{when(note.startedAt)} · {note.minutes} min</p>
          </div>
          {note.canCreate && <button type="button" className={cn(iconButton, "size-7")} onClick={onDismiss} aria-label="Dismiss these action items" title="Dismiss"><X size={14} /></button>}
        </div>
        <ul className="mt-2 flex flex-col gap-0.5">
          {note.actionItems.map((item, index) => (
            <li key={`${index}:${item.title}`}>
              {item.taskId ? (
                <span className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] text-ink-secondary">
                  <CheckCircle2 size={14} className="shrink-0 text-success" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-[11.5px] text-ink-tertiary">In Draft</span>
                </span>
              ) : (
                <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] text-ink transition-colors duration-(--motion-fast) hover:bg-raised/50">
                  <input type="checkbox" className="shrink-0 accent-[var(--color-accent)]" checked={!unticked.has(index)} disabled={!note.canCreate || busy} onChange={() => toggle(index)} />
                  <span className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>
                  {item.owner && <span className="shrink-0 text-[11.5px] text-ink-tertiary">{item.owner}</span>}
                </label>
              )}
            </li>
          ))}
        </ul>
        {error && <div className="mt-2"><Notice tone="danger">{error}</Notice></div>}
        {remaining > 0 && note.canCreate && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hairline/30 pt-2">
            <span className="min-w-0 flex-1 text-[12px] text-ink-tertiary">{note.chiefName ? `Draft issues for ${note.chiefName}` : "Draft issues assigned to you"}</span>
            <button type="button" className={primaryButton} disabled={busy || !picks.length} onClick={() => onCreate(picks)}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {picks.length === remaining ? `Create ${remaining === 1 ? "issue" : `all ${remaining}`}` : picks.length ? `Create ${picks.length} of ${remaining}` : "Tick items to create"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** After a call the agent summarised, its action items wait here as Draft issues to create in one click. */
export function CallActionItems({ projectId }: { projectId: string }) {
  const note = useCloudQuery<CallNote | null>("callNotes:latest", { projectId });
  const action = useAction();
  if (!note) return null;
  return (
    <CallActionItemsView key={note._id} note={note} busy={action.busy} error={action.error}
      onCreate={(indexes) => void action.run(() => cloudMutation("callNotes:createIssues", { noteId: note._id, indexes }), "Could not create the issues")}
      onDismiss={() => void action.run(() => cloudMutation("callNotes:dismiss", { noteId: note._id }), "Could not dismiss these items")} />
  );
}
