import { sceneSvg } from "../../../../shared/canvas-svg";
import type { CanvasNode, Scene } from "../../../../shared/canvas-scene";
import { measureText } from "./geometry";
import { pdfDocument, type PdfPage } from "./pdf";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
  reader.readAsDataURL(blob);
});

async function inlineImages(scene: Scene, images: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = new Set<string>();
  for (const node of scene.values()) if (node.type === "image" && node.fileId && !node.deleted) wanted.add(node.fileId);
  await Promise.all([...wanted].map(async (fileId) => {
    const url = images.get(fileId);
    if (!url) return;
    if (url.startsWith("data:")) { out.set(fileId, url); return; }
    try {
      const response = await fetch(url);
      if (response.ok) out.set(fileId, await readDataUrl(await response.blob()));
    } catch {
      return;
    }
  }));
  return out;
}

export type ExportResult = { svg: string; width: number; height: number };

/** The selection (or the page's top-level layers) as a self-contained SVG. */
export async function exportSvg(scene: Scene, index: Index, ids: readonly string[], images: ReadonlyMap<string, string>): Promise<ExportResult | null> {
  const roots = ids.length ? undefined : [...(index.get(null) ?? [])];
  const preview = sceneSvg(scene, ids, { roots, measure: measureText });
  if (!preview) return null;
  const result = sceneSvg(scene, ids, { roots, measure: measureText, images: await inlineImages(scene, images) });
  return result && { svg: result.svg, width: result.width, height: result.height };
}

async function rasterize(result: ExportResult, scale: number, type: "image/png" | "image/jpeg"): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not draw the export"));
      image.src = url;
    });
    const limit = 8192;
    const factor = Math.min(scale, limit / result.width, limit / result.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(result.width * factor));
    canvas.height = Math.max(1, Math.round(result.height * factor));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the export");
    if (type === "image/jpeg") { context.fillStyle = "#FFFFFF"; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((made) => (made ? resolve(made) : reject(new Error("Could not draw the export"))), type, 0.92));
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function svgToPng(result: ExportResult, scale: number): Promise<Blob> {
  return (await rasterize(result, scale, "image/png")).blob;
}

/** One PDF page per selected top-level frame, or one page holding the whole selection. */
export async function exportPdf(scene: Scene, index: Index, ids: readonly string[], images: ReadonlyMap<string, string>): Promise<Blob | null> {
  const frames = ids.filter((id) => scene.get(id)?.type === "frame");
  const groups = frames.length > 1 && frames.length === ids.length ? frames.map((id) => [id]) : [ids];
  const pages: PdfPage[] = [];
  for (const group of groups) {
    const result = await exportSvg(scene, index, group, images);
    if (!result) continue;
    const raster = await rasterize(result, 2, "image/jpeg");
    pages.push({ jpeg: new Uint8Array(await raster.blob.arrayBuffer()), pixels: { width: raster.width, height: raster.height }, width: result.width * 0.75, height: result.height * 0.75 });
  }
  return pages.length ? pdfDocument(pages) : null;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (name: string) => name.replace(/[^\w -]+/g, "").trim() || "canvas";
