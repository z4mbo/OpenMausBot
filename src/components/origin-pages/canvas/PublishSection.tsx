import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, ExternalLink, Globe, Loader2 } from "lucide-react";
import { pageSlug, PAGE_SLUG } from "../../../../shared/canvas-page";
import { effectiveParent, randomId, type CanvasNode } from "../../../../shared/canvas-scene";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { errorText } from "../repo-url";
import { inputClass } from "../ui";
import type { SelectionApi } from "./CanvasEditor";
import { exportSvg, type ExportResult } from "./export";
import { countLabel, useCopied, type PagesList } from "./pages-data";
import type { CanvasScene } from "./use-canvas-scene";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

async function socialImage(result: ExportResult): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not draw the preview")); image.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = OG_WIDTH;
    canvas.height = OG_HEIGHT;
    const context = canvas.getContext("2d")!;
    const scale = OG_WIDTH / result.width;
    context.drawImage(image, 0, 0, result.width, Math.min(result.height, OG_HEIGHT / scale), 0, 0, OG_WIDTH, Math.min(OG_HEIGHT, result.height * scale));
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not draw the preview"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Props = { canvas: CanvasScene; selection: SelectionApi; images: ReadonlyMap<string, string>; projectId: string; teamId: string; canvasId: string; readOnly: boolean };

export function PublishSection(props: Props) {
  const frame = props.selection.nodes.length === 1 ? props.selection.nodes[0]! : null;
  if (!frame || frame.type !== "frame" || effectiveParent(props.canvas.scene, frame)) return null;
  return <PublishFrame key={frame.id} frame={frame} {...props} />;
}

function PublishFrame({ frame, canvas, images, projectId, teamId, canvasId, readOnly }: Props & { frame: CanvasNode }) {
  const list = useCloudQuery<PagesList>("pages:list", { projectId });
  const page = list?.pages.find((item) => item.canvasId === canvasId && item.frameId === frame.id);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [copied, copy] = useCopied();
  useEffect(() => {
    setSlug(page?.slug ?? pageSlug(frame.name));
    setTitle(page?.title ?? frame.name);
    setDescription(page?.description ?? "");
  }, [page?._id, page?.updatedAt]);

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("publish");
    setMessage(null);
    try {
      let ogFileId: string | undefined;
      try {
        const exported = await exportSvg(canvas.scene, canvas.index, [frame.id], images);
        if (exported) {
          const png = await socialImage(exported);
          const upload = await cloudMutation<string>("draw:uploadUrl", { teamId, canvasId });
          const response = await fetch(upload, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
          if (response.ok) {
            const { storageId } = await response.json() as { storageId: string };
            const fileId = `og-${randomId()}`;
            await cloudMutation("draw:saveFile", { teamId, canvasId, fileId, storageId, mimeType: "image/png" });
            ogFileId = fileId;
          }
        }
      } catch {
        ogFileId = undefined;
      }
      const result = await cloudMutation<{ url: string; created: boolean; leadForms: number; captureTurnedOn: boolean }>("pages:publish", {
        projectId, canvasId, frameId: frame.id, slug, title: title.trim() || frame.name, ...(description.trim() ? { description: description.trim() } : {}), ...(ogFileId ? { ogFileId } : {}),
      });
      setMessage({ tone: "info", text: `${result.created ? "Published" : "Updated"}${result.captureTurnedOn ? "; lead capture is on in Pipeline" : ""}` });
    } catch (error) {
      setMessage({ tone: "danger", text: errorText(error, "Could not publish the page") });
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (!page) return;
    setBusy("unpublish");
    setConfirming(false);
    try {
      await cloudMutation("pages:unpublish", { projectId, pageId: page._id });
      setMessage({ tone: "info", text: "Unpublished" });
    } catch (error) {
      setMessage({ tone: "danger", text: errorText(error, "Could not unpublish the page") });
    } finally {
      setBusy(null);
    }
  };

  const small = "h-7 rounded-md text-[12px]";
  const button = "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] outline-none transition-[background-color,color,transform] duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50";
  const validSlug = PAGE_SLUG.test(slug);
  return (
    <section className="border-b border-hairline/40 px-3 py-2.5" aria-label="Publish page">
      <h3 className="mb-1.5 flex h-6 items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary"><Globe size={12} aria-hidden="true" />{page ? "Published page" : "Publish as a page"}</h3>
      {page && (
        <div className="mb-2 flex flex-col gap-1 rounded-md bg-inset px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <a href={page.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12px] text-accent-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/60">{page.url.replace(/^https?:\/\//, "")}</a>
            <button type="button" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label={copied === page.url ? "Copied" : "Copy page address"} onClick={() => copy(page.url)}>{copied === page.url ? <Check size={12} /> : <Copy size={12} />}</button>
            <a href={page.url} target="_blank" rel="noreferrer" aria-label="Open page" className="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><ExternalLink size={12} /></a>
          </div>
          <span className="text-[11.5px] tabular-nums text-ink-tertiary">{countLabel(page.views, "view", "views")} · {countLabel(page.leads, "lead", "leads")}</span>
        </div>
      )}
      {!readOnly && (
        <form className="flex flex-col gap-1.5" onSubmit={(event) => void publish(event)}>
          <label className="flex flex-col gap-0.5 text-[11px] text-ink-tertiary">Address
            <input className={cn(inputClass, small, "px-1.5")} value={slug} maxLength={48} required aria-invalid={!validSlug} spellCheck={false}
              onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} onBlur={() => setSlug(pageSlug(slug))} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-ink-tertiary">Title
            <input className={cn(inputClass, small, "px-1.5")} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-ink-tertiary">Description
            <textarea className={cn(inputClass, "resize-none rounded-md px-1.5 py-1 text-[12px]")} rows={2} maxLength={300} value={description} placeholder="The page's first paragraph"
              onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="flex gap-1">
            <button className={cn(button, "flex-1 bg-accent font-medium text-accent-ink hover:opacity-90")} disabled={busy !== null || !validSlug}>
              {busy === "publish" && <Loader2 size={12} className="animate-spin" />}{page ? "Republish" : "Publish"}
            </button>
            {page && (confirming ? (
              <button type="button" autoFocus className={cn(button, "bg-danger/15 text-danger hover:bg-danger/25")} disabled={busy !== null} onClick={() => void unpublish()} onBlur={() => setConfirming(false)}>Take it down</button>
            ) : (
              <button type="button" className={cn(button, "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")} disabled={busy !== null} onClick={() => setConfirming(true)}>
                {busy === "unpublish" && <Loader2 size={12} className="animate-spin" />}Unpublish
              </button>
            ))}
          </div>
        </form>
      )}
      {message && <p role={message.tone === "danger" ? "alert" : "status"} className={cn("mt-1.5 text-[11.5px]", message.tone === "danger" ? "text-danger" : "text-ink-secondary")}>{message.text}</p>}
    </section>
  );
}
