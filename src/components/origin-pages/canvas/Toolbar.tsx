import { useRef, type ReactNode } from "react";
import { Circle, Frame, Hand, ImagePlus, Layers, Minus, MousePointer2, MoveUpRight, Redo2, SlidersHorizontal, Square, Type, Undo2, Upload } from "lucide-react";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";

export type Tool = "move" | "hand" | "frame" | "rect" | "ellipse" | "line" | "arrow" | "text";

const TOOLS: { tool: Tool; label: string; key: string; icon: ReactNode; edits: boolean; wideOnly?: boolean }[] = [
  { tool: "move", label: "Move", key: "V", icon: <MousePointer2 size={16} />, edits: false },
  { tool: "hand", label: "Hand", key: "H", icon: <Hand size={16} />, edits: false, wideOnly: true },
  { tool: "frame", label: "Frame", key: "F", icon: <Frame size={16} />, edits: true },
  { tool: "rect", label: "Rectangle", key: "R", icon: <Square size={16} />, edits: true },
  { tool: "ellipse", label: "Ellipse", key: "O", icon: <Circle size={16} />, edits: true },
  { tool: "line", label: "Line", key: "L", icon: <Minus size={16} className="-rotate-45" />, edits: true, wideOnly: true },
  { tool: "arrow", label: "Arrow", key: "Shift+L", icon: <MoveUpRight size={16} />, edits: true },
  { tool: "text", label: "Text", key: "T", icon: <Type size={16} />, edits: true },
];

const button = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary outline-none transition-[background-color,color,transform] duration-150 hover:bg-raised hover:text-ink active:scale-95 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none";
const surface = "rounded-xl border border-hairline/60 bg-menu";

export function CanvasToolbar({ tool, readOnly, narrow, onTool, canUndo, canRedo, onUndo, onRedo, imageMenu, onImageMenu, imagePicker, onUpload, panels, onPanels }: {
  tool: Tool; readOnly: boolean; narrow: boolean; onTool(tool: Tool): void;
  canUndo: boolean; canRedo: boolean; onUndo(): void; onRedo(): void;
  imageMenu: boolean; onImageMenu(open: boolean): void;
  imagePicker?: (close: () => void) => ReactNode;
  onUpload(files: File[]): void;
  panels: { layers: boolean; inspector: boolean }; onPanels(panels: { layers: boolean; inspector: boolean }): void;
}) {
  const tight = cn(button, narrow && "size-7");
  const file = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  usePopoverDismiss(imageMenu, menu, () => onImageMenu(false));
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-3 z-30 flex justify-center">
      <div role="toolbar" aria-label="Canvas tools" className={cn(surface, "pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]")}>
        <button type="button" className={cn(tight, panels.layers && "bg-raised text-ink")} aria-label="Layers" aria-pressed={panels.layers} title="Layers" onClick={() => onPanels({ ...panels, layers: !panels.layers })}><Layers size={16} /></button>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-hairline/60" />
        {TOOLS.filter((item) => (!readOnly || !item.edits) && !(narrow && item.wideOnly && tool !== item.tool)).map((item) => (
          <button key={item.tool} type="button" aria-label={item.label} aria-pressed={tool === item.tool} title={`${item.label} (${item.key})`} onClick={() => onTool(item.tool)}
            className={cn(tight, tool === item.tool && "bg-accent text-accent-ink hover:bg-accent hover:text-accent-ink")}>
            {item.icon}
          </button>
        ))}
        {!readOnly && (
          <div ref={menu} className="relative">
            <button type="button" className={cn(tight, imageMenu && "bg-raised text-ink")} aria-label="Image" aria-expanded={imageMenu} title="Image (I)" onClick={() => onImageMenu(!imageMenu)}><ImagePlus size={16} /></button>
            {imageMenu && (
              <div className={cn(surface, "fixed bottom-16 left-1/2 z-30 flex w-[min(320px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2 p-2 animate-pop-in")}>
                <button type="button" onClick={() => file.current?.click()}
                  className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60">
                  <Upload size={15} className="text-ink-secondary" />Upload from this device
                </button>
                {imagePicker?.(() => onImageMenu(false))}
              </div>
            )}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple hidden
              onChange={(event) => { onUpload([...(event.target.files ?? [])]); event.target.value = ""; onImageMenu(false); }} />
          </div>
        )}
        {!readOnly && (
          <>
            <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-hairline/60" />
            <button type="button" className={tight} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button>
            <button type="button" className={tight} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>
          </>
        )}
        <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-hairline/60" />
        <button type="button" className={cn(tight, panels.inspector && "bg-raised text-ink")} aria-label="Design panel" aria-pressed={panels.inspector} title="Design panel" onClick={() => onPanels({ ...panels, inspector: !panels.inspector })}><SlidersHorizontal size={16} /></button>
      </div>
    </div>
  );
}

export function ZoomControls({ zoom, onZoom, onFit, onSelection, onActual }: { zoom: number; onZoom(factor: number): void; onFit(): void; onSelection?: () => void; onActual(): void }) {
  return (
    <div className={cn(surface, "absolute right-3 top-3 z-10 flex items-center gap-0.5 p-0.5")}>
      <button type="button" className={cn(button, "size-7")} aria-label="Zoom out" title="Zoom out (Ctrl+-)" onClick={() => onZoom(0.8)}><Minus size={14} /></button>
      <button type="button" className="h-7 min-w-12 rounded-lg px-1.5 text-[12px] tabular-nums text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
        aria-label="Zoom to 100%" title="Zoom to 100% (Shift+0)" onClick={onActual}>{Math.round(zoom * 100)}%</button>
      <button type="button" className={cn(button, "size-7")} aria-label="Zoom in" title="Zoom in (Ctrl+=)" onClick={() => onZoom(1.25)}><span className="text-[15px] leading-none">+</span></button>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-hairline/60" />
      <button type="button" className="h-7 rounded-lg px-2 text-[12px] text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60" title="Zoom to fit (Shift+1)" onClick={onFit}>Fit</button>
      {onSelection && <button type="button" className="h-7 rounded-lg px-2 text-[12px] text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60" title="Zoom to selection (Shift+2)" onClick={onSelection}>Selection</button>}
    </div>
  );
}
