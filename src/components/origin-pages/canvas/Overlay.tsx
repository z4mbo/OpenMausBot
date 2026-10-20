import { worldOrigin, type CanvasNode, type Scene } from "../../../../shared/canvas-scene";
import { corners, toScreen, worldBox, type Box, type Guide, type Point, type View } from "./geometry";
import { anchorsOf } from "./pen";

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

export type RemoteCursor = { userId: string; name: string; x: number; y: number; color: string; agent?: boolean };
/** What a collaborator (or an agent) has selected, outlined in their colour. */
export type RemoteSelection = { userId: string; name: string; color: string; ids: readonly string[] };

const HANDLE_POSITION: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const GUIDE = "#F43F5E";

function outline(scene: Scene, node: CanvasNode, view: View) {
  return corners(worldBox(scene, node), node.rotation).map((point) => toScreen(view, point));
}

const points = (list: readonly Point[]) => list.map((point) => `${point.x},${point.y}`).join(" ");

export type OverlayProps = {
  scene: Scene;
  index: ReadonlyMap<string | null, readonly CanvasNode[]>;
  view: View;
  selected: readonly CanvasNode[];
  hover: CanvasNode | null;
  guides: readonly Guide[];
  marquee: Box | null;
  cursors: readonly RemoteCursor[];
  editing: string | null;
  readOnly: boolean;
  busy: boolean;
  remoteSelections?: readonly RemoteSelection[];
  showPrototype?: boolean;
  pathEdit?: { node: CanvasNode; at: number | null } | null;
  pen?: { anchors: readonly Point[]; hover: Point | null } | null;
};

export function Overlay({ scene, index, view, selected, hover, guides, marquee, cursors, editing, readOnly, busy, remoteSelections, showPrototype, pathEdit, pen }: OverlayProps) {
  const single = selected.length === 1 ? selected[0] : null;
  const line = single && (single.type === "line" || single.type === "arrow") ? single : null;
  let frame: Point[] | null = null;
  if (single && !line) frame = outline(scene, single, view);
  else if (selected.length > 1) {
    const all = selected.flatMap((node) => outline(scene, node, view));
    const xs = all.map((point) => point.x);
    const ys = all.map((point) => point.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    frame = [{ x: box.x, y: box.y }, { x: box.right, y: box.y }, { x: box.right, y: box.bottom }, { x: box.x, y: box.bottom }];
  }
  const at = (handle: Handle): Point => {
    const [u, v] = HANDLE_POSITION[handle];
    const [a, b, c, d] = frame!;
    const top = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    const bottom = { x: d.x + (c.x - d.x) * u, y: d.y + (c.y - d.y) * u };
    return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
  };
  const roots = index.get(null) ?? [];
  const label = frame && single ? `${Math.round(single.width)} × ${Math.round(single.height)}` : null;
  const labelAt = frame ? frame.reduce((best, point) => (point.y > best.y ? point : best), frame[0]) : null;
  const lineEnds = line?.points ? (() => {
    const box = worldBox(scene, line);
    const list = line.points!;
    return [toScreen(view, { x: box.x + list[0], y: box.y + list[1] }), toScreen(view, { x: box.x + list[list.length - 2], y: box.y + list[list.length - 1] })];
  })() : null;
  const resizable = !readOnly && !busy && !editing && frame && !(single?.locked);
  const rotateHandle = resizable && single && single.type !== "frame" && single.type !== "group" ? (() => {
    const top = at("n");
    const centre = { x: (frame![0].x + frame![2].x) / 2, y: (frame![0].y + frame![2].y) / 2 };
    const length = Math.hypot(top.x - centre.x, top.y - centre.y) || 1;
    return { x: top.x + ((top.x - centre.x) / length) * 22, y: top.y + ((top.y - centre.y) / length) * 22, from: top };
  })() : null;
  return (
    <g>
      <LayoutGrids scene={scene} index={index} view={view} />
      {(() => {
        const offsets = new Map<string, number>();
        return remoteSelections?.map((other) => other.ids.map((id) => {
          const node = scene.get(id);
          if (!node || node.deleted || node.hidden) return null;
          const corner = outline(scene, node, view);
          const top = corner.reduce((best, point) => (point.y < best.y || (point.y === best.y && point.x < best.x) ? point : best), corner[0]!);
          const shift = offsets.get(id) ?? 0;
          offsets.set(id, shift + other.name.length * 6 + 14);
          return (
            <g key={`${other.userId}-${id}`} pointerEvents="none" data-remote-selection={other.name}>
              <polygon points={points(corner)} fill="none" stroke={other.color} strokeWidth={1.5} />
              <rect x={top.x + shift} y={top.y - 16} width={other.name.length * 6 + 10} height={15} rx={3} fill={other.color} />
              <text x={top.x + shift + 5} y={top.y - 5} fontSize={10} fontWeight={500} fill="#101214">{other.name}</text>
            </g>
          );
        }));
      })()}
      {(showPrototype ? [...scene.values()] : selected).map((node) => (node.prototype && !node.deleted ? <PrototypeArrow key={`p-${node.id}`} scene={scene} view={view} node={node} /> : null))}
      {roots.map((node) => {
        if (node.type !== "frame" || node.hidden || node.deleted) return null;
        const position = toScreen(view, { x: node.x, y: node.y });
        const chosen = selected.some((item) => item.id === node.id);
        return (
          <text key={node.id} data-frame-label={node.id} x={position.x} y={position.y - 6} fontSize={11} className={chosen || node.component || node.instanceOf ? "fill-accent-text" : "fill-ink-secondary"}
            style={{ cursor: "default", userSelect: "none" }}>
            {node.component ? "❖ " : node.instanceOf ? "◇ " : ""}{node.name.length > 60 ? `${node.name.slice(0, 60)}…` : node.name}
          </text>
        );
      })}
      {hover && !selected.some((node) => node.id === hover.id) && !busy && (
        <polygon points={points(outline(scene, hover, view))} fill="none" className="stroke-accent" strokeWidth={1.5} pointerEvents="none" />
      )}
      {selected.length > 1 && selected.map((node) => (
        <polygon key={node.id} points={points(outline(scene, node, view))} fill="none" className="stroke-accent" strokeWidth={1} pointerEvents="none" />
      ))}
      {frame && <polygon points={points(frame)} fill="none" className="stroke-accent" strokeWidth={1.5} pointerEvents="none" />}
      {lineEnds && <line x1={lineEnds[0].x} y1={lineEnds[0].y} x2={lineEnds[1].x} y2={lineEnds[1].y} className="stroke-accent" strokeWidth={1} pointerEvents="none" />}
      {rotateHandle && (
        <g>
          <line x1={rotateHandle.from.x} y1={rotateHandle.from.y} x2={rotateHandle.x} y2={rotateHandle.y} className="stroke-accent" strokeWidth={1} pointerEvents="none" />
          <circle data-rotate="1" cx={rotateHandle.x} cy={rotateHandle.y} r={5} className="fill-white stroke-accent" strokeWidth={1.5} style={{ cursor: "grab" }}>
            <title>Rotate</title>
          </circle>
        </g>
      )}
      {resizable && !line && HANDLES.map((handle) => {
        const point = at(handle);
        const side = handle.length === 1;
        if (side && single && (single.width * view.zoom < 24 || single.height * view.zoom < 24)) return null;
        return <rect key={handle} data-handle={handle} x={point.x - 4} y={point.y - 4} width={8} height={8} rx={side ? 4 : 1.5} className="fill-white stroke-accent" strokeWidth={1.5} style={{ cursor: CURSORS[handle] }} />;
      })}
      {lineEnds && !readOnly && !busy && lineEnds.map((point, end) => (
        <circle key={end} data-endpoint={end} cx={point.x} cy={point.y} r={5} className="fill-white stroke-accent" strokeWidth={1.5} style={{ cursor: "move" }} />
      ))}
      {label && labelAt && !editing && (
        <g pointerEvents="none">
          <rect x={labelAt.x - (label.length * 3.3 + 8)} y={labelAt.y + 8} width={label.length * 6.6 + 16} height={18} rx={4} className="fill-accent" />
          <text x={labelAt.x} y={labelAt.y + 21} fontSize={11} textAnchor="middle" className="fill-accent-ink">{label}</text>
        </g>
      )}
      {guides.map((guide, index) => {
        const a = toScreen(view, guide.axis === "x" ? { x: guide.at, y: guide.from } : { x: guide.from, y: guide.at });
        const b = toScreen(view, guide.axis === "x" ? { x: guide.at, y: guide.to } : { x: guide.to, y: guide.at });
        return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={GUIDE} strokeWidth={1} pointerEvents="none" />;
      })}
      {marquee && (() => {
        const a = toScreen(view, { x: marquee.x, y: marquee.y });
        return <rect x={a.x} y={a.y} width={marquee.width * view.zoom} height={marquee.height * view.zoom} className="fill-accent/10 stroke-accent" strokeWidth={1} pointerEvents="none" />;
      })()}
      {pathEdit && <PathHandles node={pathEdit.node} at={pathEdit.at} scene={scene} view={view} />}
      {pen && pen.anchors.length > 0 && (
        <g pointerEvents="none">
          {pen.hover && (() => { const a = toScreen(view, pen.anchors[pen.anchors.length - 1]!); const b = toScreen(view, pen.hover); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-accent" strokeWidth={1} strokeDasharray="4 3" />; })()}
          {pen.anchors.map((anchor, at) => { const point = toScreen(view, anchor); return <rect key={at} x={point.x - 3.5} y={point.y - 3.5} width={7} height={7} className={at === 0 ? "fill-accent stroke-accent" : "fill-white stroke-accent"} strokeWidth={1.5} />; })}
        </g>
      )}
      {cursors.map((cursor) => {
        const point = toScreen(view, cursor);
        return (
          <g key={cursor.userId} data-cursor={cursor.agent ? "agent" : "person"} transform={`translate(${point.x} ${point.y})`} pointerEvents="none" className="transition-transform duration-200 ease-out motion-reduce:transition-none">
            {cursor.agent
              ? <path d="M0 0L0 16L5 11.5L13 11.5Z" fill={cursor.color} stroke="#101214" strokeWidth={1} strokeLinejoin="round" />
              : <path d="M0 0L0 14L4 10.5L7 17L9.5 16L6.6 9.6L11.5 9.6Z" fill={cursor.color} stroke="#101214" strokeWidth={1} />}
            <rect x={12} y={14} width={cursor.name.length * 6.4 + (cursor.agent ? 26 : 12)} height={18} rx={9} fill={cursor.color} />
            {cursor.agent && <path d="M19 18.5l1.2 2.6 2.6 1.2-2.6 1.2-1.2 2.6-1.2-2.6-2.6-1.2 2.6-1.2z" fill="#101214" />}
            <text x={cursor.agent ? 28 : 18} y={27} fontSize={11} fontWeight={500} fill="#101214">{cursor.name}</text>
          </g>
        );
      })}
    </g>
  );
}

function LayoutGrids({ scene, index, view }: { scene: Scene; index: ReadonlyMap<string | null, readonly CanvasNode[]>; view: View }) {
  const frames: CanvasNode[] = [];
  const walk = (parent: string | null) => { for (const node of index.get(parent) ?? []) if (!node.hidden && (node.type === "frame" || node.type === "group")) { if (node.grids) frames.push(node); walk(node.id); } };
  walk(null);
  if (!frames.length) return null;
  return (
    <g pointerEvents="none">
      {frames.map((frame) => {
        const a = toScreen(view, worldOrigin(scene, frame));
        const width = frame.width * view.zoom;
        const height = frame.height * view.zoom;
        return (
          <g key={frame.id}>
            {frame.grids!.map((grid, index) => {
              const color = grid.color.slice(0, 7);
              const alpha = grid.color.length === 9 ? parseInt(grid.color.slice(7), 16) / 255 : 0.1;
              if (grid.kind === "grid") {
                const step = grid.size * view.zoom;
                if (step < 4) return null;
                const lines = [];
                for (let x = step; x < width; x += step) lines.push(<line key={`x${x}`} x1={a.x + x} y1={a.y} x2={a.x + x} y2={a.y + height} stroke={color} strokeOpacity={Math.min(1, alpha * 3)} strokeWidth={1} />);
                for (let y = step; y < height; y += step) lines.push(<line key={`y${y}`} x1={a.x} y1={a.y + y} x2={a.x + width} y2={a.y + y} stroke={color} strokeOpacity={Math.min(1, alpha * 3)} strokeWidth={1} />);
                return <g key={index}>{lines}</g>;
              }
              const columns = grid.kind === "columns";
              const span = (columns ? frame.width : frame.height) - grid.margin * 2;
              const cell = (span - grid.gutter * (grid.count - 1)) / grid.count;
              return (
                <g key={index}>
                  {Array.from({ length: grid.count }, (_, at) => {
                    const start = (grid.margin + at * (cell + grid.gutter)) * view.zoom;
                    return columns
                      ? <rect key={at} x={a.x + start} y={a.y} width={Math.max(0, cell * view.zoom)} height={height} fill={color} fillOpacity={alpha} />
                      : <rect key={at} x={a.x} y={a.y + start} width={width} height={Math.max(0, cell * view.zoom)} fill={color} fillOpacity={alpha} />;
                  })}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function PrototypeArrow({ scene, view, node }: { scene: Scene; view: View; node: CanvasNode }) {
  const target = scene.get(node.prototype!.to);
  if (!target || target.deleted) return null;
  const from = worldBox(scene, node);
  const to = worldBox(scene, target);
  const start = toScreen(view, { x: from.x + from.width, y: from.y + from.height / 2 });
  const end = toScreen(view, { x: to.x, y: to.y + Math.min(24, to.height / 2) });
  const bend = Math.max(40, Math.abs(end.x - start.x) / 2);
  return (
    <g pointerEvents="none" className="text-accent" data-prototype-link={node.id}>
      <path d={`M${start.x} ${start.y}C${start.x + bend} ${start.y} ${end.x - bend} ${end.y} ${end.x} ${end.y}`} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx={start.x} cy={start.y} r={3.5} fill="currentColor" />
      <path d={`M${end.x} ${end.y}l-7 -4v8z`} fill="currentColor" />
    </g>
  );
}

function PathHandles({ node, at, scene, view }: { node: CanvasNode; at: number | null; scene: Scene; view: View }) {
  const anchors = anchorsOf(node, worldOrigin(scene, node));
  return (
    <g>
      {anchors.map((anchor) => {
        const point = toScreen(view, anchor.point);
        const handles = (["in", "out"] as const).filter((side) => anchor[side].x || anchor[side].y);
        return (
          <g key={anchor.at}>
            {handles.map((side) => {
              const handle = toScreen(view, { x: anchor.point.x + anchor[side].x, y: anchor.point.y + anchor[side].y });
              return (
                <g key={side}>
                  <line x1={point.x} y1={point.y} x2={handle.x} y2={handle.y} className="stroke-accent" strokeWidth={1} pointerEvents="none" />
                  <circle data-anchor={`${anchor.at}:${side}`} cx={handle.x} cy={handle.y} r={4} className="fill-white stroke-accent" strokeWidth={1.5} style={{ cursor: "move" }} />
                </g>
              );
            })}
            <rect data-anchor={`${anchor.at}:point`} x={point.x - 4} y={point.y - 4} width={8} height={8} rx={1}
              className={anchor.at === at ? "fill-accent stroke-accent" : "fill-white stroke-accent"} strokeWidth={1.5} style={{ cursor: "move" }}>
              <title>Drag to move; double-click to make it smooth or sharp</title>
            </rect>
          </g>
        );
      })}
    </g>
  );
}
