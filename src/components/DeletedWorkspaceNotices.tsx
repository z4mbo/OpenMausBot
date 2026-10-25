import { X } from "lucide-react";

export interface DeletedWorkspaceNotice { teamId: string; text: string }

/** Says once, without blocking, that a workspace this person was in is gone; it sits above the "create or join" screen. */
export function DeletedWorkspaceNotices({ notices, onDismiss }: { notices: readonly DeletedWorkspaceNotice[]; onDismiss(teamId: string): void }) {
  if (!notices.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[90] grid w-[320px] max-w-[calc(100vw-32px)] gap-2">
      {notices.map((notice) => (
        <div key={notice.teamId} role="status" data-deleted-workspace-notice className="flex items-start gap-2 rounded-xl border border-hairline/40 bg-panel px-3.5 py-2.5 text-[12.5px] text-ink shadow-2xl shadow-black/20">
          <p className="flex-1">{notice.text}</p>
          <button type="button" aria-label="Dismiss" onClick={() => onDismiss(notice.teamId)} className="-mr-1 rounded-md p-0.5 text-ink-tertiary hover:text-ink"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
