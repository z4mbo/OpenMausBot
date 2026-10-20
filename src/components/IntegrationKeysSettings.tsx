// Security: secrets are write-only; GET /api/integrations returns which fields are set, never a secret's value.
import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { useWorkspaceAccess } from "@/lib/origin-members";
import { sessionStore } from "@/lib/origin-cloud/client";
import { useActiveOriginWorkspace } from "@/lib/use-origin-workspace";
import { Card } from "./SettingsPrimitives";
import { WorkspaceGitHubCard } from "./origin-members/WorkspaceGitHubCard";
import type { IntegrationStatus } from "../../shared/integration-keys";


let focusRequest: string | null = null;

/** Opens this integration's row the next time the Integrations settings mount. */
export function requestIntegrationFocus(id: string): void {
  focusRequest = id;
}

export function IntegrationKeysSettings() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [error, setError] = useState("");
  const [sharedError, setSharedError] = useState("");
  const { teamId } = useActiveOriginWorkspace();
  const access = useWorkspaceAccess(teamId);
  const shareTo = teamId && (access?.role === "owner" || access?.role === "admin") ? teamId : null;
  const [open, setOpen] = useState<string | null>(() => {
    const id = focusRequest;
    focusRequest = null;
    return id;
  });
  useEffect(() => {
    let live = true;
    api<{ integrations: IntegrationStatus[]; sharedError?: string | null }>("/api/integrations")
      .then((body) => { if (live) { setIntegrations(body.integrations); setSharedError(body.sharedError ?? ""); } })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, []);
  const replace = (next: IntegrationStatus) => setIntegrations((current) => current?.map((entry) => (entry.id === next.id ? next : entry)) ?? null);
  return (
    <Card subtitle="Keys for the services Studio, Broadcast, Sales and Ship use. Yours stay on this computer and are never shown again after saving; an owner or admin can share theirs with the workspace, and a key of your own always wins over a shared one.">
      {teamId && <div className="-mx-1 mb-1 border-b border-hairline/30 pb-1"><WorkspaceGitHubCard teamId={teamId} /></div>}
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {sharedError && <p className="text-[12.5px] text-ink-tertiary">Shared keys are unavailable right now: {sharedError}</p>}
      {!integrations && !error && <div className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" />Loading</div>}
      {integrations && (
        <div className="-mx-1 flex flex-col">
          {integrations.map((integration) => (
            <IntegrationRow key={integration.id} integration={integration} open={open === integration.id} shareTo={shareTo}
              onToggle={() => setOpen((current) => (current === integration.id ? null : integration.id))} onSaved={replace} />
          ))}
        </div>
      )}
    </Card>
  );
}

const sessionHeaders = () => ({ "content-type": "application/json", "x-origin-session": sessionStore.get() ?? "" });

function sharedLabel(integration: IntegrationStatus): string {
  if (!integration.shared) return "";
  return `Shared by ${integration.shared.by}${integration.shared.projectName ? ` for ${integration.shared.projectName}` : ""}`;
}

function IntegrationRow({ integration, open, shareTo, onToggle, onSaved }: { integration: IntegrationStatus; open: boolean; shareTo: string | null; onToggle(): void; onSaved(next: IntegrationStatus): void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const anySet = integration.fields.some((field) => field.set);
  const dirty = Object.entries(draft).some(([name, value]) => {
    const field = integration.fields.find((candidate) => candidate.name === name);
    return field?.secret ? value.trim() !== "" : value.trim() !== (field?.value ?? "");
  });
  const send = async (request: Promise<{ integration: IntegrationStatus }>) => {
    setBusy(true);
    setError("");
    try {
      onSaved((await request).integration);
      setDraft({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
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
  return (
    <div data-integration={integration.id} className="rounded-lg">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13.5px] text-ink outline-none transition-colors hover:bg-raised/50 focus-visible:ring-1 focus-visible:ring-accent/60">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", integration.configured ? "bg-success" : anySet ? "bg-warning" : "bg-raised-hover")} />
        <span className="flex-1 font-medium">{integration.label}</span>
        <span className="text-[12px] text-ink-secondary">{integration.source === "yours" ? "Yours" : integration.source === "shared" ? sharedLabel(integration) : anySet ? "Incomplete" : ""}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn("text-ink-tertiary transition-transform duration-(--motion-fast) motion-reduce:transition-none", open && "rotate-90")} />
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
          {integration.source === "shared" && <p className="text-[12px] text-ink-tertiary">{sharedLabel(integration)}. Studio, Sales and your agents use it until you add a key of your own.</p>}
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
            {shareTo && integration.source === "yours" && (
              <button type="button" disabled={busy} onClick={() => void send(api(`/api/integrations/${integration.id}/share?teamId=${encodeURIComponent(shareTo)}`, { method: "POST", headers: sessionHeaders() }))}
                className="inline-flex min-h-8 items-center rounded-lg bg-control px-3 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50">
                {integration.shared && !integration.shared.projectName ? "Share again" : "Share with the workspace"}
              </button>
            )}
            {shareTo && integration.shared && !integration.shared.projectName && (
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(`Stop sharing ${integration.label}? Members without a key of their own lose it.`)) void send(api(`/api/integrations/${integration.id}/share?teamId=${encodeURIComponent(shareTo)}`, { method: "DELETE", headers: sessionHeaders() })); }}
                className="inline-flex min-h-8 items-center rounded-lg bg-control px-3 text-[13px] text-danger hover:bg-raised-hover disabled:opacity-50">
                Stop sharing
              </button>
            )}
            <a href={integration.help} target="_blank" rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink">
              Get keys<ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </form>
      )}
    </div>
  );
}
