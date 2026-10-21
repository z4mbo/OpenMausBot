import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import type { BroadcastAccount } from "../../../shared/broadcast";
import type { IntegrationStatus } from "../../../shared/integration-keys";
import { ChannelMark } from "../origin-broadcast/ChannelMark";

const fieldClass = "w-full rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-accent/60 focus:outline-none max-md:text-[16px]";

/** The extra accounts Publish can post as on each connected social service, besides the key saved for that service. */
export function SocialAccounts({ integrations, canEdit }: { integrations: readonly IntegrationStatus[]; canEdit: boolean }) {
  const [accounts, setAccounts] = useState<BroadcastAccount[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ accounts: BroadcastAccount[] }>("/api/origin/broadcast/accounts").then((body) => setAccounts(body.accounts), () => setAccounts([])), []);
  useEffect(() => { void load(); }, [load]);
  const remove = async (account: BroadcastAccount) => {
    if (!window.confirm(`Remove ${account.label}? Its keys are deleted from this computer, and posts set to publish as it fail.`)) return;
    try {
      await api(`/api/origin/broadcast/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const social = integrations.filter((integration) => ["x", "bluesky", "linkedin", "meta", "tiktok"].includes(integration.id) && integration.configured);
  if (!social.length) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline/30 pt-2.5" aria-label="Accounts per service" role="group">
      <p className="text-[11.5px] font-medium text-ink-tertiary">Accounts Publish can post as</p>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {!accounts ? <Loader2 size={12} className="animate-spin text-ink-tertiary" /> : social.map((integration) => {
        const mine = accounts.filter((account) => account.integration === integration.id);
        return (
          <div key={integration.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {mine.map((account) => (
                <span key={account.id} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-inset pl-2 pr-1 text-[12px] text-ink">
                  {account.channels.map((channel) => <ChannelMark key={channel} channel={channel} size={11} />)}
                  {account.label}
                  {account.isDefault ? <span className="pr-1 text-[11px] text-ink-tertiary">default</span>
                    : canEdit && <button type="button" aria-label={`Remove ${account.label}`} onClick={() => void remove(account)} className="flex size-5 items-center justify-center rounded text-ink-tertiary hover:bg-raised hover:text-ink"><X size={11} /></button>}
                </span>
              ))}
              {canEdit && adding !== integration.id && (
                <button type="button" onClick={() => setAdding(integration.id)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-ink-tertiary transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink">
                  <Plus size={12} />Add {integration.label} account
                </button>
              )}
            </div>
            {adding === integration.id && <AddAccount integration={integration} onDone={() => { setAdding(null); void load(); }} onCancel={() => setAdding(null)} />}
          </div>
        );
      })}
    </div>
  );
}

function AddAccount({ integration, onDone, onCancel }: { integration: IntegrationStatus; onDone(): void; onCancel(): void }) {
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/origin/broadcast/accounts", { method: "POST", body: JSON.stringify({ integration: integration.id, label, fields }) });
      onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(event) => void submit(event)} aria-label={`Add ${integration.label} account`}
      className="grid gap-2 rounded-lg bg-inset/60 p-2.5 sm:grid-cols-2 motion-safe:animate-[rise_var(--motion-fast)_var(--ease-out)_backwards]">
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-[12px] text-ink-secondary">Name in Publish</span>
        <input required maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Founder, Support, Brand…" className={fieldClass} />
      </label>
      {integration.fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-secondary">{field.label}{field.optional && <span className="ml-1.5 text-[11px] text-ink-tertiary">optional</span>}</span>
          <input type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false} required={!field.optional} value={fields[field.name] ?? ""}
            onChange={(event) => setFields((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={field.placeholder} className={fieldClass} />
        </label>
      ))}
      {error && <p role="alert" className="text-[12px] text-danger sm:col-span-2">{error}</p>}
      <div className="flex items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={busy || !label.trim()} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50")}>
          {busy && <Loader2 size={13} className="animate-spin" />}Add account
        </button>
        <button type="button" onClick={onCancel} className="inline-flex min-h-8 items-center rounded-lg px-3 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">Cancel</button>
      </div>
    </form>
  );
}
