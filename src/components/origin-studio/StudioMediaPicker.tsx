import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import type { AssetType, CloudDesign } from "../origin-pages/cloud-types";
import { EmptyState, Modal, Notice, Segmented, ghostButton, useAction } from "../origin-pages/ui";
import { KIND_ICON, MediaThumb, assetRef, isKindAsset, outputRef, type SourceRef } from "./studio-ui";
import type { StudioGeneration, StudioMediaKind } from "../../../shared/studio";

const UPLOAD_MAX = 15 * 1024 * 1024;
const KIND_WORD: Record<StudioMediaKind, string> = { image: "image", video: "video", audio: "audio file" };

/** Picks a starting file: a finished Studio output, a project asset, or a new upload, which also lands in Assets. */
export function StudioMediaPicker({ projectId, kind, rows, title, assetsOnly, onPick, onClose }: {
  projectId: string; kind: StudioMediaKind; rows: readonly StudioGeneration[]; title?: string; assetsOnly?: boolean; onPick(ref: SourceRef): void; onClose(): void;
}) {
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const outputs = rows.filter((row) => row.status === "done").flatMap((row) => row.outputs.map((_, index) => {
    const ref = outputRef(row, index);
    const saved = row.saved.find((entry) => entry.index === index);
    if (!assetsOnly || !ref) return ref;
    return saved ? { ...ref, source: { assetId: saved.assetId } } : null;
  })).filter((ref): ref is SourceRef => ref !== null && ref.kind === kind).slice(0, 48);
  const assets = (design?.assets ?? []).filter((asset) => isKindAsset(asset, kind) && !asset.studio);
  const [tab, setTab] = useState<"studio" | "assets">(outputs.length ? "studio" : "assets");
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const Icon = KIND_ICON[kind];
  const pick = (ref: SourceRef) => {
    onPick(ref);
    onClose();
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > UPLOAD_MAX) {
      action.setError(`${file.name} is over 15 MB`);
      return;
    }
    void action.run(async () => {
      const uploadUrl = await cloudMutation<string>("design:generateUploadUrl", { projectId });
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!response.ok) throw new Error(`${file.name}: upload failed`);
      const { storageId } = await response.json() as { storageId: string };
      const type: AssetType = kind === "image" ? "image" : kind;
      const assetId = await cloudMutation<string>("design:createAsset", { projectId, storageId, type, name: file.name.slice(0, 150), contentType: file.type || undefined, size: file.size });
      pick({ kind, label: file.name, url: URL.createObjectURL(file), source: { assetId } });
    }, "Could not upload the file");
  };
  const list = tab === "studio" ? outputs : assets.map((asset) => assetRef(asset, kind));
  return (
    <Modal title={title ?? `Choose ${kind === "image" ? "an" : "a"} ${KIND_WORD[kind]}`} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Where from" value={tab} onChange={setTab} options={[{ value: "studio", label: `Studio · ${outputs.length}` }, { value: "assets", label: `Assets · ${assets.length}` }]} />
        <button type="button" className={`${ghostButton} ml-auto`} onClick={() => input.current?.click()} disabled={action.busy}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Upload
        </button>
        <input ref={input} type="file" hidden accept={`${kind}/*`} aria-label="Upload a file" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {action.error && <div className="mb-3"><Notice tone="danger">{action.error}</Notice></div>}
      {!list.length ? (
        <EmptyState compact icon={<Icon size={22} />} title={tab === "studio" ? `No ${KIND_WORD[kind]}s generated yet` : `No ${KIND_WORD[kind]}s in Assets yet`} />
      ) : (
        <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 overflow-y-auto" data-studio-media-picker>
          {list.map((ref) => (
            <button key={JSON.stringify(ref.source)} type="button" onClick={() => pick(ref)} title={ref.label}
              className="group flex flex-col overflow-hidden rounded-lg border border-hairline/40 bg-inset text-left outline-none transition-colors duration-(--motion-fast) hover:border-accent/60 focus-visible:border-accent">
              <MediaThumb kind={kind} url={ref.url} className="aspect-square w-full" />
              <span className="truncate px-2 py-1.5 text-[12px] text-ink-secondary group-hover:text-ink">{ref.label}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
