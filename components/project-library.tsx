"use client";
import { formatBytes } from "@/lib/format-bytes";
import { errorText } from "@/lib/error-text";
import { formatDate } from "@/lib/format";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import clsx from "clsx";
import { Check, Copy, Eye, EyeOff, File, FileText, ImageIcon, KeyRound, KeySquare, LayoutGrid, Link2, List, Loader2, LockKeyhole, PenTool, Plus, Search, Shapes, Shuffle, Smartphone, SquareAsterisk, StickyNote, Type, Upload, X, type LucideIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { decryptSecret, encryptSecret } from "@/lib/vaultCrypto";
import { Dialog } from "./dialog";
import { useWorkspace } from "./workspace-context";
import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";
import { useFileDrop } from "./use-file-drop";
import { validateAttachmentFiles } from "@/lib/dropped-content";
import { assetFileType, saveAssetFiles } from "@/lib/asset-uploads";
import { DelayedSkeleton } from "./delayed-skeleton";
import { ConfirmButton } from "./confirm-button";

type Props = { projectId: Id<"projects">; sessionToken: string };

/** Search field used by the Assets and Vault toolbars. */
function LibrarySearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="library-search"><Search size={14} aria-hidden="true" /><input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && value) { event.stopPropagation(); onChange(""); } }} /></label>;
}

/** Shared empty state: icon, short title, at most one action. */
export function ProjectEmpty({ icon: Icon, title, spin, children }: { icon: LucideIcon; title: string; spin?: boolean; children?: ReactNode }) {
  return <div className="project-empty"><span className="project-empty-icon" aria-hidden="true"><Icon size={20} className={spin ? "spin" : undefined} /></span><h2>{title}</h2>{children}</div>;
}

/* ---------------------------------------------------------------- vault */

const kinds = { password: "Login", api_key: "API key", secret: "Secret", note: "Secure note" };
const kindIcons: Record<string, LucideIcon> = { password: KeyRound, api_key: KeySquare, secret: SquareAsterisk, note: StickyNote };
type Kind = keyof typeof kinds;

function hostOf(url?: string) {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function VaultPanel({ projectId, sessionToken }: Props) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const items = useQuery(api.credentials.list, { projectId, sessionToken });
  const remove = useMutation(api.credentials.remove);
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const copyTimer = useRef<number | undefined>(undefined);
  const canEdit = workspace.role !== "viewer";
  const lock = () => { epoch.current++; setPassphrase(""); setRevealed({}); setUnlocked(false); setOpen(false); setNotice(""); };
  useEffect(() => {
    if (!unlocked) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, 5 * 60000); };
    const hide = () => { if (document.hidden) lock(); };
    reset(); window.addEventListener("pointerdown", reset); window.addEventListener("keydown", reset); document.addEventListener("visibilitychange", hide);
    return () => { clearTimeout(timer); epoch.current++; window.removeEventListener("pointerdown", reset); window.removeEventListener("keydown", reset); document.removeEventListener("visibilitychange", hide); };
  }, [unlocked]);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const unlock = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setNotice("");
    try {
      if (items?.length) await decryptSecret(items[0], passphrase);
      else if (passphrase.length < 10) { setNotice("Use at least 10 characters"); return; }
      setUnlocked(true);
    } catch { setNotice("Wrong passphrase"); }
    finally { setBusy(false); }
  };
  const reveal = async (item: Doc<"credentials">, copy = false) => {
    const started = epoch.current;
    setNotice("");
    try {
      if (!copy && revealed[item._id]) { setRevealed(current => { const next = { ...current }; delete next[item._id]; return next; }); return; }
      const value = revealed[item._id] ?? await decryptSecret(item, passphrase);
      if (started !== epoch.current) return;
      if (copy) {
        await navigator.clipboard.writeText(value);
        setCopied(item._id);
        window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(null), 1600);
      } else setRevealed(current => ({ ...current, [item._id]: value }));
    } catch (error) { setNotice(copy && error instanceof DOMException && error.name === "NotAllowedError" ? "Copy was blocked by the browser" : "Could not decrypt this item"); }
  };

  if (items === undefined) return <DelayedSkeleton label="Loading vault" />;
  if (!unlocked) return <section className="vault-locked" aria-label="Vault">
    <span className="project-empty-icon"><LockKeyhole size={20} /></span>
    <h2>{items.length ? "Vault locked" : "Create a vault"}</h2>
    {items.length > 0 && <span className="vault-locked-count">{items.length} {items.length === 1 ? "item" : "items"}</span>}
    <form className="vault-unlock" onSubmit={unlock}>
      <input type="password" aria-label="Passphrase" placeholder="Passphrase" autoComplete="off" value={passphrase} onChange={e => { setPassphrase(e.target.value); setNotice(""); }} required minLength={items.length ? 1 : 10} aria-invalid={Boolean(notice) || undefined} aria-describedby={notice ? "vault-unlock-error" : undefined} />
      <button className="primary-button" title={!online && !items.length ? RECONNECT_TO_CREATE : undefined} disabled={busy || !passphrase || (!online && !items.length)}>{busy && <Loader2 className="spin" size={15} />}{items.length ? "Unlock" : "Create"}</button>
    </form>
    {notice && <p id="vault-unlock-error" role="alert" className="field-error">{notice}</p>}
  </section>;

  const filtered = items.filter(item => `${item.title} ${item.username || ""} ${item.url || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="project-library" aria-label="Vault">
    <div className="library-toolbar">
      {items.length > 0 ? <LibrarySearch label="Search vault" value={query} onChange={setQuery} /> : <span className="library-toolbar-spacer" />}
      <button className="ghost-button compact" onClick={lock} aria-label="Lock vault"><LockKeyhole size={14} /><span className="library-button-label">Lock</span></button>
      {canEdit && <button className="primary-button compact" disabled={!online} title={!online ? RECONNECT_TO_CREATE : undefined} aria-label="New item" onClick={() => setOpen(true)}><Plus size={14} /><span className="library-button-label">New</span></button>}
    </div>
    {notice && <p className="notice danger" role="alert">{notice}<button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></p>}
    {!items.length ? <ProjectEmpty icon={KeyRound} title="No secrets">{canEdit && <button className="primary-button compact" disabled={!online} onClick={() => setOpen(true)}><Plus size={14} />New item</button>}</ProjectEmpty>
      : !filtered.length ? <ProjectEmpty icon={Search} title="No matching items" />
        : <ul className="vault-list">{filtered.map(item => {
          const Icon = kindIcons[item.kind || ""] || KeyRound;
          const secret = revealed[item._id];
          const host = hostOf(item.url);
          return <li className={clsx("vault-row", secret !== undefined && "revealed")} key={item._id}>
            <span className="library-file-icon"><Icon size={15} /></span>
            <div className="vault-row-main">
              <strong>{item.title}</strong>
              <span className="vault-row-meta"><span>{kinds[item.kind as Kind] || "Secret"}</span>{item.username && <span>{item.username}</span>}{host && <a href={item.url} target="_blank" rel="noreferrer noopener">{host}</a>}</span>
              {secret !== undefined && <code className="secret-code">{secret}</code>}
            </div>
            <div className="library-row-actions">
              <button className="icon-button" aria-label={secret !== undefined ? `Hide ${item.title}` : `Reveal ${item.title}`} title={secret !== undefined ? "Hide" : "Reveal"} aria-pressed={secret !== undefined} onClick={() => reveal(item)}>{secret !== undefined ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              <button className={clsx("icon-button", copied === item._id && "copied")} aria-label={copied === item._id ? "Copied" : `Copy ${item.title}`} title="Copy" onClick={() => reveal(item, true)}>{copied === item._id ? <Check size={15} /> : <Copy size={15} />}</button>
              {canEdit && <ConfirmButton className="icon-button" label={`Delete ${item.title}`} onConfirm={async () => { try { await remove({ projectId, sessionToken, credentialId: item._id }); } catch (error) { setNotice(errorText(error, "Could not delete item")); } }} />}
            </div>
          </li>;
        })}</ul>}
    {open && <VaultItemDialog projectId={projectId} sessionToken={sessionToken} passphrase={passphrase} online={online} onClose={() => setOpen(false)} />}
  </section>;
}

function VaultItemDialog({ projectId, sessionToken, passphrase, online, onClose }: Props & { passphrase: string; online: boolean; onClose: () => void }) {
  const create = useMutation(api.credentials.create);
  const [kind, setKind] = useState<Kind>("password");
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generate = () => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_"; setSecret(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n => alphabet[n % alphabet.length]).join("")); setShow(true); };
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!online) return; setBusy(true); setError("");
    try {
      await create({ projectId, sessionToken, kind, title, username: kind === "password" && username ? username : undefined, url: kind === "password" && url ? url : undefined, ...await encryptSecret(secret, passphrase) });
      onClose();
    } catch (error) { setError(errorText(error, "Could not save")); }
    finally { setBusy(false); }
  };
  return <Dialog title="New vault item" onClose={onClose}><form className="stack-form library-form" onSubmit={save}>
    <div className="segmented-control library-kind" role="radiogroup" aria-label="Type">{(Object.keys(kinds) as Kind[]).map(value => <button key={value} type="button" role="radio" aria-checked={kind === value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{kinds[value]}</button>)}</div>
    <label>Name<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={150} /></label>
    {kind === "password" && <div className="library-form-pair">
      <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label>
      <label>Website<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></label>
    </div>}
    {kind === "note"
      ? <label>Note<textarea value={secret} onChange={e => setSecret(e.target.value)} required rows={5} spellCheck={false} /></label>
      : <label>{kind === "password" ? "Password" : kind === "api_key" ? "Key" : "Secret"}<span className="secret-input">
        <input type={show ? "text" : "password"} value={secret} onChange={e => setSecret(e.target.value)} required autoComplete="new-password" spellCheck={false} />
        <button type="button" className="icon-button" aria-label={show ? "Hide" : "Show"} aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
        {kind === "password" && <button type="button" className="icon-button" aria-label="Generate password" title="Generate password" onClick={generate}><Shuffle size={15} /></button>}
      </span></label>}
    {error && <p className="notice danger" role="alert">{error}</p>}
    <div className="library-form-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button className="primary-button" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={busy || !online}>{busy && <Loader2 className="spin" size={15} />}Save</button></div>
  </form></Dialog>;
}

/* --------------------------------------------------------------- assets */

type AssetType = Doc<"designAssets">["type"];
type Asset = Doc<"designAssets"> & { fileUrl: string | null | undefined };
const assetTypes: Array<{ value: AssetType; label: string; plural: string; icon: LucideIcon }> = [
  { value: "image", label: "Image", plural: "Images", icon: ImageIcon },
  { value: "document", label: "Document", plural: "Documents", icon: FileText },
  { value: "figma", label: "Figma", plural: "Figma", icon: PenTool },
  { value: "icon", label: "Icon", plural: "Icons", icon: Shapes },
  { value: "font", label: "Font", plural: "Fonts", icon: Type },
  { value: "apk", label: "APK", plural: "APKs", icon: Smartphone },
  { value: "other", label: "Other", plural: "Other", icon: File },
];
const typeInfo = (type: string) => assetTypes.find(item => item.value === type) || assetTypes[assetTypes.length - 1];
const VIEW_KEY = "origin.assets.view";

function isPreviewable(asset: Asset) {
  if (!asset.fileUrl) return false;
  if (asset.contentType) return asset.contentType.startsWith("image/");
  return asset.type === "image" || asset.type === "icon";
}
function assetMeta(asset: Asset) {
  if (!asset.storageId) return hostOf(asset.url) || typeInfo(asset.type).label;
  const extension = asset.name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toUpperCase() || asset.contentType?.split("/")[1]?.split(/[+.;]/)[0]?.toUpperCase() || typeInfo(asset.type).label;
  return asset.size ? `${extension} · ${formatBytes(asset.size)}` : extension;
}

function AssetThumb({ asset, size }: { asset: Asset; size: "card" | "row" }) {
  const [failed, setFailed] = useState(false);
  const Icon = asset.storageId ? typeInfo(asset.type).icon : asset.type === "figma" ? PenTool : Link2;
  if (isPreviewable(asset) && !failed) return <img className={clsx("asset-image", asset.type === "icon" && "contain")} src={asset.fileUrl!} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
  return <span className="asset-type-icon"><Icon size={size === "card" ? 26 : 15} strokeWidth={size === "card" ? 1.5 : 2} /></span>;
}

export function AssetsPanel({ projectId, sessionToken }: Props) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const design = useQuery(api.design.list, { projectId, sessionToken });
  const remove = useMutation(api.design.removeAsset);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | AssetType>("all");
  const [view, setView] = useState<"grid" | "list">(() => { try { return typeof window !== "undefined" && window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; } });
  const [dialog, setDialog] = useState<{ files: File[]; url: string } | null>(null);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const canEdit = workspace.role !== "viewer";
  const chooseView = (next: "grid" | "list") => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* Per-browser preference only. */ } };
  const selectFiles = (selection: File[]) => {
    if (!selection.length) return;
    try { validateAttachmentFiles(selection); setNotice(""); setDialog({ files: selection, url: "" }); }
    catch (error) { setNotice(errorText(error, "Invalid file")); }
  };
  const drop = useFileDrop({ disabled: !online || !canEdit || Boolean(dialog), onFiles: selectFiles, onLink: url => setDialog({ files: [], url }) });
  const assets = design?.assets as Asset[] | undefined;
  const presentTypes = assetTypes.filter(type => assets?.some(asset => asset.type === type.value));
  const activeFilter = filter !== "all" && presentTypes.some(type => type.value === filter) ? filter : "all";
  const needle = query.trim().toLowerCase();
  const filtered = assets?.filter(asset => (activeFilter === "all" || asset.type === activeFilter) && `${asset.name} ${asset.notes || ""}`.toLowerCase().includes(needle));
  const deleteAsset = async (asset: Asset) => { try { await remove({ projectId, sessionToken, assetId: asset._id }); } catch (error) { setNotice(errorText(error, "Could not delete asset")); } };
  const addButton = (label: string) => canEdit && <button className="primary-button compact" disabled={!online} title={!online ? RECONNECT_TO_CREATE : undefined} aria-label="Add asset" onClick={() => setDialog({ files: [], url: "" })}><Upload size={14} /><span className="library-button-label">{label}</span></button>;

  return <section aria-label="Assets" className={clsx("project-library project-assets", drop.dragging && "drop-active")} {...drop.handlers}>
    {assets?.length ? <div className="library-toolbar">
      <LibrarySearch label="Search assets" value={query} onChange={setQuery} />
      {presentTypes.length > 1 && <select className="library-filter" aria-label="Type" value={activeFilter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="all">All types</option>{presentTypes.map(type => <option key={type.value} value={type.value}>{type.plural}</option>)}</select>}
      <div className="segmented-control library-view" role="group" aria-label="View">
        <button type="button" aria-label="Grid" aria-pressed={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => chooseView("grid")}><LayoutGrid size={14} /></button>
        <button type="button" aria-label="List" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => chooseView("list")}><List size={14} /></button>
      </div>
      {addButton("Upload")}
    </div> : null}
    {notice && <p className="notice danger" role="alert">{notice}<button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={14} /></button></p>}
    {assets === undefined ? <DelayedSkeleton label="Loading assets" />
      : !assets.length ? <ProjectEmpty icon={ImageIcon} title="No assets">{canEdit && <button className="primary-button compact" disabled={!online} onClick={() => fileInput.current?.click()}><Upload size={14} />Upload</button>}</ProjectEmpty>
        : !filtered?.length ? <ProjectEmpty icon={Search} title="No matching assets" />
          : view === "grid" ? <ul className="asset-grid">{filtered.map(asset => <li className="asset-card" key={asset._id}>
            <a className="asset-thumb" href={asset.fileUrl || undefined} target="_blank" rel="noreferrer noopener" aria-label={`Open ${asset.name}`}><AssetThumb asset={asset} size="card" /></a>
            <div className="asset-info"><strong title={asset.name}>{asset.name}</strong><small>{assetMeta(asset)}</small>{asset.notes && <small className="asset-notes" title={asset.notes}>{asset.notes}</small>}</div>
            {canEdit && <ConfirmButton className="asset-delete" label={`Delete ${asset.name}`} onConfirm={() => deleteAsset(asset)} />}
          </li>)}</ul>
            : <ul className="asset-list">{filtered.map(asset => <li className="asset-row" key={asset._id}>
              <a className="asset-row-link" href={asset.fileUrl || undefined} target="_blank" rel="noreferrer noopener">
                <span className="asset-row-thumb"><AssetThumb asset={asset} size="row" /></span>
                <span className="asset-row-name"><strong>{asset.name}</strong>{asset.notes && <small>{asset.notes}</small>}</span>
                <span className="asset-row-type">{typeInfo(asset.type).label}</span>
                <span className="asset-row-meta">{assetMeta(asset)}</span>
                <time className="asset-row-date" dateTime={new Date(asset.updatedAt).toISOString()}>{formatDate(asset.updatedAt)}</time>
              </a>
              {canEdit && <ConfirmButton className="icon-button" label={`Delete ${asset.name}`} onConfirm={() => deleteAsset(asset)} />}
            </li>)}</ul>}
    {drop.dragging && <div className="library-drop-overlay" aria-hidden="true"><Upload size={20} /><span>Drop to upload</span></div>}
    <input ref={fileInput} type="file" multiple hidden aria-label="Asset files" onChange={e => { selectFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {dialog && <AssetDialog key={`${dialog.files.length}:${dialog.url}`} projectId={projectId} sessionToken={sessionToken} online={online} initialFiles={dialog.files} initialUrl={dialog.url} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); setQuery(""); setFilter("all"); }} />}
  </section>;
}

function AssetDialog({ projectId, sessionToken, online, initialFiles, initialUrl, onClose, onSaved }: Props & { online: boolean; initialFiles: File[]; initialUrl: string; onClose: () => void; onSaved: () => void }) {
  const upload = useMutation(api.design.generateUploadUrl);
  const create = useMutation(api.design.createAsset);
  const linkHost = hostOf(initialUrl);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [name, setName] = useState(initialFiles[0]?.name.slice(0, 150) || linkHost);
  const [url, setUrl] = useState(initialUrl);
  const [notes, setNotes] = useState("");
  const [type, setType] = useState<AssetType>(initialFiles[0] ? assetFileType(initialFiles[0]) : /(^|\.)figma\.com$/.test(linkHost) ? "figma" : initialUrl ? "document" : "image");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploaded = useRef(new Map<File, Id<"_storage">>());
  const inFlight = useRef(false);
  const drop = useFileDrop({ disabled: busy, onFiles: selection => choose(selection), onLink: link => { setFiles([]); setUrl(link); } });
  const batch = files.length > 1;
  const choose = (selection: File[]) => {
    if (inFlight.current || !selection.length) return;
    try {
      validateAttachmentFiles(selection);
      uploaded.current.clear(); setError(""); setFiles(selection); setUrl("");
      setName(selection[0].name.slice(0, 150)); setType(assetFileType(selection[0]));
    } catch (error) { setError(errorText(error, "Invalid file")); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!online || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!files.length && !url) throw new Error("Choose a file or enter a link");
      if (files.length) {
        await saveAssetFiles({ files, uploaded: uploaded.current,
          upload: async file => {
            const response = await fetch(await upload({ projectId, sessionToken }), { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
            if (!response.ok) throw new Error(`${file.name}: upload failed`);
            return (await response.json()).storageId as Id<"_storage">;
          },
          save: async (file, storageId) => { await create({ projectId, sessionToken, type: batch ? assetFileType(file) : type, name: batch ? file.name.slice(0, 150) : name, storageId, notes: notes || undefined, contentType: file.type || undefined, size: file.size }); },
          onSaved: file => setFiles(current => current.filter(item => item !== file)),
          onProgress: (current, total) => setProgress(`Uploading ${current} of ${total}`),
        });
      } else await create({ projectId, sessionToken, type, name, url: url || undefined, notes: notes || undefined });
      onSaved();
    } catch (error) { setError(errorText(error, "Could not save asset")); }
    finally { inFlight.current = false; setBusy(false); setProgress(""); }
  };
  return <Dialog title={batch ? `Upload ${files.length} files` : "Add asset"} onClose={() => { if (!inFlight.current) onClose(); }}><form className="stack-form library-form" onSubmit={save}>
    <fieldset className="asset-upload-fields" disabled={busy}>
      {files.length ? <ul className="asset-upload-list">{files.map((file, index) => <li key={`${file.name}:${index}`}><File size={15} /><span title={file.name}>{file.name}</span><small>{formatBytes(file.size)}</small><button type="button" className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => { uploaded.current.delete(file); setFiles(current => current.filter(item => item !== file)); }}><X size={14} /></button></li>)}</ul>
        : <button type="button" className={clsx("asset-drop", drop.dragging && "drop-active")} onClick={() => fileInput.current?.click()} {...drop.handlers}><Upload size={20} /><span>Choose files or drop them here</span></button>}
      <input ref={fileInput} aria-label="Asset files" type="file" multiple hidden onChange={e => { choose(Array.from(e.target.files || [])); e.target.value = ""; }} />
      {!files.length && <label>Or a link<input type="url" value={url} onChange={e => { setUrl(e.target.value); if (!name) setName(hostOf(e.target.value)); }} placeholder="https://" /></label>}
      {!batch && (files.length > 0 || url) && <div className="library-form-pair">
        <label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={150} /></label>
        <label>Type<select value={type} onChange={e => setType(e.target.value as AssetType)}>{assetTypes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>}
      {(files.length > 0 || url) && <label>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></label>}
    </fieldset>
    {error && <p className="notice danger" role="alert">{error}</p>}
    <div className="library-form-actions">
      {busy && <span className="asset-upload-progress" role="status">{progress || "Saving"}</span>}
      <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="primary-button" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={!online || busy || (!files.length && !url)}>{busy && <Loader2 className="spin" size={15} />}{files.length > 1 ? `Upload ${files.length}` : files.length ? "Upload" : "Add"}</button>
    </div>
  </form></Dialog>;
}
