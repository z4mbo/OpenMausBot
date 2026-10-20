import { useState } from "react";
import { Download, FileText, FolderInput, Image as ImageIcon, Loader2 } from "lucide-react";
import { cloudMutation } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { errorText } from "../repo-url";
import type { SelectionApi } from "./CanvasEditor";
import { download, exportPdf, exportSvg, fileSafe, svgToPng } from "./export";
import type { CanvasScene } from "./use-canvas-scene";

type Kind = "png" | "svg" | "pdf" | "asset";

export function ExportSection({ canvas, selection, images, name, projectId }: { canvas: CanvasScene; selection: SelectionApi; images: ReadonlyMap<string, string>; name: string; projectId?: string }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const title = selection.nodes.length === 1 ? selection.nodes[0]!.name : selection.nodes.length ? `${name} selection` : name;
  const run = async (kind: Kind) => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "pdf") {
        const pdf = await exportPdf(canvas.scene, canvas.index, selection.ids.length ? selection.ids : (canvas.index.get(null) ?? []).filter((node) => node.type === "frame" && !node.hidden).map((node) => node.id), images);
        if (!pdf) throw new Error("Nothing to export");
        download(pdf, `${fileSafe(title)}.pdf`);
        return;
      }
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
  const icon = (kind: Kind, idle: React.ReactNode) => (busy === kind ? <Loader2 size={13} className="animate-spin" /> : idle);
  return (
    <section className="px-3 py-2.5">
      <h3 className="mb-1.5 flex h-6 items-center text-[11.5px] font-medium text-ink-secondary">Export {selection.nodes.length ? (selection.nodes.length === 1 ? "layer" : "selection") : "page"}</h3>
      <div className="flex gap-1">
        <button type="button" className={button} disabled={busy !== null} onClick={() => void run("png")}>{icon("png", <ImageIcon size={13} />)}PNG</button>
        <button type="button" className={button} disabled={busy !== null} onClick={() => void run("svg")}>{icon("svg", <Download size={13} />)}SVG</button>
        <button type="button" className={button} disabled={busy !== null} onClick={() => void run("pdf")}>{icon("pdf", <FileText size={13} />)}PDF</button>
      </div>
      {projectId && (
        <button type="button" className={cn(button, "mt-1 w-full")} disabled={busy !== null} onClick={() => void run("asset")}>
          {icon("asset", <FolderInput size={13} />)}Save to Assets
        </button>
      )}
      {message && <p role={message.tone === "danger" ? "alert" : "status"} className={cn("mt-1.5 text-[11.5px]", message.tone === "danger" ? "text-danger" : "text-ink-secondary")}>{message.text}</p>}
    </section>
  );
}
