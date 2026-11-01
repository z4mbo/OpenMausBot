"use client";
import { formatBytes } from "@/lib/format-bytes";
import { errorText } from "@/lib/error-text";
import { ContentSkeleton } from "./content-skeleton";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, Eye, EyeOff, ExternalLink, File, Image, KeyRound, Loader2, LockKeyhole, Plus, Search, ShieldCheck, Shuffle, Trash2, Upload, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { decryptSecret, encryptSecret } from "@/lib/vaultCrypto";
import { Dialog } from "./dialog";
import { useWorkspace } from "./workspace-context";
import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";
import { useFileDrop } from "./use-file-drop";
import { validateAttachmentFiles } from "@/lib/dropped-content";
import { assetFileType, saveAssetFiles } from "@/lib/asset-uploads";

type Props = { projectId: Id<"projects">; sessionToken: string };
const kinds = { password: "Website login", api_key: "API key", secret: "Secret", note: "Secure note" };

export function VaultPanel({ projectId, sessionToken }: Props) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const items = useQuery(api.credentials.list, { projectId, sessionToken });
  const create = useMutation(api.credentials.create);
  const remove = useMutation(api.credentials.remove);
  const [passphrase, setPassphrase] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<keyof typeof kinds>("password");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const lock = () => { epoch.current++; setPassphrase(""); setRevealed({}); setUnlocked(false); setOpen(false); setSecret(""); };
  useEffect(() => {
    if (!unlocked) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, 5 * 60000); };
    const hide = () => { if (document.hidden) lock(); };
    reset(); window.addEventListener("pointerdown", reset); window.addEventListener("keydown", reset); document.addEventListener("visibilitychange", hide);
    return () => { clearTimeout(timer); epoch.current++; window.removeEventListener("pointerdown", reset); window.removeEventListener("keydown", reset); document.removeEventListener("visibilitychange", hide); };
  }, [unlocked]);
  const unlock = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setNotice("");
    try { if (items?.length) await decryptSecret(items[0], passphrase); else if (passphrase.length < 10) throw new Error("Use a passphrase of at least 10 characters"); setUnlocked(true); }
    catch { setNotice("Could not unlock. Check your vault passphrase."); }
    finally { setBusy(false); }
  };
  const reveal = async (item: Doc<"credentials">, copy = false) => {
    const started = epoch.current;
    try {
      if (!copy && revealed[item._id]) { setRevealed(current => { const next = { ...current }; delete next[item._id]; return next; }); return; }
      const value = await decryptSecret(item, passphrase);
      if (started !== epoch.current) return;
      if (copy) { await navigator.clipboard.writeText(value); setNotice("Secret copied"); }
      else setRevealed(current => ({ ...current, [item._id]: value }));
    } catch { setNotice("Could not decrypt this item with this passphrase"); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!online) return; setBusy(true); setNotice("");
    try { await create({ projectId, sessionToken, kind, title, username: username || undefined, url: url || undefined, ...await encryptSecret(secret, passphrase) }); setOpen(false); setTitle(""); setUsername(""); setUrl(""); setSecret(""); }
    catch (error) { setNotice(errorText(error, "Could not save")); }
    finally { setBusy(false); }
  };
  if (items === undefined) return <ContentSkeleton label="Loading project files" />;
  if (!unlocked) return <section className="vault-locked"><ShieldCheck size={32} /><h2>{items.length ? "Project vault" : "Set up project vault"}</h2>{items.length > 0 && <span>{items.length} encrypted {items.length === 1 ? "item" : "items"}</span>}<form className="stack-form" onSubmit={unlock}><label>Vault passphrase<input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} required minLength={items.length ? 1 : 10} /></label>{notice && <p role="alert" className="notice danger">{notice}</p>}<button className="primary-button" title={!online && !items.length ? RECONNECT_TO_CREATE : undefined} disabled={busy || (!online && !items.length)}>{busy ? <Loader2 className="spin" size={15} /> : <LockKeyhole size={15} />}{items.length ? "Unlock vault" : "Create vault"}</button></form></section>;
  const filtered = items.filter(item => `${item.title} ${item.username || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="project-library"><div className="library-toolbar"><label className="inline-search"><Search size={15} /><input aria-label="Search vault" placeholder="Search vault" value={query} onChange={e => setQuery(e.target.value)} /></label><div><button className="ghost-button compact" onClick={lock}><LockKeyhole size={14} />Lock</button>{workspace.role !== "viewer" && <button className="primary-button compact" disabled={!online} title={!online ? RECONNECT_TO_CREATE : undefined} onClick={() => setOpen(true)}><Plus size={14} />New item</button>}</div></div>{notice && <p className="notice" role="status">{notice}</p>}
    {!filtered.length && <div className="library-empty"><KeyRound size={24} /><h3>{query ? "No matching items" : "No saved secrets"}</h3></div>}
    <div className="library-rows">{filtered.map(item => <article className="library-row" key={item._id}><span className="library-file-icon"><KeyRound size={18} /></span><div><strong>{item.title}</strong><small>{kinds[item.kind as keyof typeof kinds] || "Secret"}{item.username && ` / ${item.username}`}</small>{revealed[item._id] && <code className="secret-code">{revealed[item._id]}</code>}</div><div className="library-row-actions"><button className="icon-button" title={revealed[item._id] ? "Hide secret" : "Reveal secret"} aria-label={revealed[item._id] ? `Hide ${item.title}` : `Reveal ${item.title}`} onClick={() => reveal(item)}>{revealed[item._id] ? <EyeOff size={16} /> : <Eye size={16} />}</button><button className="icon-button" title="Copy secret" aria-label={`Copy ${item.title}`} onClick={() => reveal(item, true)}><Copy size={16} /></button>{workspace.role !== "viewer" && <button className="icon-button" title="Delete secret" aria-label={`Delete ${item.title}`} onClick={async () => { if (!window.confirm(`Delete ${item.title}?`)) return; try { await remove({ projectId, sessionToken, credentialId: item._id }); } catch { setNotice("Could not delete item"); } }}><Trash2 size={15} /></button>}</div></article>)}</div>
    {open && <Dialog title="New vault item" onClose={() => { setOpen(false); setSecret(""); }}><form className="stack-form" onSubmit={save}><label>Type<select value={kind} onChange={e => setKind(e.target.value as keyof typeof kinds)}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Name<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={150} /></label><label>Account<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" /></label><label>Website<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></label><label>{kind === "note" ? "Secure note" : "Secret"}<span className="secret-input"><input type="password" value={secret} onChange={e => setSecret(e.target.value)} required autoComplete="new-password" /><button type="button" className="icon-button" title="Generate password" aria-label="Generate password" onClick={() => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_"; setSecret(Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n => alphabet[n % alphabet.length]).join("")); }}><Shuffle size={16} /></button></span></label><button className="primary-button" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={busy || !online}>{busy ? <Loader2 className="spin" size={15} /> : <LockKeyhole size={15} />}Save encrypted item</button></form></Dialog>}
  </section>;
}

export function AssetsPanel({ projectId, sessionToken }: Props) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const design = useQuery(api.design.list, { projectId, sessionToken });
  const upload = useMutation(api.design.generateUploadUrl);
  const create = useMutation(api.design.createAsset);
  const remove = useMutation(api.design.removeAsset);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploaded = useRef(new Map<File, Id<"_storage">>());
  const inFlight = useRef(false);
  const [type, setType] = useState<Doc<"designAssets">["type"]>("image");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const resetForm = () => { setFiles([]); uploaded.current.clear(); setBatch(false); setName(""); setUrl(""); setNotes(""); setType("image"); setNotice(""); setProgress(""); };
  const selectFiles = (selection: File[]) => {
    if (inFlight.current || !selection.length) return;
    try {
      validateAttachmentFiles(selection); resetForm(); setFiles(selection); setBatch(selection.length > 1);
      setName(selection[0].name.slice(0, 150)); setType(assetFileType(selection[0])); setOpen(true);
    } catch (error) { setNotice(errorText(error, "Invalid file")); }
  };
  const drop = useFileDrop({ disabled: !online || workspace.role === "viewer" || busy, onFiles: selectFiles, onLink: url => { resetForm(); setUrl(url); setName(new URL(url).hostname); setType(/(^|\.)figma\.com$/.test(new URL(url).hostname) ? "figma" : "document"); setOpen(true); } });
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!online || inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice("");
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
      setOpen(false); resetForm(); setQuery(""); setFilter("all");
    } catch (error) { setNotice(errorText(error, "Could not save asset")); }
    finally { inFlight.current = false; setBusy(false); setProgress(""); }
  };
  const filtered = design?.assets.filter(asset => (filter === "all" || asset.type === filter) && `${asset.name} ${asset.notes || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section aria-label="Project assets" className={`project-library project-assets ${drop.dragging ? "drop-active" : ""}`} {...drop.handlers}><div className="library-toolbar"><label className="inline-search"><Search size={15} /><input aria-label="Search assets" placeholder="Search assets" value={query} onChange={e => setQuery(e.target.value)} /></label><div><select aria-label="Asset type" value={filter} onChange={e => setFilter(e.target.value)}>{["all", "image", "document", "figma", "icon", "font", "apk", "other"].map(t => <option key={t} value={t}>{t === "all" ? "All types" : t}</option>)}</select>{workspace.role !== "viewer" && <button className="primary-button compact" disabled={!online} title={!online ? RECONNECT_TO_CREATE : undefined} onClick={() => { resetForm(); setOpen(true); }}><Plus size={14} />Add asset</button>}</div></div>{notice && !open && <p className="notice" role="status">{notice}</p>}
    {design === undefined ? <ContentSkeleton label="Loading project files" /> : !filtered?.length ? <div className="library-empty"><Image size={24} /><h3>{query ? "No matching assets" : "No assets yet"}</h3></div> : <div className="asset-cards">{filtered.map(asset => <article className="asset-card" key={asset._id}><a className="asset-preview" href={asset.fileUrl || undefined} target="_blank" rel="noreferrer" aria-label={`Open ${asset.name}`}>{asset.fileUrl && (asset.type === "image" || asset.type === "icon") ? <img src={asset.fileUrl} alt={asset.name} loading="lazy" /> : <File size={30} />}</a><div className="asset-card-meta"><div><strong>{asset.name}</strong><small>{asset.type}{asset.size ? ` / ${formatBytes(asset.size)}` : ""}</small></div>{asset.fileUrl && <a className="icon-button" href={asset.fileUrl} title="Open asset" aria-label={`Open ${asset.name}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>}{workspace.role !== "viewer" && <button className="icon-button" title="Delete asset" aria-label={`Delete ${asset.name}`} onClick={async () => { if (!window.confirm(`Delete ${asset.name}?`)) return; try { await remove({ projectId, sessionToken, assetId: asset._id }); } catch { setNotice("Could not delete asset"); } }}><Trash2 size={14} /></button>}</div>{asset.notes && <p>{asset.notes}</p>}</article>)}</div>}
    {open && <Dialog title={batch ? "Add assets" : "Add asset"} onClose={() => { if (!inFlight.current) setOpen(false); }}><form className="stack-form asset-upload-form" onSubmit={save}>
      <fieldset className="asset-upload-fields" disabled={busy}>
        <button type="button" aria-label="Choose asset files" className={`asset-drop ${drop.dragging ? "drop-active" : ""}`} onClick={() => fileInput.current?.click()}><Upload size={24} /><span>{files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} selected` : "Choose files"}</span></button><input ref={fileInput} aria-label="Asset files" type="file" multiple hidden onChange={e => { selectFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
        {!!files.length && <ul className="asset-upload-list">{files.map((file, index) => <li key={`${file.name}:${index}`}><File size={16} /><span title={file.name}>{file.name}</span><small>{formatBytes(file.size)}</small><button type="button" className="icon-button" title="Remove file" aria-label={`Remove ${file.name}`} onClick={() => { uploaded.current.delete(file); setFiles(current => current.filter(item => item !== file)); }}><X size={14} /></button></li>)}</ul>}
        {!batch && <><label>Name<input value={name} onChange={e => setName(e.target.value)} required maxLength={150} /></label><label>Type<select value={type} onChange={e => setType(e.target.value as typeof type)}>{["image", "document", "figma", "icon", "font", "apk", "other"].map(t => <option key={t}>{t}</option>)}</select></label>{!files.length && <label>Link<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" /></label>}</>}
        <label>Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></label>
      </fieldset>
      {notice && <p className="notice danger" role="alert">{notice}</p>}
      {busy && <span className="asset-upload-progress" role="status">{progress || "Saving asset"}</span>}
      <button className="primary-button" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={!online || busy || (batch && !files.length)}>{busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}{batch ? `Save ${files.length} ${files.length === 1 ? "asset" : "assets"}` : "Save asset"}</button>
    </form></Dialog>}
  </section>;
}
