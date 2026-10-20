import type { CanvasNode, Scene } from "../../../../shared/canvas-scene";
import { corners, toScreen, worldBox, type Box, type Guide, type Point, type View } from "./geometry";

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

export type RemoteCursor = { userId: string; name: string; x: number; y: number; color: string };

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
};

export function Overlay({ scene, index, view, selected, hover, guides, marquee, cursors, editing, readOnly, busy }: OverlayProps) {
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
      {roots.map((node) => {
        if (node.type !== "frame" || node.hidden || node.deleted) return null;
        const position = toScreen(view, { x: node.x, y: node.y });
        const chosen = selected.some((item) => item.id === node.id);
        return (
          <text key={node.id} data-frame-label={node.id} x={position.x} y={position.y - 6} fontSize={11} className={chosen ? "fill-accent-text" : "fill-ink-secondary"}
            style={{ cursor: "default", userSelect: "none" }}>
            {node.name.length > 60 ? `${node.name.slice(0, 60)}…` : node.name}
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
      {cursors.map((cursor) => {
        const point = toScreen(view, cursor);
        return (
          <g key={cursor.userId} transform={`translate(${point.x} ${point.y})`} pointerEvents="none" className="transition-transform duration-150 ease-out motion-reduce:transition-none">
            <path d="M0 0L0 14L4 10.5L7 17L9.5 16L6.6 9.6L11.5 9.6Z" fill={cursor.color} stroke="#101214" strokeWidth={1} />
            <rect x={12} y={14} width={cursor.name.length * 6.4 + 12} height={18} rx={9} fill={cursor.color} />
            <text x={18} y={27} fontSize={11} fontWeight={500} fill="#101214">{cursor.name}</text>
          </g>
        );
      })}
    </g>
  );
}
