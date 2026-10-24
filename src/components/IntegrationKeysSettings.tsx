// Security: secrets are write-only; GET /api/integrations returns which fields are set, never a secret's value.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { useWorkspaceAccess } from "@/lib/origin-members";
import { sessionStore } from "@/lib/origin-cloud/client";
import { canManageProject, useOriginProjects } from "@/lib/origin-project-state";
import { useActiveOriginWorkspace } from "@/lib/use-origin-workspace";
import { Card } from "./SettingsPrimitives";
import { Select } from "./Select";
import { WorkspaceGitHubCard } from "./origin-members/WorkspaceGitHubCard";
import { ConnectStackChecklist, INTEGRATION_FOCUS_EVENT } from "./integrations/ConnectStackChecklist";
import { CheckButton, CheckResult, integrationsChanged, runIntegrationCheck } from "./integrations/integration-check";
import type { IntegrationStatus, SharedIntegration } from "../../shared/integration-keys";


let focusRequest: string | null = null;

/** Opens this integration's row the next time the Integrations settings mount. */
export function requestIntegrationFocus(id: string): void {
  focusRequest = id;
}

export function IntegrationKeysSettings() {
  const { teamId } = useActiveOriginWorkspace();
  return (<>
    <ConnectStackChecklist teamId={teamId} canEdit />
    <Card subtitle="Keys for the services your projects connect to, such as the deploy targets Ship uses. Yours stay on this computer and are never shown again after saving; an owner or admin can share theirs with the whole workspace or with one project, and a key of your own always wins over a shared one.">
      {teamId && <div className="-mx-1 mb-1 border-b border-hairline/30 pb-1"><WorkspaceGitHubCard teamId={teamId} /></div>}
      <IntegrationKeyList teamId={teamId} />
    </Card>
  </>);
}

type ShareTarget = { projectId: string | null; label: string };

type ProjectScope = { id: string; name: string; canManage: boolean };

/** Every integration as this person's server would use it for the workspace, or for one project when `project` is given. */
export function IntegrationKeyList({ teamId, project }: { teamId: string | null; project?: ProjectScope }) {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [error, setError] = useState("");
  const [sharedError, setSharedError] = useState("");
  const access = useWorkspaceAccess(teamId);
  const { rows: projects } = useOriginProjects(project ? null : teamId);
  const workspaceAdmin = access?.role === "owner" || access?.role === "admin";
  const targets: ShareTarget[] = !teamId ? [] : [
    ...(project?.canManage ? [{ projectId: project.id, label: `Only ${project.name}` }] : []),
    ...(workspaceAdmin ? [{ projectId: null, label: "The whole workspace" }] : []),
    ...(project ? [] : (projects ?? []).filter((row) => workspaceAdmin || canManageProject(row)).map((row) => ({ projectId: row._id, label: `Only ${row.name}` }))),
  ];
  const [open, setOpen] = useState<string | null>(() => {
    const id = focusRequest;
    focusRequest = null;
    return id;
  });
  const query = new URLSearchParams({ ...(teamId ? { teamId } : {}), ...(project ? { projectId: project.id } : {}) }).toString();
  const load = useCallback(() => api<{ integrations: IntegrationStatus[]; sharedError?: string | null }>(`/api/integrations${query ? `?${query}` : ""}`)
    .then((body) => { setIntegrations(body.integrations); setSharedError(body.sharedError ?? ""); setError(""); }), [query]);
  useEffect(() => {
    let live = true;
    load().catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [load]);
  useEffect(() => {
    const focus = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      setOpen(id);
      requestAnimationFrame(() => document.querySelector(`[data-integration="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    };
    window.addEventListener(INTEGRATION_FOCUS_EVENT, focus);
    return () => window.removeEventListener(INTEGRATION_FOCUS_EVENT, focus);
  }, []);
  const replace = (next: IntegrationStatus) => setIntegrations((current) => current?.map((entry) => (entry.id === next.id ? next : entry)) ?? null);
  return (
    <>
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {sharedError && <p className="text-[12.5px] text-ink-tertiary">Shared keys are unavailable right now: {sharedError}</p>}
      {!integrations && !error && <div className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" />Loading</div>}
      {integrations && (
        <div className="-mx-1 flex flex-col">
          {integrations.map((integration) => (
            <IntegrationRow key={integration.id} integration={integration} open={open === integration.id} teamId={teamId} project={project ?? null}
              targets={targets} workspaceAdmin={workspaceAdmin}
              onToggle={() => setOpen((current) => (current === integration.id ? null : integration.id))} onSaved={replace} onShared={load} />
          ))}
        </div>
      )}
    </>
  );
}

const sessionHeaders = () => ({ "content-type": "application/json", "x-origin-session": sessionStore.get() ?? "" });

function shareLabel(share: SharedIntegration): string {
  return share.projectName ? `Shared by ${share.by} for ${share.projectName} only` : `Shared by ${share.by} with the workspace`;
}

const visibleShares = (integration: IntegrationStatus, project: ProjectScope | null) =>
  integration.shares.filter((share) => !project || !share.projectId || share.projectId === project.id);

function rowSummary(integration: IntegrationStatus, project: ProjectScope | null, anySet: boolean): string {
  if (integration.source === "yours") return visibleShares(integration, project).length ? "Yours · shared" : "Yours";
  if (integration.source === "shared" && integration.shared) return shareLabel(integration.shared);
  const projectOnly = visibleShares(integration, project).flatMap((share) => (share.projectName ? [share.projectName] : []));
  if (projectOnly.length) return `Shared for ${projectOnly.join(", ")} only`;
  return anySet ? "Incomplete" : "";
}

function IntegrationRow({ integration, open, teamId, project, targets, workspaceAdmin, onToggle, onSaved, onShared }: {
  integration: IntegrationStatus; open: boolean; teamId: string | null; project: ProjectScope | null; targets: ShareTarget[]; workspaceAdmin: boolean;
  onToggle(): void; onSaved(next: IntegrationStatus): void; onShared(): Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const anySet = integration.fields.some((field) => field.set);
  const dirty = Object.entries(draft).some(([name, value]) => {
    const field = integration.fields.find((candidate) => candidate.name === name);
    return field?.secret ? value.trim() !== "" : value.trim() !== (field?.value ?? "");
  });
  const shares = visibleShares(integration, project);
  const checkScope = { teamId, projectId: project?.id };
  const chosen = targets.find((candidate) => target !== null && (candidate.projectId ?? "") === target) ?? targets[0];
  const canStop = (share: SharedIntegration) => (share.projectId ? targets.some((candidate) => candidate.projectId === share.projectId) : workspaceAdmin);
  const work = async (request: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await request();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const send = (request: Promise<{ integration: IntegrationStatus }>) => work(async () => {
    const next = (await request).integration;
    onSaved(next);
    setDraft({});
    if (next.configured) void runIntegrationCheck(next.id, checkScope);
    else integrationsChanged();
  });
  const shareRequest = (method: "POST" | "DELETE", projectId: string | null) => work(async () => {
    const query = new URLSearchParams({ teamId: teamId ?? "", ...(projectId ? { projectId } : {}) }).toString();
    await api(`/api/integrations/${integration.id}/share?${query}`, { method, headers: sessionHeaders() });
    await onShared();
  });
  const stop = (share: SharedIntegration) => {
    const who = share.projectName ? `${share.projectName}'s members` : "Members";
    if (window.confirm(`Stop sharing ${integration.label}${share.projectName ? ` with ${share.projectName}` : ""}? ${who} without a key of their own lose it.`)) void shareRequest("DELETE", share.projectId);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || busy) return;
    const fields = Object.fromEntries(Object.entries(draft).filter(([name, value]) => {
      const field = integration.fields.find((candidate) => candidate.name === name);
      return field?.secret ? value.trim() !== "" : true;
    }));
    void send(api(`/api/integrations/${integration.id}`, { method: "PUT", body: JSON.stringify({ fields }) }));
  };
  const summary = rowSummary(integration, project, anySet);
  return (
    <div data-integration={integration.id} className="rounded-lg">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13.5px] text-ink outline-none transition-colors hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-accent/60">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", integration.configured ? "bg-success" : anySet ? "bg-warning" : "bg-raised-hover")} />
        <span className="flex-1 font-medium">{integration.label}</span>
        <span className="min-w-0 max-w-[60%] truncate text-[12px] text-ink-secondary" title={summary}>{summary}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform duration-(--motion-fast) motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      {open && (
        <form onSubmit={save} className="flex flex-col gap-2.5 px-2 pb-3 pt-1 motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]">
          {integration.fields.map((field) => (
            <label key={field.name} className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-[12px] text-ink-secondary">
                {field.label}
                {field.optional && <span className="text-[11px] text-ink-tertiary">optional</span>}
                {field.secret && field.set && <span className="text-[11px] text-success">configured</span>}
              </span>
              <input type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false} disabled={busy}
                value={draft[field.name] ?? (field.secret ? "" : field.value ?? "")}
                onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))}
                placeholder={field.secret && field.set ? "Paste to replace" : field.placeholder}
                className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-accent/60 focus:outline-none" />
            </label>
          ))}
          {integration.source === "shared" && integration.shared && (
            <p className="text-[12px] text-ink-tertiary">{shareLabel(integration.shared)}. This computer uses it{integration.shared.projectName ? ` in ${integration.shared.projectName}` : ""} until you add a key of your own.</p>
          )}
          {shares.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label={`Where ${integration.label} is shared`}>
              {shares.map((share) => (
                <li key={share.projectId ?? "workspace"} className="flex items-center gap-2 text-[12px] text-ink-secondary">
                  <span className="min-w-0 flex-1">{share.projectName ? `Shared by ${share.by} with ${share.projectName} only; other projects don't get it` : shareLabel(share)}</span>
                  {canStop(share) && (
                    <button type="button" disabled={busy} onClick={() => stop(share)} className="shrink-0 rounded-md px-1.5 py-0.5 text-danger hover:bg-raised-hover disabled:opacity-50">Stop sharing</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!dirty || busy}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />}Save
            </button>
            {anySet && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(`Disconnect ${integration.label}? Its keys are removed from this computer.`)) void send(api(`/api/integrations/${integration.id}`, { method: "DELETE" })); }}
                className="inline-flex min-h-8 items-center rounded-lg bg-control px-3 text-[13px] text-danger hover:bg-raised-hover disabled:opacity-50">
                Disconnect
              </button>
            )}
            {chosen && integration.source === "yours" && (
              <span className="flex min-w-0 items-center gap-1.5">
                {targets.length > 1 && (
                  <Select size="sm" aria-label={`Share ${integration.label} with`} disabled={busy} value={chosen.projectId ?? ""} onChange={(event) => setTarget(event.target.value)} className="max-w-[180px]">
                    {targets.map((candidate) => <option key={candidate.projectId ?? ""} value={candidate.projectId ?? ""}>{candidate.label}</option>)}
                  </Select>
                )}
                <button type="button" disabled={busy} onClick={() => void shareRequest("POST", chosen.projectId)}
                  className="inline-flex min-h-8 shrink-0 items-center rounded-lg bg-control px-3 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
                  {shares.some((share) => share.projectId === chosen.projectId) ? "Share again" : targets.length > 1 ? "Share" : chosen.projectId ? `Share with ${chosen.label.replace(/^Only /, "")}` : "Share with the workspace"}
                </button>
              </span>
            )}
            {integration.configured && <CheckButton id={integration.id} scope={checkScope} className="ml-auto" />}
            <a href={integration.help} target="_blank" rel="noreferrer"
              className={cn("inline-flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink", !integration.configured && "ml-auto")}>
              Get keys<ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
          <CheckResult id={integration.id} scope={checkScope} />
        </form>
      )}
    </div>
  );
}
