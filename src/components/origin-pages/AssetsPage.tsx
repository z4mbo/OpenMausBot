import { useRef, useState, type FormEvent } from "react";
import { Select } from "../Select";
import { AudioLines, File, Film, Image as ImageIcon, Loader2, Palette, Pencil, Plus, Search, SwatchBook, Trash2, Upload } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { revealItem, useItemFocus } from "@/lib/origin-item-focus";
import { cn } from "@/lib/cn";
import { BrandPanel } from "../origin-brand/BrandPanel";
import type { AssetType, CloudDesign, CloudDesignAsset, CloudDesignToken, TokenType } from "./cloud-types";
import { CloudGate, EmptyState, Field, Loading, Modal, Notice, PageHeader, ReadOnlyEditorNotice, Segmented, cardClass, ghostButton, iconButton, inputClass, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";

const ASSET_TYPES: readonly AssetType[] = ["image", "video", "audio", "document", "figma", "icon", "font", "apk", "other"];
const TOKEN_TYPES: readonly TokenType[] = ["color", "typography", "spacing", "component", "motion", "other"];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function assetFileType(file: { name: string; type: string }): AssetType {
  const name = file.name.toLowerCase();
  if (name.endsWith(".apk")) return "apk";
  if (name.endsWith(".svg") || name.endsWith(".ico")) return "icon";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("font/") || /\.(ttf|otf|woff2?)$/.test(name)) return "font";
  if (name.endsWith(".fig")) return "figma";
  return file.type ? "document" : "other";
}

export function AssetsPage(props: OriginPageProps) {
  return <CloudGate {...props} label="Assets">{({ project, projectId, canEdit }) => <Assets projectId={projectId} canEdit={canEdit} projectName={project.name} botId={props.link?.botId} />}</CloudGate>;
}

function Assets({ projectId, canEdit, projectName, botId }: { projectId: string; canEdit: boolean; projectName: string; botId?: string }) {
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const [tab, setTab] = useState<"assets" | "tokens" | "brand">("assets");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetType | "all">("all");
  const [folder, setFolder] = useState("all");
  const [editing, setEditing] = useState<CloudDesignAsset | "new" | null>(null);
  const [tokenEditing, setTokenEditing] = useState<CloudDesignToken | "new" | null>(null);
  const [notice, setNotice] = useState("");
  useItemFocus(projectId, {
    asset: (assetId) => {
      setTab("assets");
      setQuery("");
      setFilter("all");
      setFolder("all");
      return !design?.assets.some((asset) => asset._id === assetId) || revealItem(assetId);
    },
  }, Boolean(design));
  if (!design) return <Loading label="Loading assets" variant="grid" />;
  const needle = query.trim().toLowerCase();
  const folders = [...new Set(design.assets.flatMap((asset) => (asset.folder ? [asset.folder] : [])))].sort();
  const assets = design.assets.filter((asset) => (filter === "all" || asset.type === filter) && (folder === "all" || (folder === "" ? !asset.folder : asset.folder === folder))
    && `${asset.name} ${asset.notes ?? ""}`.toLowerCase().includes(needle));
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
    <section className={pageClass} aria-label="Assets">
      <PageHeader title="Assets" count={tab === "brand" ? undefined : tab === "assets" ? design.assets.length : design.tokens.length}>
        <Segmented label="Asset view" value={tab} onChange={setTab}
          options={[{ value: "assets", label: <><ImageIcon size={13} />Files</> }, { value: "tokens", label: <><Palette size={13} />Tokens</> }, { value: "brand", label: <><SwatchBook size={13} />Brand</> }]} />
        {tab !== "brand" && <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-2 text-ink-tertiary" aria-hidden="true" />
          <input className={cn(inputClass, "w-44 pl-7")} placeholder={tab === "assets" ? "Search assets" : "Search tokens"} aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>}
        {tab === "assets" && (
          <Select size="sm" aria-label="Asset type" value={filter} onChange={(e) => setFilter(e.target.value as AssetType | "all")}>
            <option value="all">All types</option>
            {ASSET_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
        )}
        {tab === "assets" && folders.length > 0 && (
          <Select size="sm" aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="all">All folders</option>
            {folders.map((name) => <option key={name} value={name}>{name}</option>)}
            <option value="">No folder</option>
          </Select>
        )}
        {canEdit && tab !== "brand" && <button type="button" className={primaryButton} onClick={() => (tab === "assets" ? setEditing("new") : setTokenEditing("new"))}><Plus size={14} />{tab === "assets" ? "Add asset" : "Add token"}</button>}
      </PageHeader>
      {notice && <div className="mb-3"><Notice tone="danger">{notice}</Notice></div>}
      {tab === "brand" ? <BrandPanel projectId={projectId} projectName={projectName} canEdit={canEdit} botId={botId} /> : tab === "assets" ? (
        !assets.length ? <EmptyState icon={<ImageIcon size={24} />} title={needle || filter !== "all" ? "No matching assets" : "No assets yet"} body="Images, documents and files the team makes for this project." /> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {assets.map((asset) => {
              const href = asset.fileUrl || asset.url || undefined;
              return (
                <article key={asset._id} data-origin-item={asset._id} className={cn(cardClass, "group relative flex flex-col overflow-hidden")}>
                  <a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${asset.name}`} className="flex h-32 items-center justify-center bg-inset">
                    {href && (asset.type === "image" || asset.type === "icon") ? <img src={href} alt={asset.name} loading="lazy" className="size-full object-contain" />
                      : href && asset.type === "video" ? <span className="relative flex size-full items-center justify-center"><Film size={30} className="absolute text-ink-tertiary" aria-hidden="true" /><video src={href} muted playsInline preload="metadata" className="relative size-full object-cover" /></span>
                        : asset.type === "audio" ? <AudioLines size={30} className="text-ink-tertiary" /> : <File size={30} className="text-ink-tertiary" />}
                  </a>
                  {canEdit && (
                    <div className="absolute right-2 top-2 flex gap-0.5 rounded-lg border border-hairline/40 bg-panel p-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100">
                      <button type="button" className={iconButton} title="Edit asset" aria-label={`Edit ${asset.name}`} onClick={() => setEditing(asset)}><Pencil size={13} /></button>
                      <button type="button" className={iconButton} title="Delete asset" aria-label={`Delete ${asset.name}`} onClick={() => removeAsset(asset)}><Trash2 size={13} /></button>
                    </div>
                  )}
                  <div className="min-w-0 p-3">
                    <strong className="block truncate text-[13px] font-medium text-ink" title={asset.name}>{asset.name}</strong>
                    <small className="text-[11.5px] text-ink-tertiary">{asset.type}{asset.size ? ` · ${Math.ceil(asset.size / 1024)} KB` : ""}{asset.folder ? ` · ${asset.folder}` : ""}</small>
                    {asset.notes && <p className="mt-1 line-clamp-3 text-[12px] text-ink-secondary">{asset.notes}</p>}
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
      {editing && <AssetEditor projectId={projectId} canEdit={canEdit} asset={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {tokenEditing && <TokenEditor projectId={projectId} canEdit={canEdit} token={tokenEditing === "new" ? null : tokenEditing} onClose={() => setTokenEditing(null)} />}
    </section>
  );
}

async function uploadFile(projectId: string, file: File): Promise<string> {
  const uploadUrl = await cloudMutation<string>("design:generateUploadUrl", { projectId });
  const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!response.ok) throw new Error(`${file.name}: upload failed`);
  return ((await response.json()) as { storageId: string }).storageId;
}

function AssetEditor({ projectId, canEdit, asset, onClose }: { projectId: string; canEdit: boolean; asset: CloudDesignAsset | null; onClose(): void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [saved, setSaved] = useState<ReadonlySet<File>>(new Set());
  const [name, setName] = useState(asset?.name ?? "");
  const [type, setType] = useState<AssetType>(asset?.type ?? "image");
  const [url, setUrl] = useState(asset?.url ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const batch = files.length > 1;
  const choose = (selection: File[]) => {
    if (action.busy) return;
    const tooBig = selection.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (tooBig) { action.setError(`${tooBig.name} is over 15 MB`); return; }
    action.setError("");
    setFiles(selection);
    setSaved(new Set());
    if (selection[0]) { setName(selection[0].name.slice(0, 150)); setType(assetFileType(selection[0])); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || action.busy) return;
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
      const unsaved = files.filter((file) => !saved.has(file));
      for (const [index, file] of unsaved.entries()) {
        setProgress(`Uploading ${index + 1} of ${unsaved.length}`);
        const storageId = await uploadFile(projectId, file);
        await cloudMutation("design:createAsset", {
          projectId, storageId, type: batch ? assetFileType(file) : type, name: batch ? file.name.slice(0, 150) : name,
          ...(notes ? { notes } : {}), ...(file.type ? { contentType: file.type } : {}), size: file.size,
        });
        setSaved((current) => new Set(current).add(file));
      }
    }, "Could not save asset");
    setProgress("");
    if (ok) onClose();
  };
  return (
    <Modal title={asset ? "Edit asset" : batch ? "Add assets" : "Add asset"} onClose={onClose} canClose={() => !action.busy}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <ReadOnlyEditorNotice canEdit={canEdit} />
        <fieldset disabled={!canEdit || action.busy} className="contents">
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
              <Select className="w-full" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
                {ASSET_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
            {!files.length && (!asset || asset.url) && <Field label="Link"><input className={inputClass} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>}
          </>
        )}
        <Field label="Notes"><textarea className={inputClass} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {progress && <Notice>{progress}</Notice>}
        <button className={primaryButton} disabled={action.busy || !canEdit}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}{asset ? "Save asset" : batch ? `Save ${files.length - saved.size} assets` : "Save asset"}
        </button>
      </form>
    </Modal>
  );
}

function TokenEditor({ projectId, canEdit, token, onClose }: { projectId: string; canEdit: boolean; token: CloudDesignToken | null; onClose(): void }) {
  const [type, setType] = useState<TokenType>(token?.type ?? "color");
  const [name, setName] = useState(token?.name ?? "");
  const [value, setValue] = useState(token?.value ?? "");
  const [description, setDescription] = useState(token?.description ?? "");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || action.busy) return;
    const ok = await action.run(() => token
      ? cloudMutation("design:updateToken", { projectId, tokenId: token._id, type, name, value, description })
      : cloudMutation("design:createToken", { projectId, type, name, value, ...(description ? { description } : {}) }), "Could not save token");
    if (ok) onClose();
  };
  return (
    <Modal title={token ? "Edit token" : "New token"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <ReadOnlyEditorNotice canEdit={canEdit} />
        <fieldset disabled={!canEdit} className="contents">
        <Field label="Type">
          <Select className="w-full" value={type} onChange={(e) => setType(e.target.value as TokenType)}>
            {TOKEN_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required placeholder="brand.primary" /></Field>
        <Field label="Value"><input className={inputClass} value={value} onChange={(e) => setValue(e.target.value)} required placeholder={type === "color" ? "#1084fe" : ""} /></Field>
        <Field label="Description"><input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button className={primaryButton} disabled={action.busy || !canEdit}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Save token</button>
        </div>
      </form>
    </Modal>
  );
}
