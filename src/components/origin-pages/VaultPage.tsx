import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Select } from "../Select";
import { copyText } from "@/lib/copy-text";
import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Pencil, Plus, Search, ShieldCheck, Shuffle, Trash2, Unlock } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import type { CloudCredential, CredentialKind } from "./cloud-types";
import { errorText } from "./repo-url";
import { CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, ReadOnlyEditorNotice, cardClass, ghostButton, iconButton, inputClass, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";
import { decryptSecret, encryptSecret, generatePassword } from "./vaultCrypto";

const KINDS: Record<CredentialKind, string> = { password: "Website login", api_key: "API key", secret: "Secret", note: "Secure note", apk: "APK", file: "File" };
const EDITABLE_KINDS: readonly CredentialKind[] = ["password", "api_key", "secret", "note"];
const AUTO_LOCK_MS = 5 * 60_000;
const MIN_NEW_PASSPHRASE = 10;

export function VaultPage(props: OriginPageProps) {
  return <CloudGate {...props} label="Vault">{({ projectId, canEdit }) => <Vault projectId={projectId} canEdit={canEdit} />}</CloudGate>;
}

function Vault({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const items = useCloudQuery<CloudCredential[]>("credentials:list", { projectId });
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CloudCredential | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);

  const lock = useCallback(() => {
    epoch.current++;
    setPassphrase("");
    setRevealed({});
    setUnlocked(false);
    setEditing(null);
  }, []);

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

  if (!items) return <Loading label="Loading vault" />;

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (items.length) await decryptSecret(items[0], passphrase);
      else if (passphrase.length < MIN_NEW_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_NEW_PASSPHRASE} characters`);
      setUnlocked(true);
    } catch (error) {
      setNotice(items.length ? "Could not unlock. Check your vault passphrase." : errorText(error, "Could not create vault"));
    } finally {
      setBusy(false);
    }
  };
  const reveal = async (item: CloudCredential, copy = false) => {
    if (!copy && revealed[item._id]) {
      setRevealed((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item._id)));
      return;
    }
    const started = epoch.current;
    try {
      const value = await decryptSecret(item, passphrase);
      if (started !== epoch.current) return;
      if (copy) setNotice((await copyText(value)) === "copied" ? `Copied ${item.title}` : "Could not copy");
      else setRevealed((current) => ({ ...current, [item._id]: value }));
    } catch {
      setNotice("Could not decrypt this item with this passphrase");
    }
  };
  const remove = (item: CloudCredential) => {
    if (!window.confirm(`Delete ${item.title}?`)) return;
    void cloudMutation("credentials:remove", { projectId, credentialId: item._id }).catch(() => setNotice("Could not delete item"));
  };

  const needle = query.trim().toLowerCase();
  const filtered = items.filter((item) => `${item.title} ${item.username ?? ""} ${item.url ?? ""}`.toLowerCase().includes(needle));

  return (
    <section className={pageClass} aria-label="Vault">
      <PageHeader title="Vault" count={`${items.length} encrypted ${items.length === 1 ? "item" : "items"}`}>
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
          <input className={cn(inputClass, "w-44 pl-7")} placeholder="Search vault" aria-label="Search vault" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {unlocked && <button type="button" className={ghostButton} onClick={lock}><LockKeyhole size={14} />Lock</button>}
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
          <p className="basis-full text-[12px] text-ink-tertiary">Secrets are encrypted in this app with your passphrase and never leave it in plain text. Nobody can recover a lost passphrase, not even a workspace admin.</p>
        </form>
      )}
      {notice && <div className="mb-3"><Notice>{notice}</Notice></div>}

      {!filtered.length ? <EmptyState icon={<KeyRound size={24} />} title={needle ? "No matching items" : "No saved secrets"} body="Keys, logins and secrets this project's agents may use." /> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30")}>
          {filtered.map((item) => (
            <article key={item._id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-inset text-ink-secondary"><KeyRound size={15} /></span>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium text-ink">{item.title}</strong>
                <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-tertiary">
                  <span>{KINDS[item.kind ?? "password"]}</span>
                  {item.username && <span className="text-ink-secondary">{item.username}</span>}
                  {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 truncate text-accent-text hover:underline">{item.url}<ExternalLink size={10} /></a>}
                </div>
                {revealed[item._id] !== undefined && <code className="mt-1.5 block whitespace-pre-wrap break-all rounded-md bg-inset px-2 py-1 font-mono text-[12px] text-ink">{revealed[item._id]}</code>}
              </div>
              {unlocked && (
                <div className="flex shrink-0 items-center">
                  <button type="button" className={iconButton} title={revealed[item._id] !== undefined ? "Hide secret" : "Reveal secret"} aria-label={`${revealed[item._id] !== undefined ? "Hide" : "Reveal"} ${item.title}`} onClick={() => void reveal(item)}>
                    {revealed[item._id] !== undefined ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button type="button" className={iconButton} title="Copy secret" aria-label={`Copy ${item.title}`} onClick={() => void reveal(item, true)}><Copy size={14} /></button>
                  {canEdit && <button type="button" className={iconButton} title="Edit" aria-label={`Edit ${item.title}`} onClick={() => setEditing(item)}><Pencil size={14} /></button>}
                  {canEdit && <button type="button" className={iconButton} title="Delete" aria-label={`Delete ${item.title}`} onClick={() => remove(item)}><Trash2 size={14} /></button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && unlocked && <VaultItemEditor projectId={projectId} canEdit={canEdit} passphrase={passphrase} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function VaultItemEditor({ projectId, canEdit, passphrase, item, onClose }: { projectId: string; canEdit: boolean; passphrase: string; item: CloudCredential | null; onClose(): void }) {
  const [kind, setKind] = useState<CredentialKind>(item?.kind ?? "password");
  const [title, setTitle] = useState(item?.title ?? "");
  const [username, setUsername] = useState(item?.username ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [secret, setSecret] = useState("");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || action.busy) return;
    const ok = await action.run(async () => {
      const encrypted = secret ? await encryptSecret(secret, passphrase) : null;
      if (item) {
        await cloudMutation("credentials:update", { projectId, credentialId: item._id, kind, title, username, url, ...encrypted });
      } else {
        if (!encrypted) throw new Error("Enter the secret to store");
        await cloudMutation("credentials:create", { projectId, kind, title, ...(username ? { username } : {}), ...(url ? { url } : {}), ...encrypted });
      }
    }, "Could not save");
    if (ok) { setSecret(""); onClose(); }
  };
  const kinds = item?.kind && !EDITABLE_KINDS.includes(item.kind) ? [...EDITABLE_KINDS, item.kind] : EDITABLE_KINDS;
  return (
    <Modal title={item ? "Edit vault item" : "New vault item"} onClose={() => { setSecret(""); onClose(); }}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <ReadOnlyEditorNotice canEdit={canEdit} />
        <fieldset disabled={!canEdit} className="contents">
        <Field label="Type">
          <Select className="w-full" value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)}>
            {kinds.map((value) => <option key={value} value={value}>{KINDS[value]}</option>)}
          </Select>
        </Field>
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
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <button className={primaryButton} disabled={action.busy || !canEdit}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}Save encrypted item
        </button>
      </form>
    </Modal>
  );
}
