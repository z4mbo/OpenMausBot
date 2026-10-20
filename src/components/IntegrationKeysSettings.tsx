// Security: secrets are write-only; GET /api/integrations returns which fields are set, never a secret's value.
import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { Card } from "./SettingsPrimitives";
import type { IntegrationStatus } from "../../shared/integration-keys";


let focusRequest: string | null = null;

/** Opens this integration's row the next time the Integrations settings mount. */
export function requestIntegrationFocus(id: string): void {
  focusRequest = id;
}

export function IntegrationKeysSettings() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(() => {
    const id = focusRequest;
    focusRequest = null;
    return id;
  });
  useEffect(() => {
    let live = true;
    api<{ integrations: IntegrationStatus[] }>("/api/integrations")
      .then((body) => { if (live) setIntegrations(body.integrations); })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, []);
  const replace = (next: IntegrationStatus) => setIntegrations((current) => current?.map((entry) => (entry.id === next.id ? next : entry)) ?? null);
  return (
    <Card subtitle="Your own keys for the services Studio, Broadcast and Pipeline use. They stay on this computer, are never synced to your team, and are never shown again after saving.">
      {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
      {!integrations && !error && <div className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" />Loading</div>}
      {integrations && (
        <div className="-mx-1 flex flex-col">
          {integrations.map((integration) => (
            <IntegrationRow key={integration.id} integration={integration} open={open === integration.id}
              onToggle={() => setOpen((current) => (current === integration.id ? null : integration.id))} onSaved={replace} />
          ))}
        </div>
      )}
    </Card>
  );
}

function IntegrationRow({ integration, open, onToggle, onSaved }: { integration: IntegrationStatus; open: boolean; onToggle(): void; onSaved(next: IntegrationStatus): void }) {
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
        <span className="text-[12px] text-ink-secondary">{integration.configured ? "Connected" : anySet ? "Incomplete" : ""}</span>
        <ChevronRight size={14} aria-hidden="true" className={cn("text-ink-tertiary transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      {open && (
        <form onSubmit={save} className="flex flex-col gap-2.5 px-2 pb-3 pt-1 motion-safe:animate-[rise_0.15s_ease-out_backwards]">
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
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={!dirty || busy}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />}Save
            </button>
            {anySet && (
              <button type="button" disabled={busy} onClick={() => void send(api(`/api/integrations/${integration.id}`, { method: "DELETE" }))}
                className="inline-flex min-h-8 items-center rounded-lg bg-control px-3 text-[13px] text-danger hover:bg-raised-hover disabled:opacity-50">
                Disconnect
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
