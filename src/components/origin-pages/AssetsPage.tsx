import { useRef, useState, type FormEvent } from "react";
import { Select } from "../Select";
import { ExternalLink, File, Image as ImageIcon, Loader2, Palette, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import type { AssetType, CloudDesign, CloudDesignAsset, CloudDesignToken, TokenType } from "./cloud-types";
import { CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, Segmented, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction, type OriginPageProps } from "./ui";

const ASSET_TYPES: readonly AssetType[] = ["image", "document", "figma", "icon", "font", "apk", "other"];
const TOKEN_TYPES: readonly TokenType[] = ["color", "typography", "spacing", "component", "motion", "other"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function assetFileType(file: { name: string; type: string }): AssetType {
  const name = file.name.toLowerCase();
  if (name.endsWith(".apk")) return "apk";
  if (name.endsWith(".svg") || name.endsWith(".ico")) return "icon";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("font/") || /\.(ttf|otf|woff2?)$/.test(name)) return "font";
  if (name.endsWith(".fig")) return "figma";
  return file.type ? "document" : "other";
}

export function AssetsPage(props: OriginPageProps) {
  return <CloudGate {...props} label="Assets">{({ projectId, canEdit }) => <Assets projectId={projectId} canEdit={canEdit} />}</CloudGate>;
}

function Assets({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const [tab, setTab] = useState<"assets" | "tokens">("assets");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetType | "all">("all");
  const [editing, setEditing] = useState<CloudDesignAsset | "new" | null>(null);
  const [tokenEditing, setTokenEditing] = useState<CloudDesignToken | "new" | null>(null);
  const [notice, setNotice] = useState("");
  if (!design) return <Loading label="Loading assets" />;
  const needle = query.trim().toLowerCase();
  const assets = design.assets.filter((asset) => (filter === "all" || asset.type === filter) && `${asset.name} ${asset.notes ?? ""}`.toLowerCase().includes(needle));
  const tokens = design.tokens.filter((token) => `${token.name} ${token.value} ${token.description ?? ""}`.toLowerCase().includes(needle));
  const removeAsset = (asset: CloudDesignAsset) => {
    if (!window.confirm(`Delete ${asset.name}?`)) return;
    void cloudMutation("design:removeAsset", { projectId, assetId: asset._id }).catch(() => setNotice("Could not delete asset"));
  };
  const removeToken = (token: CloudDesignToken) => {
    if (!window.confirm(`Delete ${token.name}?`)) return;
    void cloudMutation("design:removeToken", { projectId, tokenId: token._id }).catch(() => setNotice("Could not delete token"));
  };
  return (
    <section className="flex-1 overflow-y-auto p-6" aria-label="Assets">
      <PageHeader title="Assets" count={tab === "assets" ? design.assets.length : design.tokens.length}>
        <Segmented label="Asset view" value={tab} onChange={setTab}
          options={[{ value: "assets", label: <><ImageIcon size={13} />Files</> }, { value: "tokens", label: <><Palette size={13} />Tokens</> }]} />
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
          <input className={cn(inputClass, "w-44 pl-7")} placeholder={tab === "assets" ? "Search assets" : "Search tokens"} aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {tab === "assets" && (
          <Select className={cn(inputClass, "w-auto")} aria-label="Asset type" value={filter} onChange={(e) => setFilter(e.target.value as AssetType | "all")}>
            <option value="all">All types</option>
            {ASSET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
        )}
        {canEdit && <button type="button" className={primaryButton} onClick={() => (tab === "assets" ? setEditing("new") : setTokenEditing("new"))}><Plus size={14} />{tab === "assets" ? "Add asset" : "Add token"}</button>}
      </PageHeader>
      {notice && <div className="mb-3"><Notice tone="danger">{notice}</Notice></div>}
      {tab === "assets" ? (
        !assets.length ? <EmptyState icon={<ImageIcon size={24} />} title={needle || filter !== "all" ? "No matching assets" : "No assets yet"} body="Images, documents and files the team makes for this project." /> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {assets.map((asset) => {
              const href = asset.fileUrl || asset.url || undefined;
              return (
                <article key={asset._id} className={cn(cardClass, "group flex flex-col overflow-hidden")}>
                  <a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${asset.name}`} className="flex h-32 items-center justify-center bg-inset">
                    {href && (asset.type === "image" || asset.type === "icon") ? <img src={href} alt={asset.name} loading="lazy" className="size-full object-contain" /> : <File size={30} className="text-ink-tertiary" />}
                  </a>
                  <div className="flex items-start gap-1 p-3">
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-medium text-ink" title={asset.name}>{asset.name}</strong>
                      <small className="text-[11.5px] text-ink-tertiary">{asset.type}{asset.size ? ` · ${Math.ceil(asset.size / 1024)} KB` : ""}</small>
                      {asset.notes && <p className="mt-1 line-clamp-3 text-[12px] text-ink-secondary">{asset.notes}</p>}
                    </div>
                    {href && <a className={iconButton} href={href} target="_blank" rel="noreferrer" title="Open asset" aria-label={`Open ${asset.name} in a new tab`}><ExternalLink size={13} /></a>}
                    {canEdit && <button type="button" className={iconButton} title="Edit asset" aria-label={`Edit ${asset.name}`} onClick={() => setEditing(asset)}><Pencil size={13} /></button>}
                    {canEdit && <button type="button" className={iconButton} title="Delete asset" aria-label={`Delete ${asset.name}`} onClick={() => removeAsset(asset)}><Trash2 size={13} /></button>}
                  </div>
                </article>
              );
            })}
          </div>
        )
      ) : !tokens.length ? <EmptyState icon={<Palette size={24} />} title={needle ? "No matching tokens" : "No design tokens yet"} body="Colours, type and spacing values the project's design uses." /> : (
        <div className={cn(cardClass, "divide-y divide-hairline/30")}>
          {tokens.map((token) => (
            <div key={token._id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              {token.type === "color" ? <span className="size-5 shrink-0 rounded-md border border-hairline/60" style={{ background: token.value }} aria-hidden="true" /> : <Palette size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><strong className="truncate font-medium text-ink">{token.name}</strong><span className="text-[11.5px] text-ink-tertiary">{token.type}</span></div>
                {token.description && <p className="truncate text-[12px] text-ink-secondary">{token.description}</p>}
              </div>
              <code className="max-w-[40%] truncate rounded bg-inset px-1.5 py-0.5 text-[12px] text-ink-secondary">{token.value}</code>
              {canEdit && <button type="button" className={iconButton} aria-label={`Edit ${token.name}`} onClick={() => setTokenEditing(token)}><Pencil size={13} /></button>}
              {canEdit && <button type="button" className={iconButton} aria-label={`Delete ${token.name}`} onClick={() => removeToken(token)}><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      {editing && <AssetEditor projectId={projectId} asset={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {tokenEditing && <TokenEditor projectId={projectId} token={tokenEditing === "new" ? null : tokenEditing} onClose={() => setTokenEditing(null)} />}
    </section>
  );
}

async function uploadFile(projectId: string, file: File): Promise<string> {
  const uploadUrl = await cloudMutation<string>("design:generateUploadUrl", { projectId });
  const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!response.ok) throw new Error(`${file.name}: upload failed`);
  return ((await response.json()) as { storageId: string }).storageId;
}

function AssetEditor({ projectId, asset, onClose }: { projectId: string; asset: CloudDesignAsset | null; onClose(): void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState(asset?.name ?? "");
  const [type, setType] = useState<AssetType>(asset?.type ?? "image");
  const [url, setUrl] = useState(asset?.url ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const batch = files.length > 1;
  const choose = (selection: File[]) => {
    const tooBig = selection.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (tooBig) { action.setError(`${tooBig.name} is over 15 MB`); return; }
    action.setError("");
    setFiles(selection);
    if (selection[0]) { setName(selection[0].name.slice(0, 150)); setType(assetFileType(selection[0])); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action.run(async () => {
      if (asset) {
        await cloudMutation("design:updateAsset", { projectId, assetId: asset._id, name, type, notes, ...(url !== (asset.url ?? "") ? { url } : {}) });
        return;
      }
      if (!files.length && !url) throw new Error("Choose a file or enter a link");
      if (!files.length) {
        await cloudMutation("design:createAsset", { projectId, type, name, url, ...(notes ? { notes } : {}) });
        return;
      }
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}`);
        const storageId = await uploadFile(projectId, file);
        await cloudMutation("design:createAsset", {
          projectId, storageId, type: batch ? assetFileType(file) : type, name: batch ? file.name.slice(0, 150) : name,
          ...(notes ? { notes } : {}), ...(file.type ? { contentType: file.type } : {}), size: file.size,
        });
      }
    }, "Could not save asset");
    setProgress("");
    if (ok) onClose();
  };
  return (
    <Modal title={asset ? "Edit asset" : batch ? "Add assets" : "Add asset"} onClose={() => { if (!action.busy) onClose(); }}>
      <form onSubmit={save} className="flex flex-col gap-3">
        {!asset && (
          <>
            <button type="button" onClick={() => input.current?.click()}
              onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(Array.from(event.dataTransfer.files)); }}
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline bg-inset px-4 py-6 text-[13px] text-ink-secondary hover:border-accent/60 hover:text-ink">
              <Upload size={22} />{files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} selected` : "Choose or drop files"}
            </button>
            <input ref={input} type="file" multiple hidden aria-label="Asset files" onChange={(e) => { choose(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </>
        )}
        {!batch && (
          <>
            <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} /></Field>
            <Field label="Type">
              <Select className={inputClass} value={type} onChange={(e) => setType(e.target.value as AssetType)}>
                {ASSET_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
            {!files.length && (!asset || asset.url) && <Field label="Link"><input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>}
          </>
        )}
        <Field label="Notes"><textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {progress && <Notice>{progress}</Notice>}
        <button className={primaryButton} disabled={action.busy}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{asset ? "Save asset" : batch ? `Save ${files.length} assets` : "Save asset"}
        </button>
      </form>
    </Modal>
  );
}

function TokenEditor({ projectId, token, onClose }: { projectId: string; token: CloudDesignToken | null; onClose(): void }) {
  const [type, setType] = useState<TokenType>(token?.type ?? "color");
  const [name, setName] = useState(token?.name ?? "");
  const [value, setValue] = useState(token?.value ?? "");
  const [description, setDescription] = useState(token?.description ?? "");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action.run(() => token
      ? cloudMutation("design:updateToken", { projectId, tokenId: token._id, type, name, value, description })
      : cloudMutation("design:createToken", { projectId, type, name, value, ...(description ? { description } : {}) }), "Could not save token");
    if (ok) onClose();
  };
  return (
    <Modal title={token ? "Edit token" : "New token"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Type">
          <Select className={inputClass} value={type} onChange={(e) => setType(e.target.value as TokenType)}>
            {TOKEN_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required placeholder="brand.primary" /></Field>
        <Field label="Value"><input className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} required placeholder={type === "color" ? "#1084fe" : ""} /></Field>
        <Field label="Description"><input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button className={primaryButton} disabled={action.busy}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Save token</button>
        </div>
      </form>
    </Modal>
  );
}
