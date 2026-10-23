import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { applyCanvasOps } from "../../../../shared/canvas-ops";
import { ancestors, type CanvasNode } from "../../../../shared/canvas-scene";
import { SLIDE_LAYOUTS, SLIDE_LAYOUT_NAMES, arrangeSlides, slideSpec, slidesOf, type DeckTheme, type SlideLayout } from "../../../../shared/canvas-deck";
import type { BrandKit } from "../../../../shared/brand-kit";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import type { SelectionApi } from "./CanvasEditor";
import { duplicateNodes } from "./actions";
import { measureText } from "./geometry";
import { NodeView } from "./NodeView";
import type { CanvasScene } from "./use-canvas-scene";

const THUMB_WIDTH = 176;
const PLACEHOLDER = "\u0000new-slide";
const iconButton = "inline-flex size-6 items-center justify-center rounded-md text-ink-tertiary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-30";

/** The slide that holds the current selection, or the first slide. */
function currentSlide(slides: readonly CanvasNode[], selection: SelectionApi, scene: CanvasScene["scene"]): CanvasNode | undefined {
  const first = selection.nodes[0];
  const root = first ? [...ancestors(scene, first), first][0] : undefined;
  return slides.find((slide) => slide.id === root?.id) ?? slides[0];
}

/** The slide list of a presentation: thumbnails in playing order, drag to reorder, add slides from layouts, and speaker notes. */
export function DeckPanel({ canvas, selection, readOnly, images, brand }: {
  canvas: CanvasScene; selection: SelectionApi; readOnly: boolean; images: ReadonlyMap<string, string>; brand: BrandKit | null | undefined;
}) {
  const { scene, index } = canvas;
  const slides = useMemo(() => slidesOf(scene), [scene]);
  const current = currentSlide(slides, selection, scene);
  const theme: DeckTheme = brand ? { heading: brand.fonts.heading, body: brand.fonts.body } : {};
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const options = useMemo(() => ({ index, images, interactive: false, prefix: "s-" }), [index, images]);

  const apply = (ops: readonly unknown[]) => {
    const result = applyCanvasOps(scene, ops, { measure: measureText, kit: brand ?? null });
    if (result.changed.length) canvas.commit(result.changed);
    return result;
  };
  const show = (id: string) => { selection.select([id]); selection.zoomTo([id]); };
  const reorder = (ids: string[]) => apply(arrangeSlides(scene, ids));

  const add = (layout: SlideLayout) => {
    const at = current ? slides.indexOf(current) + 1 : slides.length;
    const order = slides.map((slide) => slide.id);
    order.splice(at, 0, PLACEHOLDER);
    const result = apply([{ op: "create", node: slideSpec({ layout }, at, theme, "slide") }, ...arrangeSlides(scene, order)]);
    const made = result.created.find((item) => item.key === "slide");
    if (made) window.setTimeout(() => show(made.id), 0);
  };
  const duplicate = (slide: CanvasNode) => {
    const at = slides.indexOf(slide) + 1;
    const copy = duplicateNodes(scene, index, [slide.id], 0);
    const root = copy.roots[0]!;
    const after = new Map(scene);
    for (const node of copy.nodes) after.set(node.id, node);
    const order = slides.map((item) => item.id);
    order.splice(at, 0, root);
    const moved = applyCanvasOps(after, arrangeSlides(after, order), { measure: measureText }).changed;
    canvas.commit([...copy.nodes.filter((node) => !moved.some((item) => item.id === node.id)), ...moved]);
    window.setTimeout(() => show(root), 0);
  };
  const remove = (slide: CanvasNode) => {
    const rest = slides.filter((item) => item.id !== slide.id).map((item) => item.id);
    apply([{ op: "delete", id: slide.id }, ...arrangeSlides(scene, rest)]);
  };
  const move = (slide: CanvasNode, step: -1 | 1) => {
    const ids = slides.map((item) => item.id);
    const at = ids.indexOf(slide.id);
    const to = at + step;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    reorder(ids);
  };
  const drop = (event: DragEvent, at: number) => {
    event.preventDefault();
    setOver(null);
    if (!dragging) return;
    const ids = slides.map((item) => item.id).filter((id) => id !== dragging);
    const from = slides.findIndex((item) => item.id === dragging);
    ids.splice(at > from ? at - 1 : at, 0, dragging);
    setDragging(null);
    reorder(ids);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-deck-panel>
      <ol aria-label="Slides" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {slides.map((slide, at) => {
          const selected = slide.id === current?.id;
          const scale = THUMB_WIDTH / Math.max(1, slide.width);
          return (
            <li key={slide.id} data-slide={slide.id} draggable={!readOnly}
              onDragStart={(event) => { setDragging(slide.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", slide.id); }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              onDragOver={(event) => { if (!dragging) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setOver(event.clientY < box.top + box.height / 2 ? at : at + 1); }}
              onDrop={(event) => drop(event, over ?? at)}
              className={cn("group relative rounded-lg p-1.5 transition-colors", selected ? "bg-raised" : "hover:bg-raised/50", dragging === slide.id && "opacity-40")}>
              {over === at && <span aria-hidden="true" className="absolute inset-x-2 -top-0.5 h-0.5 rounded-full bg-accent" />}
              {over === at + 1 && at === slides.length - 1 && <span aria-hidden="true" className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-accent" />}
              <button type="button" onClick={() => show(slide.id)} aria-label={`Slide ${at + 1}: ${slide.name}`} aria-current={selected ? "true" : undefined}
                className="flex w-full items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-md">
                <span className="w-4 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-ink-tertiary">{at + 1}</span>
                <svg width={THUMB_WIDTH} height={slide.height * scale} viewBox={`0 0 ${slide.width} ${slide.height}`} role="presentation"
                  className={cn("shrink-0 overflow-hidden rounded-[5px] ring-1", selected ? "ring-accent" : "ring-hairline/60")}>
                  <NodeView node={{ ...slide, x: 0, y: 0 }} options={options} />
                </svg>
              </button>
              {!readOnly && (
                <div className="absolute right-2.5 top-2.5 hidden items-center gap-0.5 rounded-md bg-menu/95 p-0.5 group-hover:flex group-focus-within:flex">
                  <button type="button" className={iconButton} aria-label="Move slide up" title="Move up" disabled={at === 0} onClick={() => move(slide, -1)}><ArrowUp size={12} /></button>
                  <button type="button" className={iconButton} aria-label="Move slide down" title="Move down" disabled={at === slides.length - 1} onClick={() => move(slide, 1)}><ArrowDown size={12} /></button>
                  <button type="button" className={iconButton} aria-label="Duplicate slide" title="Duplicate" onClick={() => duplicate(slide)}><Copy size={12} /></button>
                  <button type="button" className={iconButton} aria-label="Delete slide" title="Delete" onClick={() => remove(slide)}><Trash2 size={12} /></button>
                </div>
              )}
            </li>
          );
        })}
        {!slides.length && <li className="px-2 py-6 text-center text-[12px] text-ink-tertiary">{readOnly ? "No slides yet" : "Add the first slide"}</li>}
      </ol>
      {!readOnly && <AddSlide onAdd={add} />}
      {current && <SpeakerNotes key={current.id} slide={current} readOnly={readOnly} onSave={(notes) => apply([{ op: "update", id: current.id, set: { notes } }])} />}
    </div>
  );
}

function AddSlide({ onAdd }: { onAdd(layout: SlideLayout): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, root, () => setOpen(false));
  return (
    <div ref={root} className="relative shrink-0 px-2 pb-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} data-add-slide
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-hairline/70 text-[12.5px] text-ink-secondary outline-none transition-colors hover:border-hairline hover:bg-raised/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
        <Plus size={14} />Add slide
      </button>
      {open && (
        <div role="menu" aria-label="Slide layouts" className="absolute bottom-full left-2 right-2 z-40 mb-1.5 grid grid-cols-2 gap-1 rounded-xl border border-hairline/60 bg-menu p-1.5 animate-pop-in">
          {SLIDE_LAYOUTS.map((layout) => (
            <button key={layout} type="button" role="menuitem" onClick={() => { setOpen(false); onAdd(layout); }}
              className="flex h-8 items-center rounded-md px-2 text-left text-[12px] text-ink outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/60">
              {SLIDE_LAYOUT_NAMES[layout]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SpeakerNotes({ slide, readOnly, onSave }: { slide: CanvasNode; readOnly: boolean; onSave(notes: string): void }) {
  const [draft, setDraft] = useState(slide.notes ?? "");
  useEffect(() => { setDraft(slide.notes ?? ""); }, [slide.notes]);
  const save = () => { if (draft.trim() !== (slide.notes ?? "").trim()) onSave(draft.trim()); };
  return (
    <label className="block shrink-0 border-t border-hairline/40 px-3 pb-3 pt-2">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Speaker notes</span>
      <textarea value={draft} readOnly={readOnly} rows={4} maxLength={10_000} placeholder={readOnly ? "No notes" : "What to say on this slide"} data-speaker-notes
        onChange={(event) => setDraft(event.target.value)} onBlur={save}
        className="w-full resize-none rounded-md border border-hairline/50 bg-inset px-2 py-1.5 text-[12.5px] leading-snug text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/60" />
    </label>
  );
}
