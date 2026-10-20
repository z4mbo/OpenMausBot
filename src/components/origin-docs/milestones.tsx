import { useState, type FormEvent } from "react";
import { Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { MILESTONE_LIMITS, milestoneDay, milestonePercent, type MilestoneList, type MilestoneSummary } from "../../../shared/origin-milestones";
import { Field, Modal, Notice, chipButton, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { ChipSelect } from "../origin-pages/issue-fields";

export function useMilestones(projectId: string): MilestoneList | undefined {
  const list = useCloudQuery<MilestoneList>("projectMilestones:list", { projectId });
  return list && Array.isArray(list.milestones) ? list : undefined;
}

export function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const percent = milestonePercent({ done, total });
  return (
    <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${done} of ${total} done`}
      className={cn("block h-1.5 overflow-hidden rounded-full bg-inset", className)}>
      <span className={cn("block h-full rounded-full transition-[width] duration-(--motion-slow) ease-out motion-reduce:transition-none", percent === 100 ? "bg-success" : "bg-accent")} style={{ width: `${percent}%` }} />
    </span>
  );
}

/** One milestone as a row: name, target day, a progress bar and done of total. */
export function MilestoneRow({ milestone, onOpen }: { milestone: MilestoneSummary; onOpen?(): void }) {
  const day = milestoneDay(milestone.targetDate);
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Flag size={13} aria-hidden="true" className={milestone.total && milestone.done === milestone.total ? "text-success" : "text-ink-tertiary"} />
        <span className="truncate text-[13px] font-medium text-ink">{milestone.title}</span>
        {day && <span className="shrink-0 text-[12px] text-ink-tertiary">{day}</span>}
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-ink-secondary">{milestone.done}/{milestone.total}</span>
      </span>
      <ProgressBar done={milestone.done} total={milestone.total} className="mt-1.5" />
    </>
  );
  return onOpen
    ? <button type="button" onClick={onOpen} className="block w-full rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-raised/50 focus-visible:ring-2 focus-visible:ring-accent/60">{body}</button>
    : <div className="px-2 py-2">{body}</div>;
}

/** The Issues board's milestone filter: every issue, or one milestone's, each with its progress. */
export function MilestoneStrip({ projectId, list, selected, onSelect }: { projectId: string; list: MilestoneList; selected: string | null; onSelect(id: string | null): void }) {
  const [editing, setEditing] = useState<MilestoneSummary | "new" | null>(null);
  if (!list.milestones.length && !list.canEdit) return null;
  const current = list.milestones.find((milestone) => milestone._id === selected);
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Milestones">
      <button type="button" aria-pressed={!current} onClick={() => onSelect(null)} className={cn(chipButton, "shrink-0", !current && "border-accent/50 text-ink")}>All issues</button>
      {list.milestones.map((milestone) => {
        const on = milestone._id === current?._id;
        return (
          <button key={milestone._id} type="button" aria-pressed={on} onClick={() => onSelect(on ? null : milestone._id)} title={milestoneDay(milestone.targetDate) || undefined}
            className={cn(chipButton, "shrink-0 gap-2", on && "border-accent/50 text-ink")}>
            <Flag size={12} aria-hidden="true" />
            <span className="truncate">{milestone.title}</span>
            <ProgressBar done={milestone.done} total={milestone.total} className="w-10" />
            <span className="tabular-nums text-ink-tertiary">{milestone.done}/{milestone.total}</span>
          </button>
        );
      })}
      {list.canEdit && current && <button type="button" className={iconButton} aria-label={`Edit ${current.title}`} title="Edit milestone" onClick={() => setEditing(current)}><Pencil size={14} /></button>}
      {list.canEdit && <button type="button" className={cn(chipButton, "shrink-0 border-dashed")} onClick={() => setEditing("new")}><Plus size={13} />Milestone</button>}
      {editing && <MilestoneDialog projectId={projectId} milestone={editing === "new" ? null : editing}
        onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); onSelect(id); }} />}
    </div>
  );
}

export function MilestoneDialog({ projectId, milestone, onClose, onSaved }: { projectId: string; milestone: MilestoneSummary | null; onClose(): void; onSaved(id: string | null): void }) {
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [targetDate, setTargetDate] = useState(milestone?.targetDate ?? "");
  const action = useAction();
  const save = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const id = await cloudMutation<string>("projectMilestones:save", { projectId, ...(milestone ? { milestoneId: milestone._id } : {}), title, targetDate });
      onSaved(id);
    }, "Could not save the milestone");
  };
  const remove = () => {
    if (!milestone || !window.confirm(`Delete ${milestone.title}? Its issues stay on the board.`)) return;
    void action.run(async () => {
      await cloudMutation("projectMilestones:remove", { projectId, milestoneId: milestone._id });
      onSaved(null);
    }, "Could not delete the milestone");
  };
  return (
    <Modal title={milestone ? "Edit milestone" : "New milestone"} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={save}>
        <Field label="Name"><input autoFocus className={inputClass} maxLength={MILESTONE_LIMITS.title} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="MVP" /></Field>
        <Field label="Target date">
          <input type="date" className={inputClass} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} style={{ colorScheme: "var(--code-color-scheme)" }} />
        </Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex items-center gap-2">
          {milestone && <button type="button" className={cn(ghostButton, "text-danger")} disabled={action.busy} onClick={remove}><Trash2 size={14} />Delete</button>}
          <button type="submit" className={cn(primaryButton, "ml-auto")} disabled={action.busy || !title.trim()}>{milestone ? "Save" : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** The milestone chip of an issue's detail. */
export function MilestoneChip({ projectId, taskId, milestoneId, canEdit, onError }: { projectId: string; taskId: string; milestoneId?: string; canEdit: boolean; onError(message: string): void }) {
  const list = useMilestones(projectId);
  if (!list?.milestones.length) return null;
  const options = [{ value: "", label: "No milestone" }, ...list.milestones.map((milestone) => ({ value: milestone._id, label: milestone.title, hint: milestoneDay(milestone.targetDate) || undefined, icon: <Flag size={13} aria-hidden="true" /> }))];
  return (
    <ChipSelect label="Milestone" value={milestoneId ?? ""} options={options} disabled={!canEdit || !list.canEdit} icon={<Flag size={14} aria-hidden="true" />} placeholder="Milestone"
      onChange={(value) => void cloudMutation("projectMilestones:assign", { projectId, milestoneId: value || null, taskIds: [taskId] }).catch((error: unknown) => onError(error instanceof Error ? error.message : "Could not change the milestone"))} />
  );
}
