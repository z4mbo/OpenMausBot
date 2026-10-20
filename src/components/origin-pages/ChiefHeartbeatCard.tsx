import { HeartPulse, Loader2 } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { Field, Notice, cardClass, useAction } from "./ui";

type HeartbeatSettings = { enabled: boolean; intervalHours: number; staleDays: number; lastRunAt?: number; canEdit: boolean; chiefName: string | null };

const INTERVALS = [1, 2, 4, 8, 12, 24];
const STALE_DAYS = [1, 2, 3, 5, 7, 14];

function since(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** The project's opt-in Chief heartbeat: how often it checks and when an issue counts as stale. */
export function ChiefHeartbeatCard({ projectId }: { projectId: string }) {
  const settings = useCloudQuery<HeartbeatSettings>("chiefHeartbeat:settings", { projectId });
  const action = useAction();
  if (!settings) return null;
  const save = (patch: Partial<Pick<HeartbeatSettings, "enabled" | "intervalHours" | "staleDays">>) => void action.run(
    () => cloudMutation("chiefHeartbeat:configure", { projectId, enabled: settings.enabled, intervalHours: settings.intervalHours, staleDays: settings.staleDays, ...patch }),
    "Could not save the heartbeat",
  );
  const chief = settings.chiefName ?? "The Chief";
  const disabled = !settings.canEdit || action.busy;
  return (
    <section className={cn(cardClass, "p-4")} aria-label="Chief heartbeat">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><span className="text-ink-secondary"><HeartPulse size={15} /></span>Chief heartbeat</h3>
        {action.busy && <Loader2 size={13} className="animate-spin text-ink-tertiary" aria-hidden="true" />}
        <button type="button" role="switch" aria-checked={settings.enabled} aria-label="Chief heartbeat" disabled={disabled || !settings.chiefName} onClick={() => save({ enabled: !settings.enabled })}
          className="ml-auto flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] text-ink-secondary transition-colors duration-(--motion-fast) hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60">
          <span className={cn("relative h-4 w-7 rounded-full transition-colors duration-(--motion-fast)", settings.enabled ? "bg-success" : "bg-raised")}>
            <span className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-all duration-(--motion-fast)", settings.enabled ? "left-3.5" : "left-0.5")} />
          </span>
          {settings.enabled ? "On" : "Off"}
        </button>
      </div>
      <p className="mb-3 text-[12.5px] text-ink-secondary">
        {settings.chiefName
          ? `${chief} checks for stale issues, blocked agents and PRs waiting, and writes one note in its Heartbeat chat only when something needs you. Runs on a member's open app with the cheap helper model, within budget.`
          : "Publish this project's Chief to turn on its heartbeat."}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check every">
          <Select className="w-full" value={String(settings.intervalHours)} disabled={disabled} onChange={(event) => save({ intervalHours: Number(event.target.value) })}>
            {INTERVALS.map((hours) => <option key={hours} value={hours}>{hours === 1 ? "Hour" : `${hours} hours`}</option>)}
          </Select>
        </Field>
        <Field label="Stale after">
          <Select className="w-full" value={String(settings.staleDays)} disabled={disabled} onChange={(event) => save({ staleDays: Number(event.target.value) })}>
            {STALE_DAYS.map((days) => <option key={days} value={days}>{days === 1 ? "1 day" : `${days} days`}</option>)}
          </Select>
        </Field>
      </div>
      {settings.enabled && settings.lastRunAt && <p className="mt-2 text-[12px] text-ink-tertiary">Last check {since(settings.lastRunAt)}</p>}
      {action.error && <div className="mt-2"><Notice tone="danger">{action.error}</Notice></div>}
      {!settings.canEdit && <div className="mt-2"><Notice>Only project owners and admins can change the heartbeat.</Notice></div>}
    </section>
  );
}
