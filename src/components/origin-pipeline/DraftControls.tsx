import { Check, Loader2, Pencil, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { ghostButton, inputClass, primaryButton } from "../origin-pages/ui";
import type { PipelineActivity } from "../../../shared/origin-pipeline";
import type { useActivityActions } from "./activity-actions";

type Actions = ReturnType<typeof useActivityActions>;

const small = "h-7 min-h-7 rounded-full px-3 text-[12px]";

export function DraftFields({ activity, actions }: { activity: PipelineActivity; actions: Actions }) {
  const { draft, setDraft } = actions;
  if (!draft) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {activity.subject !== undefined && <input className={inputClass} aria-label="Subject" value={draft.subject} maxLength={300} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />}
      {activity.goal !== undefined && <textarea className={cn(inputClass, "min-h-[84px] resize-y")} aria-label="Call goal" value={draft.goal} maxLength={8000} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} />}
      {activity.body !== undefined && <textarea className={cn(inputClass, "min-h-[96px] resize-y")} aria-label="Message" value={draft.body} maxLength={20000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />}
    </div>
  );
}

export function hasControls(activity: PipelineActivity): boolean {
  return activity.status === "pending" || activity.status === "failed" || activity.status === "approved" || (activity.status === "in_progress" && activity.kind === "ai_call");
}

export function ActivityControls({ activity, actions }: { activity: PipelineActivity; actions: Actions }) {
  const { action, draft, setDraft } = actions;
  const spinner = <Loader2 size={12} className="animate-spin" />;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {activity.status === "pending" && <>
        <button type="button" className={cn(primaryButton, small)} disabled={action.busy} onClick={() => void actions.approve()}>
          {action.busy ? spinner : <Check size={12} />}Approve and send
        </button>
        {draft
          ? <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={() => setDraft(null)}>Cancel edits</button>
          : <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={actions.edit}><Pencil size={12} />Edit</button>}
        <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={() => void actions.discard()}>Discard</button>
      </>}
      {(activity.status === "failed" || activity.status === "approved") && (
        <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={() => void actions.send()}>
          {action.busy ? spinner : <RotateCw size={12} />}{activity.status === "failed" ? "Retry" : "Send"}
        </button>
      )}
      {activity.status === "in_progress" && (
        <button type="button" className={cn(ghostButton, small)} disabled={action.busy} onClick={() => void actions.check()}>
          {action.busy ? spinner : <RotateCw size={12} />}Check now
        </button>
      )}
      {action.error && <span className="text-[12px] text-danger" role="alert">{action.error}</span>}
    </div>
  );
}
