import { useEffect, useRef } from "react";
import { fontStack, layoutText, type CanvasNode } from "../../../../shared/canvas-scene";
import { measureText, type Point } from "./geometry";

export const contrastInk = (fill: string | null | undefined, fallback: string) => {
  if (!fill || fill.length < 7) return fallback;
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(fill.slice(at, at + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#111111" : "#F5F5F5";
};

export function themeInk(element: Element | null): string {
  const match = element ? /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(element).color) : null;
  if (!match) return "#F5F5F5";
  return `#${match.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function TextEditor({ node, origin, zoom, onChange, onDone }: { node: CanvasNode; origin: Point; zoom: number; onChange(text: string): void; onDone(): void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); area.current?.select(); }, []);
  const layout = layoutText(node, measureText);
  const size = (node.fontSize ?? 16) * zoom;
  return (
    <textarea ref={area} aria-label="Text" value={node.text ?? ""} spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onDone}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) { event.preventDefault(); onDone(); }
      }}
      className="absolute z-10 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-1 outline-accent"
      style={{
        left: origin.x, top: origin.y, width: Math.max(layout.width, node.fontSize ?? 16) * zoom + (node.autoWidth ? size : 0), height: Math.max(layout.height, layout.lineHeight) * zoom,
        font: `${node.fontWeight ?? 400} ${size}px/${layout.lineHeight * zoom}px ${fontStack(node)}`, color: node.fill ?? "inherit",
        textAlign: node.align ?? "left", whiteSpace: node.autoWidth ? "pre" : "pre-wrap", transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
        transformOrigin: `${(node.width * zoom) / 2}px ${(node.height * zoom) / 2}px`, caretColor: "var(--color-accent)",
      }} />
  );
}
