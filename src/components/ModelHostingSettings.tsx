import { useEffect, useId, useRef, useState } from "react";
import { Laptop, Plus, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useCloudQuery, type CloudProject, type CloudWorkspace } from "@/lib/origin-cloud";
import { t } from "@/lib/i18n";
import { Select } from "./Select";
import { ConfirmDialog } from "./ConfirmDialog";

export interface HostingSourceSettings {
  sourceKey?: string; sourceId?: string; instanceId: string; provider: string; label: string;
  billing: "subscription" | "metered" | "unknown"; models: string[]; enabled: boolean;
  projectIds: string[]; workspaceHead: boolean; capacity: number;
}
export interface ModelHostingReport {
  ready: boolean; reason?: string;
  computerName: string; teams: string[];
  hosts: Array<{ teamId: string; hostId: string; sources: HostingSourceSettings[] }>;
  instances: Array<{ instanceId: string; provider: string; displayName: string; available: boolean; billing: HostingSourceSettings["billing"]; models: string[] }>;
}

export function validateHostingDraft(draft: HostingSourceSettings, report: ModelHostingReport, projects: readonly CloudProject[] | undefined): boolean {
  if (!report.ready) return false;
  const basic = Boolean(draft.label.trim() && draft.label.trim().length <= 80 && draft.models.length && Number.isInteger(draft.capacity) && draft.capacity >= 1 && draft.capacity <= 8);
  if (!basic) return false;
  if (!draft.enabled && report.hosts.some(host => host.sources.some(source => source.sourceKey === draft.sourceKey && source.instanceId === draft.instanceId))) return true;
  const instance = report.instances.find(candidate => candidate.instanceId === draft.instanceId);
  return Boolean(instance?.available && instance.billing !== "unknown" && draft.label.trim() && draft.label.trim().length <= 80 &&
    draft.models.length && draft.models.every(model => instance.models.includes(model)) && Number.isInteger(draft.capacity) && draft.capacity >= 1 && draft.capacity <= 8 &&
    (!draft.enabled || draft.workspaceHead || draft.projectIds.length > 0) && projects && draft.projectIds.every(id => projects.some(project => project._id === id)));
}

const button = "rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40";
const field = "min-w-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[12px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40";

export function ModelHostingSettings() {
  const owner = useOwnerOrAdmin();
  const id = useId();
  const [report, setReport] = useState<ModelHostingReport | null>(null);
  const [teamId, setTeamId] = useState("");
  const [draft, setDraft] = useState<HostingSourceSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const workspaces = useCloudQuery<CloudWorkspace[]>("workspaces:list", owner === true && report?.ready ? {} : "skip");
  const projects = useCloudQuery<CloudProject[]>("projects:listForUser", owner === true && report?.ready && teamId ? { teamId } : "skip");
  const load = async () => {
    if (owner !== true || pending.current) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setError("");
    try {
      const result = await api<ModelHostingReport>("/api/origin/model-host", { signal: controller.signal });
      if (!controller.signal.aborted) setReport(result);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error && cause.message ? cause.message : t("modelHost.loadError")); }
  };
  useEffect(() => { if (owner === true) void load(); return () => request.current?.abort(); }, [owner]);
  const mutate = async (path: string, body: unknown) => {
    if (owner !== true || pending.current || !teamId || !report?.ready) return;
    pending.current = true; setBusy(true); setError(""); setSaved(false);
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      await api(path, { method: path.endsWith("/revoke") ? "POST" : "PUT", body: JSON.stringify(body), signal: controller.signal });
      if (controller.signal.aborted) return;
      const result = await api<ModelHostingReport>("/api/origin/model-host", { signal: controller.signal });
      if (controller.signal.aborted) return;
      setReport(result); setDraft(null); setRevoking(false); setSaved(true);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error && cause.message ? cause.message : t("modelHost.saveError")); }
    finally { pending.current = false; if (!controller.signal.aborted) setBusy(false); }
  };
  const update = (patch: Partial<HostingSourceSettings>) => { if (draft) { setDraft({ ...draft, ...patch }); setSaved(false); setError(""); } };
  const instances = report?.instances ?? [];
  const sources = report?.hosts.find(host => host.teamId === teamId)?.sources ?? [];
  const instance = instances.find(candidate => candidate.instanceId === draft?.instanceId);
  return <section data-model-hosting-settings className="min-w-0 border-t border-hairline/40 pt-4">
    <div className="flex items-start justify-between gap-2"><h3 className="text-[13px] font-medium text-ink">{t("modelHost.hostingTitle")}</h3><button type="button" disabled={owner !== true || busy} onClick={() => void load()} aria-label={t("modelHost.refreshSettings")} className="shrink-0 rounded p-1 text-ink-secondary hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"><RefreshCw size={13} /></button></div>
    {report?.ready && <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("modelHost.hostingHelp")}</p>}
    {owner !== true ? <p className="mt-2 text-[12px] text-ink-secondary">{t(owner === false ? "dailyApiBudget.ownerOnly" : "modelHost.loading")}</p> : !report ? <p role="status" className="mt-2 text-[12px] text-ink-secondary">{t(error ? "modelHost.loadError" : "modelHost.loading")}</p> : !report.ready ? <p role="status" className="mt-2 text-[12px] text-ink-secondary">{report.reason || t("modelHost.releaseUnavailable")}</p> : <div className="mt-3 grid min-w-0 gap-3">
      <p className="flex min-w-0 items-center gap-2 text-[12px] text-ink"><Laptop size={14} className="shrink-0 text-ink-secondary" /><span className="truncate">{report.computerName}</span></p>
      {report.teams.length === 0 ? <p className="text-[12px] text-ink-secondary">{t("modelHost.noWorkspace")}</p> : <Select size="sm" value={teamId} disabled={busy} aria-label={t("modelHost.workspace")} className="w-full min-w-0" onChange={event => { setTeamId(event.target.value); setDraft(null); setError(""); setSaved(false); }}>
        <option value="">{t("modelHost.chooseWorkspace")}</option>{report.teams.map(team => <option key={team} value={team}>{workspaces?.find(workspace => workspace._id === team)?.name ?? team}</option>)}
      </Select>}
      {teamId && <>
        <ul className="grid min-w-0 gap-2">{sources.map(source => <li key={source.sourceKey} className="flex min-w-0 items-start justify-between gap-2 rounded-lg border border-hairline/40 p-2.5">
          <div className="min-w-0"><div className="truncate text-[12px] font-medium text-ink">{source.label}</div><div className="mt-0.5 break-words text-[11px] text-ink-secondary">{t(source.enabled ? "modelHost.enabled" : "modelHost.disabled")} · {source.models.join(", ")}</div></div>
          <button type="button" disabled={busy} onClick={() => { setDraft({ ...source, models: [...source.models], projectIds: [...source.projectIds] }); setSaved(false); setError(""); }} className={button}>{t("modelHost.edit")}</button>
        </li>)}</ul>
        {!draft && <button type="button" disabled={busy || !instances.some(candidate => candidate.available && candidate.billing !== "unknown" && candidate.models.length > 0)} onClick={() => { setDraft({ sourceKey: crypto.randomUUID(), instanceId: "", provider: "", label: "", billing: "unknown", models: [], enabled: false, projectIds: [], workspaceHead: false, capacity: 1 }); setSaved(false); setError(""); }} className={`${button} flex w-fit items-center gap-1.5 border border-hairline/50`}><Plus size={13} />{t("modelHost.addSource")}</button>}
        {draft && <div className="grid min-w-0 gap-3 rounded-lg border border-hairline/50 p-3">
          <Select size="sm" value={draft.instanceId} disabled={busy} aria-label={t("modelHost.localAccount")} className="w-full min-w-0" onChange={event => { const selected = instances.find(candidate => candidate.instanceId === event.target.value); if (selected) update({ instanceId: selected.instanceId, provider: selected.provider, billing: selected.billing, models: [], label: selected.displayName, enabled: false }); }}>
            <option value="">{t("modelHost.chooseAccount")}</option>{instances.map(candidate => <option key={candidate.instanceId} value={candidate.instanceId} disabled={!candidate.available || candidate.billing === "unknown" || candidate.models.length === 0}>{candidate.displayName}</option>)}
          </Select>
          <label className="grid min-w-0 gap-1 text-[12px] text-ink-secondary" htmlFor={`${id}-label`}>{t("modelHost.label")}<input id={`${id}-label`} value={draft.label} maxLength={80} disabled={busy} onChange={event => update({ label: event.target.value })} className={field} /></label>
          {instance && <fieldset className="grid min-w-0 gap-1.5"><legend className="mb-1.5 text-[12px] text-ink-secondary">{t("modelHost.models")}</legend>{[...new Set([...instance.models, ...draft.models])].map(model => <label key={model} className="flex min-w-0 items-start gap-2 text-[12px] text-ink"><input type="checkbox" checked={draft.models.includes(model)} disabled={busy} onChange={event => update({ models: event.target.checked ? [...draft.models, model] : draft.models.filter(value => value !== model) })} className="mt-0.5 shrink-0 accent-accent" /><span className="min-w-0 break-words">{model}{!instance.models.includes(model) && ` · ${t("modelHost.unavailable")}`}</span></label>)}</fieldset>}
          <fieldset className="grid min-w-0 gap-2"><legend className="mb-2 text-[12px] text-ink-secondary">{t("modelHost.allowedScope")}</legend>
            <label className="flex items-start gap-2 text-[12px] text-ink"><input type="checkbox" checked={draft.workspaceHead} disabled={busy} onChange={event => update({ workspaceHead: event.target.checked })} className="mt-0.5 shrink-0 accent-accent" />{t("modelHost.workspaceHead")}</label>
            {!projects ? <p role="status" className="text-[12px] text-ink-secondary">{t("modelHost.loadingProjects")}</p> : projects.map(project => <label key={project._id} className="flex min-w-0 items-start gap-2 text-[12px] text-ink"><input type="checkbox" checked={draft.projectIds.includes(project._id)} disabled={busy} onChange={event => update({ projectIds: event.target.checked ? [...draft.projectIds, project._id] : draft.projectIds.filter(value => value !== project._id) })} className="mt-0.5 shrink-0 accent-accent" /><span className="min-w-0 break-words">{project.name}</span></label>)}
            {projects && draft.projectIds.filter(projectId => !projects.some(project => project._id === projectId)).map(projectId => <label key={projectId} className="flex min-w-0 items-start gap-2 text-[12px] text-ink-secondary"><input type="checkbox" checked disabled={busy} onChange={() => update({ projectIds: draft.projectIds.filter(value => value !== projectId) })} className="mt-0.5 shrink-0 accent-accent" /><span className="min-w-0 break-words">{t("modelHost.unavailableProject")}</span></label>)}
          </fieldset>
          <label htmlFor={`${id}-capacity`} className="grid min-w-0 gap-1 text-[12px] text-ink-secondary">{t("modelHost.capacity")}<input id={`${id}-capacity`} type="number" min={1} max={8} step={1} value={draft.capacity} disabled={busy} onChange={event => update({ capacity: Number(event.target.value) })} className={field} /></label>
          <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => update({ enabled: event.target.checked })} className="mt-0.5 shrink-0 accent-accent" />{t("modelHost.enableConsent")}</label>
          <p className="text-[11px] leading-relaxed text-ink-secondary">{t(draft.billing === "metered" ? "modelHost.hostMetered" : "modelHost.hostPlan")}</p>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !validateHostingDraft(draft, report, projects)} onClick={() => void mutate("/api/origin/model-host/sources", { teamId, ...(draft.sourceKey ? { sourceKey: draft.sourceKey } : {}), instanceId: draft.instanceId, label: draft.label.trim(), models: draft.models, enabled: draft.enabled, projectIds: draft.projectIds, workspaceHead: draft.workspaceHead, capacity: draft.capacity })} className={`${button} bg-accent font-medium text-accent-ink`}>{t(busy ? "settings.threads.saving" : "common.save")}</button><button type="button" disabled={busy} onClick={() => { setDraft(null); setError(""); }} className={button}>{t("common.cancel")}</button></div>
        </div>}
        {sources.length > 0 && <button type="button" disabled={busy} onClick={() => setRevoking(true)} className={`${button} w-fit text-danger`}>{t("modelHost.revoke")}</button>}
      </>}
      {saved && <p role="status" className="text-[12px] text-ink-secondary">{t("modelHost.saved")}</p>}
    </div>}
    {error && <p role="alert" className="mt-2 break-words text-[12px] text-danger">{error}</p>}
    <ConfirmDialog open={revoking} pending={busy} title={t("modelHost.revokeTitle")} body={t("modelHost.revokeBody")} tone="neutral" confirmLabel={t("modelHost.revoke")} onCancel={() => setRevoking(false)} onConfirm={() => void mutate("/api/origin/model-host/revoke", { teamId })} />
  </section>;
}
