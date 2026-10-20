import { useMemo, useState } from "react";
import { Component, LayoutTemplate, Search } from "lucide-react";
import { applyCanvasOps } from "../../../../shared/canvas-ops";
import { componentSets, instantiate, masterTree } from "../../../../shared/canvas-components";
import { childrenIndex, decodeScene, nextZ, worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { TEXT_STYLES, colorStyles, textStylePatch } from "../../../../shared/canvas-styles";
import type { BrandKit } from "../../../../shared/brand-kit";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../../Select";
import type { SelectionApi } from "./CanvasEditor";
import { NodeView } from "./NodeView";
import { measureText } from "./geometry";
import type { CanvasScene } from "./use-canvas-scene";

type Canvas = { _id: string; name: string };

function Thumbnail({ scene, node, images }: { scene: Scene; node: CanvasNode; images: ReadonlyMap<string, string> }) {
  const index = useMemo(() => childrenIndex(scene), [scene]);
  const pad = Math.max(node.width, node.height) * 0.08;
  return (
    <svg aria-hidden="true" className="size-full" viewBox={`${-pad} ${-pad} ${Math.max(1, node.width) + pad * 2} ${Math.max(1, node.height) + pad * 2}`} preserveAspectRatio="xMidYMid meet">
      <NodeView node={{ ...node, x: 0, y: 0, rotation: 0 }} options={{ index, images, interactive: false, prefix: `t-${node.id}-` }} />
    </svg>
  );
}

function ComponentGrid({ scene, sets, images, onInsert, disabled }: { scene: Scene; sets: ReturnType<typeof componentSets>; images: ReadonlyMap<string, string>; onInsert(node: CanvasNode): void; disabled: boolean }) {
  if (!sets.length) return <p className="px-1.5 py-1 text-[12px] text-ink-tertiary">No components yet. Select a frame and press Ctrl+Alt+K.</p>;
  return (
    <div className="flex flex-col gap-2">
      {sets.map((set) => (
        <div key={set.set}>
          {set.components.length > 1 && <p className="px-1.5 pb-1 text-[11.5px] text-ink-tertiary">{set.set}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            {set.components.map((node) => (
              <button key={node.id} type="button" disabled={disabled} onClick={() => onInsert(node)} title={node.component?.description || `Insert ${node.name}`} aria-label={`Insert ${node.name}`}
                className="flex flex-col gap-1 rounded-lg border border-hairline/50 bg-inset p-1.5 text-left outline-none transition-[border-color,transform] duration-(--motion-fast) hover:border-accent/60 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 motion-reduce:active:scale-100">
                <span className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-app/40"><Thumbnail scene={scene} node={node} images={images} /></span>
                <span className="truncate text-[11.5px] text-ink-secondary">{Object.values(node.component?.props ?? {}).join(" · ") || node.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Components of this canvas and of the project's other canvases, plus the brand kit's colour and text styles, ready to apply. */
export function AssetsPanel({ canvas, selection, readOnly, images, brand, teamId, canvasId, projectId }: {
  canvas: CanvasScene; selection: SelectionApi; readOnly: boolean; images: ReadonlyMap<string, string>; brand: BrandKit | null | undefined;
  teamId: string; canvasId?: string; projectId?: string;
}) {
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState("");
  const canvases = useCloudQuery<Canvas[]>("draw:canvases", projectId ? { projectId } : "skip");
  const others = (canvases ?? []).filter((item) => item._id !== canvasId);
  const remoteRows = useCloudQuery<string[]>("draw:scene", library ? { teamId, canvasId: library } : "skip");
  const remote = useMemo(() => new Map(decodeScene(remoteRows ?? []).map((node) => [node.id, node])), [remoteRows]);
  const match = (sets: ReturnType<typeof componentSets>) => sets.map((set) => ({ ...set, components: set.components.filter((node) => `${set.set} ${node.name}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((set) => set.components.length);
  const local = useMemo(() => componentSets(canvas.scene), [canvas.scene]);
  const libraryComponents = useMemo(() => componentSets(remote), [remote]);

  const insert = (source: Scene, master: CanvasNode, from?: string) => {
    const tree = masterTree(source, childrenIndex(source), master.id);
    const only = selection.nodes.length === 1 ? selection.nodes[0]! : null;
    const parent = only?.type === "frame" && only.id !== master.id ? only.id : null;
    const centre = selection.centre();
    const origin = parent ? worldOrigin(canvas.scene, canvas.scene.get(parent)!) : { x: 0, y: 0 };
    const at = { x: Math.round(centre.x - master.width / 2 - origin.x), y: Math.round(centre.y - master.height / 2 - origin.y), z: nextZ(canvas.index.get(parent) ?? []) };
    const nodes = instantiate(tree, parent, at, from);
    canvas.commit(nodes);
    selection.select([nodes[0]!.id]);
  };

  const buildSystem = () => {
    const result = applyCanvasOps(canvas.scene, [{ op: "design_system" }], { kit: brand ?? null, measure: measureText });
    const root = result.created[0];
    if (!root) return;
    canvas.commit(result.changed);
    selection.select([root.id]);
    selection.zoomTo([root.id]);
  };

  const editable = selection.nodes.filter((node) => !node.locked);
  const texts = editable.filter((node) => node.type === "text");
  const paint = (id: string, color: string) => canvas.commit(editable.map((node) => (node.type === "line" || node.type === "arrow" ? { ...node, stroke: color, strokeStyle: id } : { ...node, fill: color, fillStyle: id })));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="mx-2 mb-2 flex h-8 items-center gap-1.5 rounded-md bg-inset px-2 text-ink-tertiary focus-within:ring-2 focus-within:ring-accent/50">
        <Search size={13} /><input aria-label="Search assets" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary" />
      </label>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
        <section aria-label="Components">
          <h3 className="flex h-7 items-center gap-1.5 px-1.5 text-[11.5px] font-semibold text-ink"><Component size={12} /><span className="flex-1">Components</span>
            {!readOnly && (
              <button type="button" onClick={buildSystem} title={`Build colour and text styles, Button, Input, Card and Nav from ${brand ? "the brand kit" : "the default styles"}`}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
                <LayoutTemplate size={12} />Design system
              </button>
            )}
          </h3>
          <ComponentGrid scene={canvas.scene} sets={match(local)} images={images} disabled={readOnly} onInsert={(node) => insert(canvas.scene, node)} />
        </section>
        {others.length > 0 && (
          <section aria-label="Project library">
            <h3 className="flex h-7 items-center px-1.5 text-[11.5px] font-semibold text-ink">Project library</h3>
            <Select size="sm" aria-label="Library canvas" value={library} onChange={(event) => setLibrary(event.target.value)}>
              <option value="">Choose a canvas</option>
              {others.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
            </Select>
            {library && (remoteRows === undefined
              ? <p className="px-1.5 py-1 text-[12px] text-ink-tertiary">Loading components…</p>
              : <div className="mt-1.5"><ComponentGrid scene={remote} sets={match(libraryComponents)} images={images} disabled={readOnly} onInsert={(node) => insert(remote, node, library)} /></div>)}
          </section>
        )}
        <section aria-label="Colour styles">
          <h3 className="flex h-7 items-center px-1.5 text-[11.5px] font-semibold text-ink">Colour styles{brand ? "" : " · default"}</h3>
          <div className="flex flex-col">
            {colorStyles(brand).map((style) => (
              <button key={style.id} type="button" disabled={readOnly || !editable.length} onClick={() => paint(style.id, style.color)} title={editable.length ? `Apply ${style.name}` : "Select layers to apply"}
                className="flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-[12px] text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:hover:bg-transparent disabled:hover:text-ink-secondary">
                <span className="size-4 shrink-0 rounded border border-hairline/60" style={{ background: style.color }} />
                <span className="min-w-0 flex-1 truncate">{style.name}</span>
                <span className="text-[11px] tabular-nums text-ink-tertiary">{style.color}</span>
              </button>
            ))}
          </div>
        </section>
        <section aria-label="Text styles">
          <h3 className="flex h-7 items-center px-1.5 text-[11.5px] font-semibold text-ink">Text styles</h3>
          <div className="flex flex-col">
            {TEXT_STYLES.map((style) => (
              <button key={style.id} type="button" disabled={readOnly || !texts.length} onClick={() => canvas.commit(texts.map((node) => ({ ...node, ...textStylePatch(style, brand), unmeasured: true })))}
                title={texts.length ? `Apply ${style.name}` : "Select text to apply"}
                className={cn("flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-[12px] text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:hover:bg-transparent disabled:hover:text-ink-secondary",
                  texts.length > 0 && texts.every((node) => node.textStyle === style.id) && "bg-raised text-ink")}>
                <span className="min-w-0 flex-1 truncate">{style.name}</span>
                <span className="text-[11px] tabular-nums text-ink-tertiary">{style.fontSize}/{style.fontWeight}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
