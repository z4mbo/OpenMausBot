import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { newNode } from "../../../../shared/canvas-ops";
import {
  ancestors, descendants, effectiveParent, isLive, layoutText, nextZ, worldOrigin,
  type CanvasNode, type CanvasNodeType, type Scene,
} from "../../../../shared/canvas-scene";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import {
  CLIPBOARD_MARK, copySelection, deleteNodes, dropMoved, duplicateNodes, frameAt as findFrameAt, parseClipboard, pasteClipboard, reorder, toggleAutoLayout, topmost, unwrap, wrapNodes,
  type Clipboard, type Reorder,
} from "./actions";
import { angleOf, moveEndpoint, refitPoints, resizeBox, resizeMany, resizeSingle } from "./gestures";
import {
  clampZoom, contains, containsPoint, fitView, intersects, measureText, normalizedBox, snapBox, toScreen, toWorld, unionBox, worldBounds, worldBox,
  type Box, type Guide, type Point, type View,
} from "./geometry";
import { SceneLayer, changedSubtrees, type RenderOptions } from "./NodeView";
import { Overlay, type Handle, type RemoteCursor, type RemoteSelection } from "./Overlay";
import { CanvasToolbar, ZoomControls, type Tool } from "./Toolbar";
import type { CanvasScene } from "./use-canvas-scene";
import { anchorsOf, isPathNode, toggleSmooth, usePenTool, withAnchors, type Anchor } from "./pen";
import { addPointAt } from "./path-edit";
import { isCropped, panCrop } from "./image-crop";
import { booleanGroup, flatten } from "./booleans";
import { detach, makeComponent } from "../../../../shared/canvas-components";
import { Rulers, RULER, type PageGuide } from "./Rulers";
import { TextEditor, contrastInk, themeInk } from "./TextEditor";
import { svgNodes } from "./svg-import";

export type PlacedImage = { fileId: string; width: number; height: number; name: string };

export type CanvasEditorProps = {
  canvas: CanvasScene;
  readOnly: boolean;
  images: ReadonlyMap<string, string>;
  cursors: readonly RemoteCursor[];
  onPointer(point: Point, down: boolean): void;
  addImage(file: File): Promise<PlacedImage>;
  imagePicker?: (place: (image: PlacedImage) => void, close: () => void) => ReactNode;
  layers: (selection: SelectionApi) => ReactNode;
  onSelection?: (ids: readonly string[]) => void;
  inspector: (selection: SelectionApi) => ReactNode;
  notify(message: string): void;
  /** The current page's ruler guides; rulers and guides show when `onGuides` is given. */
  guides?: readonly PageGuide[];
  onGuides?(guides: PageGuide[]): void;
  remoteSelections?: readonly RemoteSelection[];
  /** A click with the comment tool, at a world point, on the node under it if any. */
  onComment?(world: Point, nodeId: string | null): void;
  /** Drawn over the stage in screen space: comment pins and the like. */
  stageLayer?: (view: View) => ReactNode;
  onPresent?(frameId: string | null): void;
  /** Overlay arrows of prototype links show while this is on. */
  showPrototype?: boolean;
  /** The page on show; switching it clears the selection and fits the new page. */
  page?: string;
  /** A node to select and zoom to once it is on the page. */
  focus?: string;
  onFocused?(): void;
  coveredRight?: number;
};

export type SelectionApi = {
  ids: readonly string[];
  nodes: CanvasNode[];
  select(ids: readonly string[]): void;
  zoomTo(ids: readonly string[]): void;
  run(command: Command): void;
  /** The world point at the centre of the visible canvas. */
  centre(): Point;
};

export type Command = "delete" | "duplicate" | "group" | "ungroup" | "frame" | "copy" | "paste" | "select-all" | "fit" | Reorder | "hide" | "lock"
  | "union" | "subtract" | "intersect" | "exclude" | "flatten" | "component" | "detach" | "present" | "edit-path";

type Gesture =
  | { kind: "pan"; start: Point; view: View }
  | { kind: "marquee"; start: Point; base: string[]; scope: string | null }
  | { kind: "move"; start: Point; originals: CanvasNode[]; box: Box; moved: boolean; click: string | null; copiedFrom: string[] }
  | { kind: "resize"; handle: Handle; originals: CanvasNode[]; box: Box; base: Scene; baseIndex: Map<string | null, CanvasNode[]> }
  | { kind: "rotate"; centre: Point; start: number; original: CanvasNode }
  | { kind: "create"; type: CanvasNodeType; start: Point; parentId: string | null; node: CanvasNode | null }
  | { kind: "endpoint"; end: 0 | 1; original: CanvasNode }
  | { kind: "pinch"; distance: number; mid: Point; view: View }
  | { kind: "pen"; start: Point }
  | { kind: "crop"; start: Point; original: CanvasNode }
  | { kind: "anchor"; at: number; part: "point" | "in" | "out"; start: Point; anchors: Anchor[]; original: CanvasNode; world: Point; mirror: boolean };

const TOOL_KEYS: Record<string, Tool> = { v: "move", h: "hand", f: "frame", a: "frame", r: "rect", o: "ellipse", e: "ellipse", l: "line", t: "text", p: "pen", c: "comment" };
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const round = (value: number) => Math.round(value);

const FAR = 1e9;
const near = (list: Guide[]) => list.filter((guide) => Math.abs(guide.from) < FAR / 2 && Math.abs(guide.to) < FAR / 2);
type Panels = { layers: boolean; inspector: boolean };
const oneOverlay = (current: Panels, next: Panels): Panels =>
  next.layers && !current.layers ? { layers: true, inspector: false } : next.inspector && !current.inspector ? { layers: false, inspector: true } : next;
const textName = (text: string | undefined) => (text ?? "").trim().replace(/\s+/g, " ").slice(0, 60) || "Text";


const INSPECTOR_WIDTH = 256;

export function CanvasEditor({ canvas, readOnly, images, cursors, onPointer, addImage, imagePicker, layers, inspector, notify, onSelection, guides: pageGuides, onGuides, remoteSelections, onComment, stageLayer, onPresent, showPrototype, page, focus, onFocused, coveredRight = 0 }: CanvasEditorProps) {
  const { scene, index } = canvas;
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>("move");
  const [selected, setSelected] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [editing, setEditing] = useState<{ id: string; created: boolean; original: CanvasNode } | null>(null);
  const [panning, setPanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panels, setPanels] = useState<Panels | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const space = useRef(false);
  const clipboard = useRef<Clipboard | null>(null);
  const fitted = useRef(false);
  const pendingCopies = useRef<CanvasNode[]>([]);
  const lastDown = useRef<{ at: number; hit: string | null }>({ at: 0, hit: null });
  const [imageMenu, setImageMenu] = useState(false);
  const [pendingZoom, setPendingZoom] = useState<string[] | null>(null);
  const [pathEdit, setPathEdit] = useState<{ id: string; at: number | null } | null>(null);
  const [rulers, setRulers] = useState(true);
  const [cropEdit, setCropEdit] = useState<string | null>(null);
  const cropNode = cropEdit ? scene.get(cropEdit) : undefined;

  const live = useMemo(() => selected.filter((id) => isLive(scene.get(id))), [selected, scene]);
  const nodes = useMemo(() => live.map((id) => scene.get(id)!), [live, scene]);
  useEffect(() => { onSelection?.(live); }, [live, onSelection]);
  const [outerWidth, setOuterWidth] = useState(0);
  const compact = outerWidth > 0 && outerWidth < 860;
  const narrow = outerWidth > 0 && outerWidth < 480;
  const shown = panels ?? { layers: !compact, inspector: !compact };

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    const outer = new ResizeObserver(([entry]) => setOuterWidth(entry.contentRect.width));
    if (root.current) outer.observe(root.current);
    return () => { observer.disconnect(); outer.disconnect(); };
  }, []);

  const contentBox = useCallback((ids?: readonly string[]) => {
    const chosen = ids?.length ? topmost(scene, ids) : [...(index.get(null) ?? [])];
    return unionBox(chosen.filter((node) => !node.hidden).map((node) => worldBounds(scene, node)));
  }, [scene, index]);

  const zoomTo = useCallback((ids?: readonly string[]) => {
    const box = contentBox(ids);
    if (!box || !size.width) { setView({ x: size.width / 2, y: size.height / 2, zoom: 1 }); return; }
    setView(fitView(box, size, compact ? 24 : 64, ids?.length ? 8 : 1));
  }, [contentBox, size, compact]);

  useEffect(() => {
    if (!pendingZoom || !pendingZoom.every((id) => isLive(scene.get(id)))) return;
    setPendingZoom(null);
    zoomTo(pendingZoom);
  }, [pendingZoom, scene, zoomTo]);

  useEffect(() => {
    if (!focus || !index.get(null)?.some((node) => node.id === focus || descendants(scene, node.id, index).some((child) => child.id === focus))) return;
    setSelected([focus]);
    setPendingZoom([focus]);
    onFocused?.();
  }, [focus, index]);

  const shownPage = useRef(page);
  useEffect(() => {
    if (shownPage.current === page) return;
    shownPage.current = page;
    fitted.current = false;
    setSelected([]);
    setPathEdit(null);
    penTool.cancel();
  }, [page]);

  useEffect(() => {
    if (fitted.current || !size.width) return;
    fitted.current = true;
    zoomTo();
  }, [size.width, zoomTo, page]);

  const zoomAt = useCallback((factor: number, anchor: Point) => {
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const world = toWorld(current, anchor);
      return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
    });
  }, []);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp((-event.deltaY * unit) / 300), anchor);
      else setView((current) => ({ ...current, x: current.x - (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit, y: current.y - (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit }));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const select = useCallback((ids: readonly string[]) => { setSelected([...ids]); }, []);

  const frameAt = useCallback((point: Point, exclude: ReadonlySet<string>) => findFrameAt(scene, index, point, exclude), [scene, index]);

  const pick = useCallback((hitId: string, deep: boolean): string | null => {
    const node = scene.get(hitId);
    if (!isLive(node)) return null;
    let chain = [...ancestors(scene, node), node];
    const locked = chain.findIndex((item) => item.locked);
    if (locked >= 0) chain = chain.slice(0, locked);
    if (!chain.length) return null;
    if (deep) return chain[chain.length - 1].id;
    for (let depth = chain.length - 1; depth > 0; depth--) {
      const level = chain[depth];
      if (live.some((id) => effectiveParent(scene, scene.get(id)!) === effectiveParent(scene, level))) return level.id;
    }
    if (live.includes(chain[0].id)) return chain[0].id;
    if (chain[0].type === "frame" && !chain[0].parentId && chain.length > 1) return chain[1].id;
    if (chain[0].type === "frame" && !chain[0].parentId && (index.get(chain[0].id)?.length ?? 0) > 0) return null;
    return chain[0].id;
  }, [scene, index, live]);

  const point = (event: { clientX: number; clientY: number }): Point => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const run = useCallback((command: Command) => {
    const ids = live;
    const commit = (changed: CanvasNode[], next?: string[]) => { if (changed.length) canvas.commit(changed); if (next) setSelected(next); };
    switch (command) {
      case "select-all": {
        const level = ids.length ? effectiveParent(scene, scene.get(ids[0])!) : null;
        setSelected((index.get(level) ?? []).filter((node) => !node.locked && !node.hidden).map((node) => node.id));
        return;
      }
      case "fit": zoomTo(); return;
      case "copy": {
        const clip = copySelection(scene, index, ids);
        if (!clip) return;
        clipboard.current = clip;
        void copyText(JSON.stringify(clip));
        return;
      }
      case "paste": {
        const clip = clipboard.current;
        if (clip) paste(clip);
        return;
      }
      case "present": {
        const frame = ids.length ? [...ancestors(scene, scene.get(ids[0])!), scene.get(ids[0])!].find((node) => node.type === "frame" && !effectiveParent(scene, node)) : undefined;
        onPresent?.(frame?.id ?? null);
        return;
      }
    }
    if (readOnly || !ids.length) return;
    switch (command) {
      case "delete": commit(deleteNodes(scene, index, ids), []); break;
      case "duplicate": { const copy = duplicateNodes(scene, index, ids, 16); commit(copy.nodes, copy.roots); break; }
      case "group": case "frame": { const wrapped = wrapNodes(scene, ids, command); if (wrapped) commit(wrapped.nodes, [wrapped.id]); break; }
      case "ungroup": {
        const changed = ids.flatMap((id) => (scene.get(id)?.type === "group" || scene.get(id)?.type === "frame" ? unwrap(scene, index, id) : []));
        commit(changed, changed.filter((node) => !node.deleted).map((node) => node.id));
        break;
      }
      case "hide": { const hidden = !nodes.every((node) => node.hidden); commit(nodes.map((node) => ({ ...node, hidden }))); break; }
      case "lock": { const locked = !nodes.every((node) => node.locked); commit(nodes.map((node) => ({ ...node, locked })), locked ? [] : ids); break; }
      case "union": case "subtract": case "intersect": case "exclude": case "flatten": {
        const combined = command === "flatten" ? flatten(scene, index, ids) : booleanGroup(scene, ids, command);
        if (combined) commit(combined.nodes, [combined.id]);
        else notify(command === "flatten" ? "Select shapes to flatten" : "Select two or more shapes to combine");
        break;
      }
      case "component": {
        const only = ids.length === 1 ? scene.get(ids[0]) : undefined;
        if (only?.type === "frame" && !only.instanceOf) { commit([makeComponent(only)]); break; }
        const wrapped = wrapNodes(scene, ids, "frame");
        if (wrapped) commit([makeComponent({ ...wrapped.nodes[0]!, fill: null, name: "Component" }), ...wrapped.nodes.slice(1)], [wrapped.id]);
        break;
      }
      case "detach": commit(ids.flatMap((id) => detach(scene, index, id))); break;
      case "edit-path": { const only = scene.get(ids[0]!); if (ids.length === 1 && isPathNode(only)) setPathEdit({ id: only.id, at: null }); break; }
      default: commit(reorder(scene, index, ids, command));
    }
  }, [live, nodes, scene, index, canvas, readOnly, zoomTo, onPresent, notify]);

  const pasteTarget = (clip?: Clipboard) => {
    const only = live.length === 1 ? scene.get(live[0]) : undefined;
    if (only?.type === "frame" && !clip?.roots.includes(only.id)) return only.id;
    return only ? effectiveParent(scene, only) : null;
  };

  const paste = (clip: Clipboard) => {
    if (readOnly) return;
    const parent = pasteTarget(clip);
    const overlap = clip.roots.some((id) => isLive(scene.get(id)));
    const pasted = pasteClipboard(scene, index, clip, parent, overlap ? 16 : 0);
    canvas.commit(pasted.nodes);
    setSelected(pasted.roots);
  };

  const placeImages = async (files: File[], at: Point | null) => {
    if (readOnly) return;
    const centre = at ?? toWorld(view, { x: size.width / 2, y: size.height / 2 });
    const created: CanvasNode[] = [];
    for (const file of files.filter((item) => item.type.startsWith("image/"))) {
      try {
        if (file.type === "image/svg+xml") {
          const target = at ? frameAt(at, new Set()) : null;
          const vectors = svgNodes(await file.text(), file.name, { x: centre.x + created.length * 24, y: centre.y + created.length * 24 }, target, target ? worldOrigin(scene, scene.get(target)!) : { x: 0, y: 0 }, nextZ(index.get(target) ?? []) + created.length);
          if (vectors) { canvas.commit(vectors); created.push(vectors[0]!); continue; }
        }
        const image = await addImage(file);
        created.push(imageNode(image, { x: centre.x + created.length * 24, y: centre.y + created.length * 24 }, at !== null));
      } catch (error) {
        notify(error instanceof Error ? error.message : "Could not add the image");
      }
    }
    const images = created.filter((node) => node.type === "image");
    if (images.length) canvas.commit(images);
    if (created.length) { setSelected(created.map((node) => node.id)); setTool("move"); }
  };

  const imageNode = (image: PlacedImage, centre: Point, dropped: boolean): CanvasNode => {
    const outer = (index.get(null) ?? []).find((node) => node.type === "frame" && !node.hidden && !node.layout && !node.instanceOf && containsPoint(worldBox(scene, node), centre));
    const parent = dropped ? frameAt(centre, new Set()) : outer?.id ?? null;
    const origin = parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 };
    const room = parent ? Math.max(48, scene.get(parent)!.width * 0.8) : 800;
    const limit = Math.min(800, room) / Math.max(image.width, image.height, 1);
    const width = Math.max(8, image.width * Math.min(1, limit));
    const height = Math.max(8, image.height * Math.min(1, limit));
    return newNode("image", parent, nextZ(index.get(parent) ?? []), {
      name: image.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "Image", fileId: image.fileId,
      x: round(centre.x - width / 2 - origin.x), y: round(centre.y - height / 2 - origin.y), width: round(width), height: round(height), fill: null,
    });
  };

  const placePicked = (image: PlacedImage) => {
    const node = imageNode(image, toWorld(view, { x: size.width / 2, y: size.height / 2 }), false);
    canvas.commit([node]);
    setSelected([node.id]);
    setTool("move");
  };

  const inkOn = (parentId: string | null) => {
    let parent = parentId ? scene.get(parentId) : undefined;
    while (parent && !parent.fill) parent = parent.parentId ? scene.get(parent.parentId) : undefined;
    return parent?.fill ? contrastInk(parent.fill, "#111111") : themeInk(stage.current);
  };

  const startText = (world: Point, width: number | null) => {
    const parent = frameAt(world, new Set());
    const parentNode = parent ? scene.get(parent) : undefined;
    const origin = parentNode ? worldOrigin(scene, parentNode) : { x: 0, y: 0 };
    const node = newNode("text", parent, nextZ(index.get(parent) ?? []), {
      text: "", x: round(world.x - origin.x), y: round(world.y - origin.y - 10), fill: inkOn(parent),
      ...(width ? { width: round(width), autoWidth: false } : { autoWidth: true, width: 1 }),
    });
    canvas.preview([node]);
    setSelected([node.id]);
    setEditing({ id: node.id, created: true, original: node });
    setTool("move");
  };

  const penTool = usePenTool({ canvas, index, scene, zoom: view.zoom, frameAt, inkOn, onDone: (id) => { setSelected([id]); setTool("move"); } });
  const pen = penTool.draft;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (editing && !(event.target as Element).closest("textarea")) finishText();
    if ((event.target as Element).closest("[data-canvas-chrome]")) return;
    stage.current?.focus({ preventScroll: true });
    const screen = point(event);
    pointers.current.set(event.pointerId, screen);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (gesture.current?.kind === "move" || gesture.current?.kind === "resize") canvas.preview(null);
      gesture.current = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view };
      setGuides([]); setMarquee(null);
      return;
    }
    const world = toWorld(view, screen);
    const target = event.target as Element;
    if (event.button === 1 || tool === "hand" || space.current || (event.pointerType === "touch" && tool === "move" && !target.closest("[data-node-id],[data-handle],[data-rotate],[data-endpoint],[data-frame-label]"))) {
      gesture.current = { kind: "pan", start: screen, view };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    if (tool === "comment") {
      const hit = target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
      onComment?.(world, hit ? pick(hit, true) : null);
      return;
    }
    if (!readOnly && tool === "pen") { if (penTool.down(world, event.shiftKey)) gesture.current = { kind: "pen", start: world }; return; }
    const segment = (target as HTMLElement).dataset?.segment;
    const editedNode = pathEdit ? scene.get(pathEdit.id) : undefined;
    const added = segment && isPathNode(editedNode) && !readOnly ? addPointAt(editedNode, worldOrigin(scene, editedNode), segment, world) : null;
    if (added) {
      canvas.preview([added.node]);
      setPathEdit({ id: added.node.id, at: added.at });
      gesture.current = { kind: "anchor", at: added.at, part: "point", start: world, anchors: added.anchors, original: added.node, world: added.origin, mirror: false };
      setBusy(true);
      return;
    }
    const anchor = (target as HTMLElement).dataset?.anchor;
    if (pathEdit && anchor !== undefined && !readOnly) {
      const node = scene.get(pathEdit.id);
      if (!isPathNode(node)) { setPathEdit(null); return; }
      const [at, part] = anchor.split(":") as [string, "point" | "in" | "out"];
      const origin = worldOrigin(scene, node);
      const anchors = anchorsOf(node, origin);
      const index = Number(at);
      const again = event.timeStamp - lastDown.current.at < 400 && lastDown.current.hit === `anchor:${anchor}`;
      lastDown.current = { at: event.timeStamp, hit: `anchor:${anchor}` };
      setPathEdit({ id: node.id, at: index });
      if (again && part === "point") { canvas.commit([withAnchors(node, origin, toggleSmooth(anchors, index, Boolean(node.closed)))]); return; }
      const current = anchors[index]!;
      const mirror = part !== "point" && Math.abs(current.in.x + current.out.x) < 0.5 && Math.abs(current.in.y + current.out.y) < 0.5;
      gesture.current = { kind: "anchor", at: index, part, start: world, anchors, original: node, world: origin, mirror };
      setBusy(true);
      return;
    }
    if (pathEdit && !target.closest("[data-anchor]")) setPathEdit(null);
    if (isCropped(cropNode) && !readOnly && tool === "move" && containsPoint(worldBox(scene, cropNode), world)) {
      gesture.current = { kind: "crop", start: world, original: cropNode };
      setBusy(true);
      return;
    }
    if (cropEdit) setCropEdit(null);
    if (!readOnly && tool !== "move") {
      if (tool === "text") { gesture.current = { kind: "create", type: "text", start: world, parentId: null, node: null }; return; }
      const parentId = frameAt(world, new Set());
      gesture.current = { kind: "create", type: tool as Exclude<Tool, "move" | "hand" | "pen" | "comment" | "text">, start: world, parentId, node: null };
      return;
    }
    const handle = (target as HTMLElement).dataset?.handle as Handle | undefined;
    if (handle && !readOnly) {
      gesture.current = { kind: "resize", handle, originals: topmost(scene, live), box: contentBox(live)!, base: scene, baseIndex: index };
      setBusy(true);
      return;
    }
    if ((target as HTMLElement).dataset?.rotate && nodes.length === 1 && !readOnly) {
      const box = worldBox(scene, nodes[0]);
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      gesture.current = { kind: "rotate", centre, start: angleOf(centre, world) - nodes[0].rotation, original: nodes[0] };
      setBusy(true);
      return;
    }
    const endpoint = (target as HTMLElement).dataset?.endpoint;
    if (endpoint !== undefined && nodes.length === 1 && !readOnly) {
      gesture.current = { kind: "endpoint", end: endpoint === "0" ? 0 : 1, original: nodes[0] };
      setBusy(true);
      return;
    }
    const label = target.closest("[data-frame-label]")?.getAttribute("data-frame-label");
    const hit = label ?? target.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
    const repeat = event.timeStamp - lastDown.current.at < 400 && lastDown.current.hit === hit;
    lastDown.current = { at: event.timeStamp, hit };
    if (repeat && hit && !label && enter(hit)) { event.preventDefault(); return; }
    const picked = label ?? (hit ? pick(hit, event.ctrlKey || event.metaKey) : null);
    const insideSelection = !event.shiftKey && live.length > 0 && topmost(scene, live).some((node) => containsPoint(worldBounds(scene, node), world));
    if (insideSelection && !readOnly && (!picked || live.includes(picked) || live.some((id) => descendants(scene, id, index).some((child) => child.id === picked)))) {
      gesture.current = { kind: "move", start: world, originals: topmost(scene, live), box: contentBox(live)!, moved: false, click: picked && !live.includes(picked) ? picked : null, copiedFrom: [] };
      return;
    }
    if (!picked) {
      const scope = hit ? (() => { const node = scene.get(hit); return node?.type === "frame" && !node.parentId ? node.id : null; })() : null;
      const base = event.shiftKey ? live : [];
      if (!event.shiftKey) setSelected([]);
      gesture.current = { kind: "marquee", start: world, base, scope };
      return;
    }
    const next = event.shiftKey ? (live.includes(picked) ? live.filter((id) => id !== picked) : [...live, picked]) : live.includes(picked) ? live : [picked];
    setSelected(next);
    if (readOnly || event.shiftKey) return;
    const moving = topmost(scene, next).filter((node) => !node.locked);
    gesture.current = { kind: "move", start: world, originals: moving, box: contentBox(next) ?? { x: world.x, y: world.y, width: 0, height: 0 }, moved: false, click: null, copiedFrom: [] };
  };

  const snapTargets = (exclude: ReadonlySet<string>, parentIds: ReadonlySet<string | null>) => {
    const visible = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: size.width / view.zoom, height: size.height / view.zoom };
    const targets: Box[] = [];
    for (const parent of parentIds) {
      if (parent) targets.push(worldBox(scene, scene.get(parent)!));
      for (const node of index.get(parent) ?? []) {
        if (exclude.has(node.id) || node.hidden) continue;
        const box = worldBounds(scene, node);
        if (intersects(box, visible)) targets.push(box);
      }
    }
    for (const guide of pageGuides ?? []) targets.push(guide.axis === "x" ? { x: guide.at, y: FAR, width: 0, height: 0 } : { x: FAR, y: guide.at, width: 0, height: 0 });
    return targets;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const screen = point(event);
    const world = toWorld(view, screen);
    onPointer(world, event.buttons > 0);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, screen);
    const current = gesture.current;
    if (!current) {
      if (tool === "pen" && pen) penTool.hover(world);
      if (tool !== "move" || event.pointerType === "touch") return;
      const target = event.target as Element;
      const label = target.closest("[data-frame-label]")?.getAttribute("data-frame-label");
      const hit = label ?? target.closest("[data-node-id]")?.getAttribute("data-node-id");
      const next = hit ? (label ?? pick(hit, event.ctrlKey || event.metaKey)) : null;
      if (next !== hover) setHover(next);
      return;
    }
    const threshold = 6 / view.zoom;
    const snapping = !(event.ctrlKey || event.metaKey);
    switch (current.kind) {
      case "pinch": {
        const [a, b] = [...pointers.current.values()];
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoom = clampZoom(current.view.zoom * (distance / Math.max(1, current.distance)));
        const anchor = toWorld(current.view, current.mid);
        setView({ zoom, x: mid.x - anchor.x * zoom, y: mid.y - anchor.y * zoom });
        return;
      }
      case "pan":
        setView({ ...current.view, x: current.view.x + screen.x - current.start.x, y: current.view.y + screen.y - current.start.y });
        return;
      case "marquee": {
        const box = normalizedBox(current.start, world);
        setMarquee(box);
        const pool = current.scope ? index.get(current.scope) ?? [] : (index.get(null) ?? []).flatMap((node) => (node.type === "frame" && !contains(box, worldBounds(scene, node)) ? (index.get(node.id) ?? []) : [node]));
        const hits = pool.filter((node) => !node.locked && !node.hidden && (node.type === "frame" && !node.parentId ? contains(box, worldBounds(scene, node)) : intersects(box, worldBounds(scene, node)))).map((node) => node.id);
        setSelected([...new Set([...current.base, ...hits])]);
        return;
      }
      case "move": {
        let dx = world.x - current.start.x;
        let dy = world.y - current.start.y;
        if (!current.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
        if (!current.moved) {
          current.moved = true;
          setBusy(true);
          if (event.altKey) {
            const copy = duplicateNodes(scene, index, current.originals.map((node) => node.id), 0);
            current.copiedFrom = current.originals.map((node) => node.id);
            current.originals = copy.nodes.filter((node) => copy.roots.includes(node.id));
            canvas.preview(copy.nodes, { share: true });
            setSelected(copy.roots);
            pendingCopies.current = copy.nodes;
          }
        }
        if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const moving = new Set(current.originals.flatMap((node) => [node.id, ...descendants(scene, node.id, index).map((child) => child.id)]));
        const parents = new Set(current.originals.map((node) => effectiveParent(scene, node)));
        const box = { ...current.box, x: current.box.x + dx, y: current.box.y + dy };
        const snap = snapping ? snapBox(box, snapTargets(moving, parents), threshold, { x: event.shiftKey ? dx !== 0 : true, y: event.shiftKey ? dy !== 0 : true }) : { dx: 0, dy: 0, guides: [] };
        dx = round(current.box.x + dx + snap.dx) - current.box.x;
        dy = round(current.box.y + dy + snap.dy) - current.box.y;
        setGuides(near(snap.guides));
        const extra = current.copiedFrom.length ? pendingCopies.current.filter((node) => !current.originals.some((root) => root.id === node.id)) : [];
        canvas.preview([...extra, ...current.originals.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }))], { share: true });
        return;
      }
      case "resize": {
        if (current.originals.length === 1) {
          const node = current.originals[0];
          let pointer = world;
          if (snapping && !node.rotation) {
            const exclude = new Set([node.id, ...descendants(scene, node.id, index).map((child) => child.id)]);
            const handleX = current.handle.includes("w") ? 0 : current.handle.includes("e") ? 2 : -1;
            const handleY = current.handle.includes("n") ? 0 : current.handle.includes("s") ? 2 : -1;
            const snap = snapBox({ x: world.x, y: world.y, width: 0, height: 0 }, snapTargets(exclude, new Set([effectiveParent(scene, node)])), threshold, { x: handleX >= 0, y: handleY >= 0 }, { x: [0], y: [0] });
            pointer = { x: world.x + snap.dx, y: world.y + snap.dy };
            setGuides(near(snap.guides));
          }
          canvas.preview(resizeSingle(current.base, current.baseIndex, node, current.handle, { x: round(pointer.x), y: round(pointer.y) }, event.shiftKey, event.altKey), { share: true });
        } else {
          const next = resizeBox(current.box, current.handle, world, event.shiftKey, event.altKey);
          canvas.preview(resizeMany(current.base, current.baseIndex, current.originals, current.box, next), { share: true });
        }
        return;
      }
      case "rotate": {
        let angle = angleOf(current.centre, world) - current.start;
        if (event.shiftKey) angle = Math.round(angle / 15) * 15;
        angle = ((angle + 540) % 360) - 180;
        canvas.preview([{ ...current.original, rotation: Math.round(angle * 10) / 10 }], { share: true });
        return;
      }
      case "endpoint": {
        let target = world;
        if (event.shiftKey) {
          const box = worldBox(scene, current.original);
          const list = current.original.points ?? [0, 0, 0, 0];
          const other = current.end === 0 ? { x: box.x + list[list.length - 2], y: box.y + list[list.length - 1] } : { x: box.x + list[0], y: box.y + list[1] };
          const angle = Math.round(Math.atan2(world.y - other.y, world.x - other.x) / (Math.PI / 4)) * (Math.PI / 4);
          const length = Math.hypot(world.x - other.x, world.y - other.y);
          target = { x: other.x + Math.cos(angle) * length, y: other.y + Math.sin(angle) * length };
        }
        canvas.preview([moveEndpoint(scene, current.original, current.end, { x: round(target.x), y: round(target.y) })], { share: true });
        return;
      }
      case "pen": penTool.pull(world); return;
      case "crop": canvas.preview([panCrop(current.original, current.start, world)], { share: true }); return;
      case "anchor": {
        const dx = world.x - current.start.x;
        const dy = world.y - current.start.y;
        const anchors = current.anchors.map((item, at) => {
          if (at !== current.at) return item;
          if (current.part === "point") return { ...item, point: { x: round(item.point.x + dx), y: round(item.point.y + dy) } };
          const moved = { x: item[current.part].x + dx, y: item[current.part].y + dy };
          const other = current.part === "in" ? "out" : "in";
          const mirrored = current.mirror && !event.altKey ? { [other]: { x: -moved.x, y: -moved.y } } : {};
          return { ...item, [current.part]: moved, ...mirrored };
        });
        canvas.preview([withAnchors(current.original, current.world, anchors)], { share: true });
        return;
      }
      case "create": {
        if (current.type === "text") return;
        let end = world;
        if (Math.hypot(world.x - current.start.x, world.y - current.start.y) * view.zoom < 3 && !current.node) return;
        const line = current.type === "line" || current.type === "arrow";
        if (event.shiftKey) {
          if (line) {
            const angle = Math.round(Math.atan2(world.y - current.start.y, world.x - current.start.x) / (Math.PI / 4)) * (Math.PI / 4);
            const length = Math.hypot(world.x - current.start.x, world.y - current.start.y);
            end = { x: current.start.x + Math.cos(angle) * length, y: current.start.y + Math.sin(angle) * length };
          } else {
            const side = Math.max(Math.abs(world.x - current.start.x), Math.abs(world.y - current.start.y));
            end = { x: current.start.x + side * Math.sign(world.x - current.start.x || 1), y: current.start.y + side * Math.sign(world.y - current.start.y || 1) };
          }
        }
        const origin = current.parentId ? worldOrigin(scene, scene.get(current.parentId)!) : { x: 0, y: 0 };
        const start = { x: round(current.start.x), y: round(current.start.y) };
        end = { x: round(end.x), y: round(end.y) };
        const base = current.node ?? newNode(current.type, current.parentId, nextZ(index.get(current.parentId) ?? []), {
          ...(current.type === "frame" ? { name: `Frame ${(index.get(null) ?? []).filter((node) => node.type === "frame").length + 1}` } : {}),
          ...(line ? { stroke: inkOn(current.parentId) } : {}),
        });
        let node: CanvasNode;
        if (line) node = refitPoints({ ...base, x: start.x - origin.x, y: start.y - origin.y }, [0, 0, end.x - start.x, end.y - start.y]);
        else {
          const box = normalizedBox(start, end);
          node = { ...base, x: box.x - origin.x, y: box.y - origin.y, width: Math.max(1, box.width), height: Math.max(1, box.height) };
        }
        current.node = node;
        canvas.preview([node]);
        return;
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    gesture.current = null;
    setBusy(false);
    setPanning(false);
    setGuides([]);
    setMarquee(null);
    if (!current) return;
    const world = toWorld(view, point(event));
    switch (current.kind) {
      case "move": {
        if (!current.moved) {
          canvas.preview(null);
          if (current.click) setSelected([current.click]);
          return;
        }
        const drafts = current.originals.map((node) => canvas.scene.get(node.id) ?? node);
        const changed = dropMoved(scene, index, drafts, world, current.copiedFrom);
        const copies = current.copiedFrom.length ? pendingCopies.current.filter((node) => !current.originals.some((root) => root.id === node.id)) : [];
        canvas.commit([...copies, ...changed]);
        pendingCopies.current = [];
        return;
      }
      case "anchor": case "crop": {
        const node = canvas.scene.get(current.original.id);
        if (node) canvas.commit([node]);
        return;
      }
      case "resize": case "rotate": case "endpoint": {
        const ids = current.kind === "resize" ? current.originals.flatMap((node) => [node.id, ...(node.type === "group" ? descendants(scene, node.id, index).map((child) => child.id) : [])]) : [current.original.id];
        canvas.commit(ids.map((id) => canvas.scene.get(id)).filter(isLive));
        return;
      }
      case "create": {
        if (current.type === "text") {
          const dragged = Math.abs(world.x - current.start.x) * view.zoom > 8;
          startText(dragged ? { x: Math.min(world.x, current.start.x), y: Math.min(world.y, current.start.y) + 10 } : current.start, dragged ? Math.abs(world.x - current.start.x) : null);
          return;
        }
        let node = current.node;
        if (!node) {
          const origin = current.parentId ? worldOrigin(scene, scene.get(current.parentId)!) : { x: 0, y: 0 };
          const preset = current.type === "frame" ? { width: 400, height: 300 } : current.type === "line" || current.type === "arrow" ? { width: 120, height: 0 } : { width: 100, height: 100 };
          node = newNode(current.type, current.parentId, nextZ(index.get(current.parentId) ?? []), {
            x: round(current.start.x - origin.x), y: round(current.start.y - origin.y), ...preset,
            ...(current.type === "frame" ? { name: `Frame ${(index.get(null) ?? []).filter((item) => item.type === "frame").length + 1}` } : {}),
            ...(current.type === "line" || current.type === "arrow" ? { points: [0, 0, preset.width, 0], stroke: inkOn(current.parentId) } : {}),
          });
        }
        canvas.preview(null);
        canvas.commit([node]);
        setSelected([node.id]);
        setTool("move");
        return;
      }
    }
  };

  const enter = (hit: string) => {
    const node = scene.get(hit);
    if (readOnly || !isLive(node)) return false;
    const chain = [...ancestors(scene, node), node];
    const current = live.length === 1 ? chain.findIndex((item) => item.id === live[0]) : -1;
    if (current >= 0 && current < chain.length - 1) { setSelected([chain[current + 1].id]); return true; }
    if (node.type === "text" && !node.locked && live.includes(node.id)) { setEditing({ id: node.id, created: false, original: node }); return true; }
    if (isPathNode(node) && !node.rotation && live.includes(node.id)) { setPathEdit({ id: node.id, at: null }); return true; }
    if (isCropped(node) && live.includes(node.id)) { setCropEdit(node.id); return true; }
    return false;
  };

  const finishText = () => {
    if (!editing) return;
    stage.current?.focus({ preventScroll: true });
    const node = canvas.scene.get(editing.id);
    setEditing(null);
    canvas.preview(null);
    if (!node) return;
    const empty = !(node.text ?? "").trim();
    if (editing.created) {
      if (empty) { setSelected([]); return; }
      canvas.commit([{ ...node, name: textName(node.text) }]);
      return;
    }
    const before = editing.original;
    if (empty) { canvas.commit([{ ...node, deleted: true }]); setSelected([]); return; }
    if (before.text !== node.text) canvas.commit([{ ...node, ...(before.name === textName(before.text) ? { name: textName(node.text) } : {}) }]);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTyping(event.target)) return;
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    const done = () => { event.preventDefault(); event.stopPropagation(); };
    if (key === " " && !space.current) { space.current = true; setPanning(true); done(); return; }
    if (pen && (key === "enter" || key === "escape")) { done(); penTool.finish(false); return; }
    if (pen && key === "backspace") { done(); penTool.undo(); return; }
    if ((pathEdit || cropEdit) && (key === "enter" || key === "escape")) { done(); setPathEdit(null); setCropEdit(null); return; }
    if (pathEdit && pathEdit.at !== null && (key === "delete" || key === "backspace") && !readOnly) {
      done();
      const node = scene.get(pathEdit.id);
      if (!isPathNode(node) || (node.points?.length ?? 0) <= 4) return;
      const origin = worldOrigin(scene, node);
      canvas.commit([withAnchors({ ...node, breaks: undefined }, origin, anchorsOf(node, origin).filter((_, at) => at !== pathEdit.at))]);
      setPathEdit({ id: node.id, at: null });
      return;
    }
    if (command && event.altKey && ["u", "s", "i", "x"].includes(key)) { done(); run(({ u: "union", s: "subtract", i: "intersect", x: "exclude" } as const)[key as "u" | "s" | "i" | "x"]); return; }
    if (command && event.altKey && key === "k") { done(); run("component"); return; }
    if (command && event.altKey && key === "b") { done(); run("detach"); return; }
    if (command && event.altKey && key === "enter") { done(); run("present"); return; }
    if (command && key === "e" && !event.shiftKey) { done(); run("flatten"); return; }
    if (!command && event.shiftKey && key === "r") { done(); setRulers((on) => !on); return; }
    if (command && key === "z") { done(); if (event.shiftKey) canvas.redo(); else canvas.undo(); return; }
    if (command && key === "y") { done(); canvas.redo(); return; }
    if (command && key === "a") { done(); run("select-all"); return; }
    if (command && key === "d") { done(); run("duplicate"); return; }
    if (command && key === "g") { done(); run(event.shiftKey ? "ungroup" : event.altKey ? "frame" : "group"); return; }
    if (command && event.shiftKey && key === "h") { done(); run("hide"); return; }
    if (command && event.shiftKey && key === "l") { done(); run("lock"); return; }
    if (command && (key === "=" || key === "+")) { done(); zoomAt(1.25, { x: size.width / 2, y: size.height / 2 }); return; }
    if (command && key === "-") { done(); zoomAt(0.8, { x: size.width / 2, y: size.height / 2 }); return; }
    if (key === "]" || key === "[") { done(); run(key === "]" ? (command ? "front" : "forward") : (command ? "back" : "backward")); return; }
    if (command) return;
    if (event.shiftKey && (event.code === "Digit1" || event.code === "Digit2" || event.code === "Digit0")) {
      done();
      if (event.code === "Digit1") zoomTo();
      else if (event.code === "Digit2") zoomTo(live.length ? live : undefined);
      else zoomAt(1 / view.zoom, { x: size.width / 2, y: size.height / 2 });
      return;
    }
    if (event.shiftKey && key === "a" && !readOnly && live.length) {
      done();
      const toggled = toggleAutoLayout(scene, live);
      if (toggled) { canvas.commit(toggled.nodes); setSelected([toggled.id]); }
      return;
    }
    if (key === "escape") {
      done();
      if (tool !== "move") { setTool("move"); return; }
      const parent = live.length ? effectiveParent(scene, scene.get(live[0])!) : null;
      setSelected(parent && live.length ? [parent] : []);
      return;
    }
    if (key === "enter" && live.length === 1 && !readOnly) {
      done();
      const node = scene.get(live[0])!;
      if (node.type === "text") setEditing({ id: node.id, created: false, original: node });
      else if (isPathNode(node) && !node.rotation) setPathEdit({ id: node.id, at: null });
      else if (isCropped(node)) setCropEdit(cropEdit === node.id ? null : node.id);
      else if (index.get(node.id)?.length) setSelected(index.get(node.id)!.map((child) => child.id));
      return;
    }
    if ((key === "delete" || key === "backspace") && live.length) { done(); run("delete"); return; }
    if (key.startsWith("arrow") && live.length && !readOnly) {
      done();
      const step = event.shiftKey ? 10 : 1;
      const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
      const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
      canvas.commit(topmost(scene, live).filter((node) => !node.locked).map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })));
      return;
    }
    if (key === "l" && event.shiftKey && !readOnly) { done(); setTool("arrow"); return; }
    if (key === "i" && !readOnly) { done(); setImageMenu(true); return; }
    const next = TOOL_KEYS[key];
    if (next && !event.altKey && (!readOnly || next === "move" || next === "hand")) { done(); setTool(next); }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " ") { space.current = false; if (!gesture.current) setPanning(false); }
  };

  const onPaste = (event: ClipboardEvent) => {
    if (isTyping(event.target) || readOnly || !event.clipboardData) return;
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); void placeImages(files, null); return; }
    const text = event.clipboardData.getData("text/plain");
    const clip = text.includes(CLIPBOARD_MARK) ? parseClipboard(text) : null;
    event.preventDefault();
    if (clip) { clipboard.current = clip; paste(clip); return; }
    if (clipboard.current && !text) { paste(clipboard.current); return; }
    if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      const parent = pasteTarget();
      const vectors = svgNodes(text, "Vector", toWorld(view, { x: size.width / 2, y: size.height / 2 }), parent, parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 }, nextZ(index.get(parent) ?? []));
      if (vectors) { canvas.commit(vectors); setSelected([vectors[0]!.id]); return; }
    }
    if (text.trim()) {
      const world = toWorld(view, { x: size.width / 2, y: size.height / 2 });
      const parent = pasteTarget();
      const origin = parent ? worldOrigin(scene, scene.get(parent)!) : { x: 0, y: 0 };
      const node = newNode("text", parent, nextZ(index.get(parent) ?? []), { text: text.slice(0, 20_000), name: textName(text), autoWidth: true, x: round(world.x - origin.x), y: round(world.y - origin.y), fill: inkOn(parent) });
      canvas.commit([node]);
      setSelected([node.id]);
    }
  };

  const onCopy = (event: ClipboardEvent, cut = false) => {
    if (isTyping(event.target) || !event.clipboardData) return;
    const clip = copySelection(scene, index, live);
    if (!clip) return;
    event.preventDefault();
    clipboard.current = clip;
    event.clipboardData.setData("text/plain", JSON.stringify(clip));
    if (cut && !readOnly) run("delete");
  };

  useEffect(() => {
    if (tool !== "pen" && pen) penTool.finish(false);
    if (tool !== "move") setPathEdit(null);
  }, [tool]);

  const listeners = useRef({ onKeyDown, onKeyUp, onPaste, onCopy });
  listeners.current = { onKeyDown, onKeyUp, onPaste, onCopy };
  useEffect(() => {
    const active = () => {
      const focused = document.activeElement;
      return !focused || focused === document.body || Boolean(root.current?.contains(focused));
    };
    const keydown = (event: KeyboardEvent) => { if (active()) listeners.current.onKeyDown(event); };
    const keyup = (event: KeyboardEvent) => listeners.current.onKeyUp(event);
    const paste = (event: ClipboardEvent) => { if (active()) listeners.current.onPaste(event); };
    const copy = (event: ClipboardEvent) => { if (active()) listeners.current.onCopy(event); };
    const cut = (event: ClipboardEvent) => { if (active()) listeners.current.onCopy(event, true); };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("paste", paste);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("paste", paste);
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
    };
  }, []);

  const editingNode = editing ? scene.get(editing.id) : undefined;
  const rendered = useRef<Scene | null>(null);
  useEffect(() => { rendered.current = scene; });
  const options = useMemo<RenderOptions>(() => {
    const before = rendered.current;
    return { index, images, interactive: true, editing: editing?.id ?? null, prefix: "c-", ...(before ? { dirty: changedSubtrees(before, scene) } : {}) };
  }, [index, images, editing?.id]);
  const selectionApi: SelectionApi = { ids: live, nodes, select, zoomTo: (ids) => setPendingZoom([...ids]), run, centre: () => toWorld(view, { x: size.width / 2, y: size.height / 2 }) };
  const cursor = panning ? (gesture.current?.kind === "pan" ? "grabbing" : "grab") : tool === "hand" ? "grab" : tool === "move" ? "default" : tool === "text" ? "text" : tool === "comment" ? "copy" : "crosshair";
  const showRulers = rulers && Boolean(onGuides) && !narrow;
  const stageCovered = Math.max(0, coveredRight - (shown.inspector && !compact ? INSPECTOR_WIDTH : 0));
  const editedPath = pathEdit ? scene.get(pathEdit.id) : undefined;

  return (
    <div ref={root} className="relative flex min-h-0 min-w-0 flex-1">
      {shown.layers && (
        <aside aria-label="Layers" className={cn("flex w-60 shrink-0 flex-col border-r border-hairline/40 bg-panel", compact && "absolute inset-y-0 left-0 z-20 w-[min(260px,80vw)] pb-16 origin-overlay-in")}>
          {layers(selectionApi)}
        </aside>
      )}
      <div ref={stage} tabIndex={0} aria-label="Canvas" role="application" data-canvas-stage
        className="relative min-w-0 flex-1 touch-none select-none overflow-hidden bg-inset outline-none focus-visible:outline-none"
        style={{ cursor, outline: "none" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDragOver={(event) => { if (!readOnly && [...event.dataTransfer.items].some((item) => item.kind === "file")) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); void placeImages([...event.dataTransfer.files], toWorld(view, point(event))); }}>
        <svg className="absolute inset-0 size-full" role="presentation">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            <SceneLayer options={options} />
          </g>
          <Overlay scene={scene} index={index} view={view} selected={nodes} hover={hover ? scene.get(hover) ?? null : null} guides={guides} marquee={marquee}
            cursors={cursors} editing={editing?.id ?? null} readOnly={readOnly} busy={busy} remoteSelections={remoteSelections} showPrototype={showPrototype}
            pathEdit={isPathNode(editedPath) ? { node: editedPath, at: pathEdit!.at } : null} pen={pen ? { anchors: pen.anchors, hover: penTool.hovered } : null} crop={isCropped(cropNode) ? cropNode : null} />
        </svg>
        {stageLayer?.(view)}
        {showRulers && <Rulers view={view} size={size} guides={pageGuides ?? []} onGuides={(next) => onGuides?.(next)} readOnly={readOnly} selection={live.length ? contentBox(live) : null} />}
        {editing && editingNode && (
          <TextEditor node={editingNode} origin={toScreen(view, worldOrigin(scene, editingNode))} zoom={view.zoom}
            onChange={(text) => canvas.preview([{ ...editingNode, text, ...(editingNode.autoWidth ? { width: layoutText({ ...editingNode, text }, measureText).width } : {}) }])}
            onDone={finishText} />
        )}
        {!(index.get(null)?.length) && !editing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-ink-tertiary">
            {readOnly ? "Nothing on this canvas yet" : narrow ? "Pick a tool below to start" : "Press F for a frame, R for a rectangle, T for text"}
          </div>
        )}
        <div data-canvas-chrome className="contents">
          <CanvasToolbar tool={tool} readOnly={readOnly} onTool={setTool} canUndo={canvas.canUndo} canRedo={canvas.canRedo} onUndo={canvas.undo} onRedo={canvas.redo}
            imageMenu={imageMenu} onImageMenu={setImageMenu}
            imagePicker={imagePicker ? (close) => imagePicker((image) => { placePicked(image); close(); }, close) : undefined}
            onUpload={(files) => void placeImages(files, null)}
            narrow={narrow && !readOnly} inset={stageCovered} panels={shown} onPanels={(next) => setPanels(compact ? oneOverlay(shown, next) : next)} />
          <ZoomControls offset={showRulers ? RULER : 0} inset={stageCovered} zoom={view.zoom} onZoom={(factor) => zoomAt(factor, { x: size.width / 2, y: size.height / 2 })}
            onFit={() => zoomTo()} onSelection={live.length ? () => zoomTo(live) : undefined} onActual={() => zoomAt(1 / view.zoom, { x: size.width / 2, y: size.height / 2 })} />
        </div>
      </div>
      {shown.inspector && (
        <aside aria-label="Design" style={compact ? undefined : { width: INSPECTOR_WIDTH }} className={cn("flex shrink-0 flex-col border-l border-hairline/40 bg-panel", compact && "absolute inset-x-0 bottom-0 z-20 max-h-[55%] w-auto border-l-0 border-t pb-16 origin-overlay-in")}>
          {inspector(selectionApi)}
        </aside>
      )}
    </div>
  );
}
