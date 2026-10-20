import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Download, FolderInput, Image as ImageIcon, Loader2, Send, Sparkles, X } from "lucide-react";
import { compactScene } from "../../../shared/canvas-ops";
import { randomId, type CanvasNode } from "../../../shared/canvas-scene";
import { cloudMutation, useCloudQuery, useCloudSession, useCloudUrl } from "@/lib/origin-cloud";
import { cloudUrl, sessionStore } from "@/lib/origin-cloud/client";
import { drawingOutbox, type OutboxFile } from "@/lib/origin-drawing-outbox";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { composeMessage, imageAttachmentFromFile } from "@/lib/composer-attachments";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { openOriginPage } from "@/lib/origin-pages";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot } from "@/state/thread-navigation";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { BotAvatar } from "../Avatar";
import { MemberAvatar, personTone } from "../OriginPeople";
import { topmost } from "./canvas/actions";
import { CanvasEditor, type PlacedImage, type SelectionApi } from "./canvas/CanvasEditor";
import { download, exportSvg, fileSafe, svgToPng } from "./canvas/export";
import { Inspector } from "./canvas/Inspector";
import { LayersPanel } from "./canvas/LayersPanel";
import { PublishSection } from "./canvas/PublishSection";
import { useCanvasScene, type CanvasScene } from "./canvas/use-canvas-scene";
import type { CloudDesign, CloudDesignAsset } from "./cloud-types";
import { errorText } from "./repo-url";
import { Loading, Notice, iconButton, inputClass, primaryButton } from "./ui";

type Presence = { userId: string; name: string; x: number; y: number; button: string; updatedAt: number };
type StoredFile = { fileId: string; mimeType: string; url: string | null };
type Pointer = { x: number; y: number; button: "up" | "down" };

const FLUSH_MS = 200;
const PRESENCE_MS = 10_000;
const POINTER_MS = 120;
const PRESENCE_TTL_MS = 30_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const IMAGE_MAX_BYTES = 15 * 1024 * 1024;

export type DrawingCanvasProps = { teamId: string; canvasId?: string; projectId?: string; userId: string; name: string; readOnly: boolean; agent?: Bot; lead?: ReactNode };

function imageBlob(file: OutboxFile): Blob {
  const separator = file.dataURL.indexOf(",");
  if (!file.dataURL.startsWith("data:") || separator < 0) throw new Error("Invalid canvas image");
  const payload = file.dataURL.slice(separator + 1);
  return new Blob(file.dataURL.slice(0, separator).endsWith(";base64")
    ? [Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))]
    : [decodeURIComponent(payload)], { type: file.mimeType });
}

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const naturalSize = (url: string) => new Promise<{ width: number; height: number }>((resolve) => {
  const image = new Image();
  image.onload = () => resolve({ width: image.naturalWidth || 240, height: image.naturalHeight || 160 });
  image.onerror = () => resolve({ width: 240, height: 160 });
  image.src = url;
});

export function DrawingCanvas({ teamId, canvasId, projectId, userId, name, readOnly, agent, lead }: DrawingCanvasProps) {
  const args = canvasId ? { teamId, canvasId } : { teamId };
  const rows = useCloudQuery<string[]>("draw:scene", args);
  const presence = useCloudQuery<Presence[]>("draw:presence", args);
  const storedFiles = useCloudQuery<StoredFile[]>("draw:files", args);
  const server = useCloudUrl() ?? "";
  const { token } = useCloudSession();
  const outbox = useMemo(() => drawingOutbox({ server, userId, teamId, canvasId }), [server, userId, teamId, canvasId]);
  useSyncExternalStore(outbox.subscribe, outbox.snapshot);
  const canvas = useCanvasScene(rows, outbox, readOnly);
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [admitted, setAdmitted] = useState<ReadonlyMap<string, string>>(new Map());
  const [selected, setSelected] = useState<readonly string[]>([]);
  const fileRetryAt = useRef(0);
  const mounted = useRef(false);
  const lastPointer = useRef(0);
  const pointer = useRef<Pointer>({ x: 0, y: 0, button: "up" });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const stillSignedIn = () => Boolean(token) && cloudUrl() === server && sessionStore.get() === token;
  const sendPresence = (leave = false) => { if (stillSignedIn()) void cloudMutation("draw:setPresence", { ...args, sessionToken: token, ...pointer.current, ...(leave ? { leave: true } : {}) }).catch(() => {}); };
  const save = async (elements: readonly object[]) => {
    if (!stillSignedIn() || readOnly) throw new Error("Sign in with edit access to sync this canvas");
    return cloudMutation("draw:updateElements", { ...args, sessionToken: token, elements: elements.map((element) => JSON.stringify(element)) });
  };

  const upload = async (file: OutboxFile) => {
    if (!stillSignedIn() || readOnly || !outbox.beginFileUpload(file.id)) return;
    try {
      const url = await cloudMutation<string>("draw:uploadUrl", { ...args, sessionToken: token });
      if (!stillSignedIn()) return;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.mimeType }, body: imageBlob(file) });
      if (!response.ok) throw new Error("Image upload failed");
      const { storageId } = await response.json() as { storageId: string };
      if (!stillSignedIn()) return;
      await cloudMutation("draw:saveFile", { ...args, sessionToken: token, fileId: file.id, storageId, mimeType: file.mimeType });
      outbox.acknowledgeFile(file.id);
      if (mounted.current) setNotice("");
    } catch (error) {
      fileRetryAt.current = Date.now() + 5000;
      if (mounted.current) setNotice(errorText(error, "Image upload failed"));
    } finally { outbox.endFileUpload(file.id); }
  };

  useEffect(() => {
    const flush = () => {
      if (rows === undefined || readOnly) return;
      void outbox.flush(save);
      if (Date.now() >= fileRetryAt.current) for (const file of outbox.files()) void upload(file);
    };
    const timer = window.setInterval(flush, FLUSH_MS);
    const tick = window.setInterval(() => { setClock(Date.now()); sendPresence(); }, PRESENCE_MS);
    sendPresence();
    return () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
      if (!readOnly) void outbox.flush(save, true);
      sendPresence(true);
    };
  }, [teamId, canvasId, outbox, server, token, readOnly, rows === undefined]);

  const pending = outbox.files();
  const images = useMemo(() => {
    const map = new Map<string, string>(admitted);
    for (const file of storedFiles ?? []) if (file.url) map.set(file.fileId, file.url);
    for (const file of pending) map.set(file.id, file.dataURL);
    return map;
  }, [storedFiles, admitted, pending.length]);

  const here = (presence ?? []).filter((member) => member.updatedAt > clock - PRESENCE_TTL_MS);
  const cursors = here.filter((member) => member.userId !== userId).map((member) => ({ userId: member.userId, name: member.name, x: member.x, y: member.y, color: personTone({ name: member.name }) }));

  const onPointer = useCallback((point: { x: number; y: number }, down: boolean) => {
    pointer.current = { x: point.x, y: point.y, button: down ? "down" : "up" };
    if (Date.now() - lastPointer.current < POINTER_MS) return;
    lastPointer.current = Date.now();
    sendPresence();
  }, [token, server, teamId, canvasId]);

  const addImage = async (file: File): Promise<PlacedImage> => {
    if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_MAX_BYTES) throw new Error("Choose a PNG, JPEG, WebP, GIF or SVG under 15 MB");
    const dataURL = await readDataUrl(file);
    const size = await naturalSize(dataURL);
    const id = randomId();
    outbox.enqueueFiles([{ id, dataURL, mimeType: file.type }]);
    return { fileId: id, ...size, name: file.name };
  };

  const placeAsset = async (asset: CloudDesignAsset & { storageId?: string }): Promise<PlacedImage> => {
    if (!asset.storageId || !asset.fileUrl || !IMAGE_TYPES.includes(asset.contentType ?? "")) throw new Error("This asset is not an image file");
    const fileId = `asset-${asset._id}`;
    await cloudMutation("draw:saveFile", { ...args, sessionToken: token, fileId, storageId: asset.storageId, mimeType: asset.contentType });
    setAdmitted((current) => new Map(current).set(fileId, asset.fileUrl!));
    return { fileId, name: asset.name, ...(await naturalSize(asset.fileUrl)) };
  };

  if (rows === undefined) return <Loading label="Loading the canvas" variant="grid" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col origin-overlay-in" data-drawing-canvas>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hairline/40 px-3 py-1.5 md:px-4">
        <div className={cn("min-w-0 flex-1", lead && "basis-full sm:basis-auto")}>{lead ?? <span className="text-[13px] font-medium text-ink">{name}</span>}</div>
        <CanvasPresence here={here} userId={userId} />
        {readOnly && <span className="rounded-full bg-raised px-2.5 py-1 text-[11.5px] text-ink-secondary">View only</span>}
        {outbox.size > 0 && <span role="status" className="text-[11.5px] text-ink-tertiary">{outbox.error ? "Waiting to sync" : "Saving…"}</span>}
        {agent && <AskAgent agent={agent} canvas={canvas} selected={selected} images={images} name={name} canvasId={canvasId} />}
      </div>
      <div className="relative flex min-h-0 flex-1">
        {(notice || outbox.error || outbox.storageNotice) && (
          <p role="alert" className="absolute left-3 right-3 top-3 z-30 mx-auto w-fit max-w-[calc(100%-24px)] rounded-lg bg-danger/15 px-3 py-1.5 text-[12.5px] text-danger origin-pop-badge">
            {outbox.storageNotice || notice || outbox.error}
          </p>
        )}
        <CanvasEditor canvas={canvas} readOnly={readOnly} images={images} cursors={cursors} onPointer={onPointer} addImage={addImage} notify={setNotice}
          imagePicker={projectId ? (place, close) => <AssetPicker projectId={projectId} onPick={async (asset) => { try { place(await placeAsset(asset)); } catch (error) { setNotice(errorText(error, "Could not add the asset")); close(); } }} /> : undefined}
          onSelection={setSelected}
          layers={(selection) => <LayersPanel canvas={canvas} selection={selection} readOnly={readOnly} />}
          inspector={(selection) => <Inspector canvas={canvas} selection={selection} readOnly={readOnly}
            exportSection={<>
              {projectId && canvasId && <PublishSection canvas={canvas} selection={selection} images={images} projectId={projectId} teamId={teamId} canvasId={canvasId} readOnly={readOnly} />}
              <ExportSection canvas={canvas} selection={selection} images={images} name={name} projectId={readOnly ? undefined : projectId} />
            </>} />} />
      </div>
    </div>
  );
}

function CanvasPresence({ here, userId }: { here: readonly Presence[]; userId: string }) {
  if (!here.length) return null;
  const ordered = [...here].sort((a, b) => (a.userId === userId ? -1 : b.userId === userId ? 1 : b.updatedAt - a.updatedAt));
  const names = ordered.map((member) => (member.userId === userId ? "You" : member.name));
  const label = `${names.join(", ")} ${names.length === 1 && ordered[0]!.userId !== userId ? "is" : "are"} on this canvas`;
  return (
    <div role="img" aria-label={label} title={label} className="flex items-center gap-2">
      <span className="flex items-center">
        {ordered.slice(0, 5).map((member, index) => (
          <span key={member.userId} style={{ zIndex: 5 - index }} className={cn("relative rounded-[8px] ring-2 ring-app origin-pop-badge", index > 0 && "-ml-1.5")}>
            <MemberAvatar person={{ name: member.name }} size={24} />
          </span>
        ))}
      </span>
      <span className="hidden text-[12px] text-ink-secondary sm:inline">{here.length} here</span>
    </div>
  );
}

function AssetPicker({ projectId, onPick }: { projectId: string; onPick(asset: CloudDesignAsset & { storageId?: string }): Promise<void> }) {
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const [busy, setBusy] = useState<string | null>(null);
  const images = (design?.assets ?? []).filter((asset) => asset.fileUrl && IMAGE_TYPES.includes(asset.contentType ?? "")) as (CloudDesignAsset & { storageId?: string })[];
  if (design === undefined) return <p className="px-2.5 py-1 text-[12px] text-ink-tertiary">Loading assets…</p>;
  if (!images.length) return <p className="px-2.5 py-1 text-[12px] text-ink-tertiary">No image assets in this project yet</p>;
  return (
    <div>
      <p className="px-2.5 pb-1 text-[11.5px] font-medium text-ink-tertiary">From project assets</p>
      <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto p-1">
        {images.map((asset) => (
          <button key={asset._id} type="button" title={asset.name} aria-label={`Insert ${asset.name}`} disabled={busy !== null}
            onClick={() => { setBusy(asset._id); void onPick(asset).finally(() => setBusy(null)); }}
            className="relative aspect-square overflow-hidden rounded-lg border border-hairline/50 bg-inset outline-none transition-[border-color,transform] duration-150 hover:border-accent/70 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60">
            <img src={asset.fileUrl!} alt="" className="size-full object-cover" loading="lazy" />
            {busy === asset._id && <span className="absolute inset-0 flex items-center justify-center bg-app/60"><Loader2 size={16} className="animate-spin" /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExportSection({ canvas, selection, images, name, projectId }: { canvas: CanvasScene; selection: SelectionApi; images: ReadonlyMap<string, string>; name: string; projectId?: string }) {
  const [busy, setBusy] = useState<"png" | "svg" | "asset" | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const title = selection.nodes.length === 1 ? selection.nodes[0].name : selection.nodes.length ? `${name} selection` : name;
  const run = async (kind: "png" | "svg" | "asset") => {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await exportSvg(canvas.scene, canvas.index, selection.ids, images);
      if (!result) throw new Error("Nothing to export");
      if (kind === "svg") { download(new Blob([result.svg], { type: "image/svg+xml" }), `${fileSafe(title)}.svg`); return; }
      const png = await svgToPng(result, 2);
      if (kind === "png") { download(png, `${fileSafe(title)}.png`); return; }
      const uploadUrl = await cloudMutation<string>("design:generateUploadUrl", { projectId });
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = await response.json() as { storageId: string };
      await cloudMutation("design:createAsset", { projectId, storageId, type: "image", name: `${fileSafe(title)}.png`.slice(0, 150), contentType: "image/png", size: png.size });
      setMessage({ tone: "info", text: `Saved ${fileSafe(title)}.png to Assets` });
    } catch (error) {
      setMessage({ tone: "danger", text: errorText(error, "Could not export") });
    } finally {
      setBusy(null);
    }
  };
  const button = "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-inset px-2 text-[12px] text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50";
  return (
    <section className="px-3 py-2.5">
      <h3 className="mb-1.5 flex h-6 items-center text-[11.5px] font-medium text-ink-secondary">Export {selection.nodes.length ? (selection.nodes.length === 1 ? "layer" : "selection") : "canvas"}</h3>
      <div className="flex gap-1">
        <button type="button" className={button} disabled={busy !== null} onClick={() => void run("png")}>{busy === "png" ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}PNG</button>
        <button type="button" className={button} disabled={busy !== null} onClick={() => void run("svg")}>{busy === "svg" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}SVG</button>
      </div>
      {projectId && (
        <button type="button" className={cn(button, "mt-1 w-full")} disabled={busy !== null} onClick={() => void run("asset")}>
          {busy === "asset" ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />}Save to Assets
        </button>
      )}
      {message && <p role={message.tone === "danger" ? "alert" : "status"} className={cn("mt-1.5 text-[11.5px]", message.tone === "danger" ? "text-danger" : "text-ink-secondary")}>{message.text}</p>}
    </section>
  );
}

const JSON_MAX = 8_000;

function AskAgent({ agent, canvas, selected, images, name, canvasId }: { agent: Bot; canvas: CanvasScene; selected: readonly string[]; images: ReadonlyMap<string, string>; name: string; canvasId?: string }) {
  const nodes = topmost(canvas.scene, selected);
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const exporting = useRef(false);
  const generation = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { generation.current++; exporting.current = false; setBusy(false); setOpen(false); };
  const dismiss = () => { close(); trigger.current?.focus(); };
  usePopoverDismiss(open, root, close);
  useEffect(() => () => { generation.current++; }, []);
  const scope = nodes.length ? (nodes.length === 1 ? `"${nodes[0].name}"` : `${nodes.length} selected layers`) : "the whole canvas";
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (exporting.current) return;
    exporting.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const roots: CanvasNode[] = nodes;
      const snapshot = await exportSvg(canvas.scene, canvas.index, roots.map((node) => node.id), images);
      if (request !== generation.current) return;
      const image = snapshot ? await imageAttachmentFromFile(new File([await svgToPng(snapshot, 1.5)], `${fileSafe(name)}.png`, { type: "image/png" })) : null;
      if (request !== generation.current) return;
      if (snapshot && !image) throw new Error("Could not attach the snapshot");
      const json = JSON.stringify(roots.length ? roots.flatMap((node) => compactScene(canvas.scene, { root: node.id, max: 200 }).nodes) : compactScene(canvas.scene, { max: 200 }).nodes);
      const layers = json.length > 2 ? `\nLayers (x, y relative to their parent):\n\`\`\`json\n${json.length > JSON_MAX ? `${json.slice(0, JSON_MAX)}…` : json}\n\`\`\`` : "\nThe canvas is empty.";
      const asked = question.trim() || "What do you make of this design? Point out gaps and improve it.";
      const where = `This is ${scope} on the shared "${name}" canvas${canvasId ? ` (canvas ${canvasId})` : ""}. You can change it directly with origin_canvas_edit and read it with origin_canvas.`;
      dispatch({ type: "send", botId: agent.id, text: composeMessage(`${asked}\n\n${where}${layers}`, image ? [image] : []) });
      setOpen(false);
      setQuestion("");
      if (agent.chiefOfStaff) setChiefSectionOf(agent.id, "chat");
      openOriginPage(null);
      openBot(dispatch, agent, showThreads);
    } catch (cause) {
      if (request === generation.current) setError(errorText(cause, "Could not share the canvas"));
    } finally {
      if (request === generation.current) { exporting.current = false; setBusy(false); }
    }
  };
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" aria-label={`Ask ${agent.name}`} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}
        className={cn("group flex h-8 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/10 py-1 pl-1 pr-3 text-[12.5px] font-medium text-accent-text outline-none transition-[background-color,transform] duration-150 hover:bg-accent/20 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent/60", open && "bg-accent/20")}>
        <BotAvatar bot={agent} size={22} animated={false} />
        <Sparkles size={13} aria-hidden="true" className="transition-transform duration-150 group-hover:rotate-12" /><span className="truncate">Ask {agent.name}</span>
      </button>
      {open && (
        <form onSubmit={(event) => void send(event)} aria-label={`Ask ${agent.name} about this canvas`}
          onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); dismiss(); } }}
          className="absolute right-0 top-full z-40 mt-2 flex w-[min(320px,calc(100vw-24px))] origin-top-right flex-col gap-2.5 rounded-xl border border-hairline/60 bg-menu p-3 animate-pop-in">
          <div className="flex items-center gap-2">
            <BotAvatar bot={agent} size={26} />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[13px] text-ink">Ask {agent.name}</strong>
              <span className="block truncate text-[11.5px] text-ink-tertiary">About {scope}</span>
            </div>
            <button type="button" className={iconButton} aria-label="Close" onClick={dismiss}><X size={14} /></button>
          </div>
          <textarea autoFocus rows={3} className={cn(inputClass, "resize-none")} aria-label="Question" placeholder="Design a pricing section next to this…" value={question} disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          {error && <Notice tone="danger">{error}</Notice>}
          <button className={cn(primaryButton, "self-end rounded-full px-4")} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Send to {agent.name}
          </button>
        </form>
      )}
    </div>
  );
}
