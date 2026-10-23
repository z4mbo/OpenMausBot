import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Select } from "../Select";
import { copyText } from "@/lib/copy-text";
import { Bot, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Shuffle, Trash2, Unlock, UserRound, Users } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { revealItem, useItemFocus } from "@/lib/origin-item-focus";
import { cn } from "@/lib/cn";
import { CUSTOM_SERVICE, parseServiceEnv, serviceEnvProblem, usableEnvName, VAULT_SERVICES, vaultService, type ServiceEnv } from "../../../shared/vault-services";
import type { CloudCredential, CredentialKind } from "./cloud-types";
import { errorText } from "./repo-url";
import { CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, ReadOnlyEditorNotice, Segmented, cardClass, ghostButton, iconButton, inputClass, itemIn, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";
import { decryptSecret, encryptSecret, generatePassword } from "./vaultCrypto";
import { forgetForAgents, handOver, setAgentUse, shareUnlockedWithAgents } from "./vault-agent";
import { vaultFunctions, type VaultScope } from "./vault-scope";

const KINDS: Record<CredentialKind, string> = { password: "Website login", api_key: "API key", secret: "Secret", note: "Secure note", apk: "APK", file: "File", service: "Service sign-in" };
const EDITABLE_KINDS: readonly CredentialKind[] = ["password", "api_key", "secret", "note", "service"];
const AUTO_LOCK_MS = 5 * 60_000;
const MIN_NEW_PASSPHRASE = 10;

const COPY = {
  project: {
    empty: "Keys, logins and service sign-ins this project's agents may use.",
    unlock: "Secrets are encrypted in this app with the project's vault passphrase and never leave it in plain text. Nobody can recover a lost passphrase, not even a workspace admin.",
    agentsOn: "Agents may use this while the vault is unlocked here; click to stop",
    agentsOff: "Let this project's agents use this while the vault is unlocked here",
  },
  personal: {
    empty: "Your own keys and service sign-ins. Only you see them, and your agents use the ones you allow in every project while your vault is unlocked here.",
    unlock: "Your personal vault has its own passphrase. Nobody else can open it, and nobody can recover a lost passphrase, not even a workspace admin.",
    agentsOn: "Your agents may use this in every project while your vault is unlocked here; click to stop",
    agentsOff: "Let your agents use this in every project while your vault is unlocked here",
  },
} as const;

type Tab = "project" | "personal";

export function VaultPage(props: OriginPageProps) {
  return <CloudGate {...props} label="Vault">{({ projectId, canEdit }) => <Vaults projectId={projectId} canEdit={canEdit} />}</CloudGate>;
}

function Vaults({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("project");
  const switcher = (
    <Segmented label="Vault" value={tab} onChange={setTab} options={[
      { value: "project", label: <><Users size={13} aria-hidden="true" />Project</>, title: "Shared with this project's members" },
      { value: "personal", label: <><UserRound size={13} aria-hidden="true" />Personal</>, title: "Only yours, for your agents in every project" },
    ]} />
  );
  return tab === "project"
    ? <Vault key="project" scope={{ projectId }} projectId={projectId} canEdit={canEdit} switcher={switcher} />
    : <Vault key="personal" scope="personal" projectId={projectId} canEdit switcher={switcher} />;
}

function Vault({ scope, projectId, canEdit, switcher }: { scope: VaultScope; projectId: string; canEdit: boolean; switcher: ReactNode }) {
  const functions = vaultFunctions(scope);
  const copy = COPY[scope === "personal" ? "personal" : "project"];
  const items = useCloudQuery<CloudCredential[]>(functions.list, functions.args);
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, { ciphertext: string; value: string }>>({});
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CloudCredential | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const sharing = useRef<Promise<unknown>>(Promise.resolve());

  const lock = useCallback(() => {
    epoch.current++;
    setPassphrase("");
    setRevealed({});
    setUnlocked(false);
    setEditing(null);
  }, []);
  const lockAndRevoke = () => {
    lock();
    void sharing.current.finally(() => forgetForAgents(scope));
  };

  useEffect(() => {
    if (!unlocked) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, AUTO_LOCK_MS); };
    const hide = () => { if (document.hidden) lock(); };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [unlocked, lock]);
  useItemFocus(projectId, {
    vault: (itemId) => {
      setQuery("");
      return !items?.some((item) => item._id === itemId) || revealItem(itemId);
    },
  }, Boolean(items) && scope !== "personal");

  if (!items) return <Loading label="Loading vault" />;

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (items.length) await decryptSecret(items[0], passphrase);
      else if (passphrase.length < MIN_NEW_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_NEW_PASSPHRASE} characters`);
      setUnlocked(true);
      sharing.current = shareUnlockedWithAgents(scope, items, passphrase);
    } catch (error) {
      setNotice(items.length ? "Could not unlock. Check your vault passphrase." : errorText(error, "Could not create vault"));
    } finally {
      setBusy(false);
    }
  };
  const shown = (item: CloudCredential) => (revealed[item._id]?.ciphertext === item.ciphertext ? revealed[item._id]!.value : undefined);
  const reveal = async (item: CloudCredential, copy = false) => {
    if (!copy && shown(item) !== undefined) {
      setRevealed((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item._id)));
      return;
    }
    const started = epoch.current;
    try {
      const value = await decryptSecret(item, passphrase);
      if (started !== epoch.current) return;
      if (copy) setNotice((await copyText(value)) === "copied" ? `Copied ${item.title}` : "Could not copy");
      else setRevealed((current) => ({ ...current, [item._id]: { ciphertext: item.ciphertext, value: item.kind === "service" ? envText(item, value) : value } }));
    } catch {
      setNotice("Could not decrypt this item with this passphrase");
    }
  };
  const remove = (item: CloudCredential) => {
    if (!window.confirm(`Delete ${item.title}?`)) return;
    void cloudMutation(functions.remove, { ...functions.args, credentialId: item._id }).then(() => (item.agentUse ? forgetForAgents(scope, item._id) : undefined)).catch(() => setNotice("Could not delete item"));
  };

  const needle = query.trim().toLowerCase();
  const filtered = items.filter((item) => `${item.title} ${item.username ?? ""} ${item.url ?? ""} ${vaultService(item.service)?.label ?? ""}`.toLowerCase().includes(needle));

  return (
    <section className={pageClass} aria-label="Vault">
      <PageHeader title="Vault" count={`${items.length} encrypted ${items.length === 1 ? "item" : "items"}`}>
        {switcher}
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
          <input className={cn(inputClass, "w-44 pl-7")} placeholder="Search vault" aria-label="Search vault" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {unlocked && <button type="button" className={ghostButton} onClick={lockAndRevoke} title="Locks the vault and takes its items back from this computer's agents"><LockKeyhole size={14} />Lock</button>}
        {unlocked && canEdit && <button type="button" className={primaryButton} onClick={() => setEditing("new")}><Plus size={14} />New item</button>}
      </PageHeader>

      {!unlocked && (
        <form onSubmit={unlock} className={cn(cardClass, "mb-4 flex flex-wrap items-end gap-3 p-4")}>
          <ShieldCheck size={22} className="mb-1.5 text-ink-secondary" aria-hidden="true" />
          <Field label={items.length ? "Vault passphrase" : "Choose a vault passphrase"} className="min-w-[220px] flex-1">
            <input className={inputClass} type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required minLength={items.length ? 1 : MIN_NEW_PASSPHRASE} />
          </Field>
          <button className={primaryButton} disabled={busy || (!items.length && !canEdit)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}{items.length ? "Unlock vault" : "Create vault"}
          </button>
          <p className="basis-full text-[12px] text-ink-tertiary">{copy.unlock}</p>
        </form>
      )}
      {notice && <div className="mb-3"><Notice>{notice}</Notice></div>}

      {!filtered.length ? <EmptyState icon={<KeyRound size={24} />} title={needle ? "No matching items" : "No saved secrets"} body={copy.empty} /> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30")}>
          {filtered.map((item) => (
            <article key={item._id} data-origin-item={item._id} className={`flex items-start gap-3 px-4 py-3 ${itemIn}`}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset text-ink-secondary"><KeyRound size={15} /></span>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium text-ink">{item.title}</strong>
                <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-tertiary">
                  <span>{item.kind === "service" ? `${vaultService(item.service)?.label ?? "Service"} sign-in` : KINDS[item.kind ?? "password"]}</span>
                  {item.username && <span className="text-ink-secondary">{item.username}</span>}
                  {item.agentUse && <span className="inline-flex items-center gap-1 text-ink-secondary"><Bot size={11} aria-hidden="true" />Agents may use</span>}
                  {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 truncate text-accent-text hover:underline">{item.url}<ExternalLink size={10} /></a>}
                </div>
                {shown(item) !== undefined && <code className="mt-1.5 block whitespace-pre-wrap break-all rounded-md bg-inset px-2 py-1 font-mono text-[12px] text-ink">{shown(item)}</code>}
              </div>
              {unlocked && (
                <div className="flex shrink-0 items-center">
                  <button type="button" className={iconButton} title={shown(item) !== undefined ? "Hide secret" : "Reveal secret"} aria-label={`${shown(item) !== undefined ? "Hide" : "Reveal"} ${item.title}`} onClick={() => void reveal(item)}>
                    {shown(item) !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button type="button" className={iconButton} title="Copy secret" aria-label={`Copy ${item.title}`} onClick={() => void reveal(item, true)}><Copy size={14} /></button>
                  {canEdit && <button type="button" className={cn(iconButton, item.agentUse && "text-accent-text")} aria-pressed={Boolean(item.agentUse)} title={item.agentUse ? copy.agentsOn : copy.agentsOff} aria-label={`Agents may use ${item.title}`}
                    onClick={() => void setAgentUse(scope, item, !item.agentUse, passphrase).catch(() => setNotice("Could not change agent access"))}><Bot size={14} /></button>}
                  {canEdit && <button type="button" className={iconButton} title="Edit" aria-label={`Edit ${item.title}`} onClick={() => setEditing(item)}><Pencil size={14} /></button>}
                  {canEdit && <button type="button" className={iconButton} title="Delete" aria-label={`Delete ${item.title}`} onClick={() => remove(item)}><Trash2 size={14} /></button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && unlocked && <VaultItemEditor scope={scope} canEdit={canEdit} passphrase={passphrase} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function envText(item: CloudCredential, value: string): string {
  const env = parseServiceEnv(item.service ?? "", value);
  return env ? Object.entries(env).map(([name, text]) => `${name}=${text}`).join("\n") : value;
}

function customRows(text: string): ServiceEnv {
  const env: ServiceEnv = {};
  for (const line of text.split(/\r?\n/u)) {
    const at = line.indexOf("=");
    if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return env;
}

function VaultItemEditor({ scope, canEdit, passphrase, item, onClose }: { scope: VaultScope; canEdit: boolean; passphrase: string; item: CloudCredential | null; onClose(): void }) {
  const functions = vaultFunctions(scope);
  const [kind, setKind] = useState<CredentialKind>(item?.kind ?? "password");
  const [serviceId, setServiceId] = useState(item?.service ?? "vercel");
  const [env, setEnv] = useState<ServiceEnv>({});
  const [custom, setCustom] = useState("");
  const [title, setTitle] = useState(item?.title ?? "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [secret, setSecret] = useState("");
  const action = useAction();
  const service = vaultService(serviceId) ?? VAULT_SERVICES[0]!;

  useEffect(() => {
    if (item?.kind !== "service") return;
    let current = true;
    void decryptSecret(item, passphrase).then((text) => {
      const stored = current ? parseServiceEnv(item.service ?? "", text) : null;
      if (!stored) return;
      if (item.service === CUSTOM_SERVICE) setCustom(Object.entries(stored).map(([name, value]) => `${name}=${value}`).join("\n"));
      else setEnv(stored);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [item, passphrase]);

  const serviceValues = (): ServiceEnv => {
    if (service.id === CUSTOM_SERVICE) return customRows(custom);
    return Object.fromEntries(service.fields.map((field) => [field.env, env[field.env]?.trim() ?? ""]).filter(([, value]) => value));
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || action.busy) return;
    const ok = await action.run(async () => {
      let plain = secret;
      let extra: Record<string, string> = {};
      if (kind === "service") {
        const values = serviceValues();
        const problem = serviceEnvProblem(service.id, values);
        if (problem) throw new Error(problem);
        plain = JSON.stringify(values);
        extra = { service: service.id };
      }
      const encrypted = plain ? await encryptSecret(plain, passphrase) : null;
      const name = title.trim() || (kind === "service" ? service.label : "");
      const fields = { kind, title: name, ...extra, ...(username ? { username } : {}), ...(url ? { url } : {}) };
      if (item) {
        await cloudMutation(functions.update, { ...functions.args, credentialId: item._id, ...fields, username, url, ...encrypted });
        if (encrypted && item.agentUse) await handOver(scope, { ...item, ...fields, ...encrypted }, passphrase);
      } else {
        if (!encrypted) throw new Error("Enter the secret to store");
        await cloudMutation(functions.create, { ...functions.args, ...fields, ...encrypted });
      }
    }, "Could not save");
    if (ok) { setSecret(""); setEnv({}); setCustom(""); onClose(); }
  };
  const kinds = item?.kind && !EDITABLE_KINDS.includes(item.kind) ? [...EDITABLE_KINDS, item.kind] : EDITABLE_KINDS;
  const customProblem = service.id === CUSTOM_SERVICE && custom.trim() ? Object.keys(customRows(custom)).find((name) => !usableEnvName(name)) : undefined;
  return (
    <Modal title={item ? "Edit vault item" : "New vault item"} onClose={() => { setSecret(""); setEnv({}); setCustom(""); onClose(); }}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <ReadOnlyEditorNotice canEdit={canEdit} />
        <fieldset disabled={!canEdit} className="contents">
        <Field label="Type">
          <Select className="w-full" value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)}>
            {kinds.map((value) => <option key={value} value={value}>{KINDS[value]}</option>)}
          </Select>
        </Field>
        {kind === "service" ? (
          <>
            <Field label="Service">
              <Select className="w-full" value={service.id} onChange={(e) => { setServiceId(e.target.value); setEnv({}); }}>
                {VAULT_SERVICES.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}
              </Select>
            </Field>
            <Field label="Name"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={service.label} maxLength={150} /></Field>
            {service.id === CUSTOM_SERVICE ? (
              <Field label="Environment variables, one NAME=value per line">
                <textarea className={cn(inputClass, "font-mono")} rows={4} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="RAILWAY_TOKEN=..." autoComplete="off" spellCheck={false} />
                {customProblem && <span className="text-[12px] text-danger">{customProblem} can't be set from the Vault</span>}
              </Field>
            ) : service.fields.map((field) => (
              <Field key={field.env} label={`${field.label}${field.optional ? " (optional)" : ""} · ${field.env}`}>
                {field.multiline
                  ? <textarea className={cn(inputClass, "font-mono")} rows={4} value={env[field.env] ?? ""} onChange={(e) => setEnv((current) => ({ ...current, [field.env]: e.target.value }))} autoComplete="off" spellCheck={false} />
                  : <input className={inputClass} type={field.secret ? "password" : "text"} value={env[field.env] ?? ""} onChange={(e) => setEnv((current) => ({ ...current, [field.env]: e.target.value }))} autoComplete={field.secret ? "new-password" : "off"} spellCheck={false} />}
              </Field>
            ))}
            {service.tokenUrl && <a href={service.tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent-text hover:underline">Create a token on {service.label}<ExternalLink size={11} /></a>}
            <p className="text-[12px] text-ink-tertiary">Agents get these as environment variables while this vault is unlocked on your computer, so {service.id === CUSTOM_SERVICE ? "the service's command line" : `the ${service.label} command line`} runs signed in. The values never appear in chat or logs.</p>
          </>
        ) : (
          <>
            <Field label="Name"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={150} /></Field>
            <Field label="Account"><input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
            <Field label="Website"><input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
            <Field label={`${kind === "note" ? "Secure note" : "Secret"}${item ? " (leave empty to keep the current one)" : ""}`}>
              <span className="flex gap-1.5">
                {kind === "note"
                  ? <textarea className={inputClass} rows={4} value={secret} onChange={(e) => setSecret(e.target.value)} required={!item} autoComplete="off" />
                  : <input className={inputClass} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} required={!item} autoComplete="new-password" />}
                {kind !== "note" && <button type="button" className={cn(iconButton, "size-8")} title="Generate password" aria-label="Generate password" onClick={() => setSecret(generatePassword())}><Shuffle size={14} /></button>}
              </span>
            </Field>
          </>
        )}
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <button className={primaryButton} disabled={action.busy || !canEdit}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}Save encrypted item
        </button>
      </form>
    </Modal>
  );
}
