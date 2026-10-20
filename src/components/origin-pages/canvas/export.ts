import { createElement } from "react";
import { descendants, effectiveParent, worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { topmost } from "./actions";
import { unionBox, worldBounds } from "./geometry";
import { NodeView } from "./NodeView";

type Index = ReadonlyMap<string | null, readonly CanvasNode[]>;

const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
  reader.readAsDataURL(blob);
});

async function inlineImages(nodes: readonly CanvasNode[], images: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(nodes.map(async (node) => {
    if (node.type !== "image" || !node.fileId || out.has(node.fileId)) return;
    const url = images.get(node.fileId);
    if (!url) return;
    if (url.startsWith("data:")) { out.set(node.fileId, url); return; }
    try {
      const response = await fetch(url);
      if (response.ok) out.set(node.fileId, await readDataUrl(await response.blob()));
    } catch {
      return;
    }
  }));
  return out;
}

export type ExportResult = { svg: string; width: number; height: number };

export async function exportSvg(scene: Scene, index: Index, ids: readonly string[], images: ReadonlyMap<string, string>): Promise<ExportResult | null> {
  const roots = ids.length ? topmost(scene, ids) : [...(index.get(null) ?? [])];
  const visible = roots.filter((node) => !node.hidden);
  const bounds = unionBox(visible.map((node) => worldBounds(scene, node)));
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null;
  const all = visible.flatMap((node) => [node, ...descendants(scene, node.id, index as Map<string | null, CanvasNode[]>)]);
  const inlined = await inlineImages(all, images);
  const { renderToStaticMarkup } = await import("react-dom/server");
  const options = { index, images: inlined, interactive: false, prefix: "e-" };
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  const body = visible.map((node) => {
    const parent = effectiveParent(scene, node);
    const origin = parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 };
    return createElement("g", { key: node.id, transform: `translate(${origin.x - bounds.x} ${origin.y - bounds.y})` }, createElement(NodeView, { node, options }));
  });
  const markup = renderToStaticMarkup(createElement("svg", { xmlns: "http://www.w3.org/2000/svg", width, height, viewBox: `0 0 ${width} ${height}` }, body));
  return { svg: markup.replace("<svg ", "<svg xmlns:xlink=\"http://www.w3.org/1999/xlink\" "), width, height };
}

export async function svgToPng(result: ExportResult, scale: number): Promise<Blob> {
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
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not draw the export"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
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
