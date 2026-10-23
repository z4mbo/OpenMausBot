import { type PointerEvent as ReactPointerEvent } from "react";
import { portColor } from "./WorkflowNodeCard";
import { NODE_WIDTH, type View } from "./workflow-geometry";
import { estimatedNodeHeight, workflowNodeModel, type StudioRunNode, type StudioWorkflowGraph } from "../../../shared/studio-workflow";

const WIDTH = 168;
const HEIGHT = 108;

/** The whole graph in a corner with the visible area outlined; a click or drag there moves the view. */
export function WorkflowMinimap({ graph, view, size, heights, states, onView }: {
  graph: StudioWorkflowGraph; view: View; size: { width: number; height: number }; heights: ReadonlyMap<string, number>;
  states: ReadonlyMap<string, StudioRunNode>; onView(view: View): void;
}) {
  if (graph.nodes.length < 2 || !size.width) return null;
  const height = (id: string) => heights.get(id) ?? estimatedNodeHeight(graph.nodes.find((entry) => entry.id === id)!);
  const seen = { left: -view.x / view.zoom, top: -view.y / view.zoom, right: (size.width - view.x) / view.zoom, bottom: (size.height - view.y) / view.zoom };
  const left = Math.min(seen.left, ...graph.nodes.map((entry) => entry.x)) - 40;
  const top = Math.min(seen.top, ...graph.nodes.map((entry) => entry.y)) - 40;
  const right = Math.max(seen.right, ...graph.nodes.map((entry) => entry.x + NODE_WIDTH)) + 40;
  const bottom = Math.max(seen.bottom, ...graph.nodes.map((entry) => entry.y + height(entry.id))) + 40;
  const scale = Math.min(WIDTH / (right - left), HEIGHT / (bottom - top));
  const at = (x: number, y: number) => ({ x: (x - left) * scale, y: (y - top) * scale });
  const jump = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.type === "pointermove" && !event.buttons) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / scale + left;
    const y = (event.clientY - box.top) / scale + top;
    onView({ ...view, x: size.width / 2 - x * view.zoom, y: size.height / 2 - y * view.zoom });
  };
  const frame = at(seen.left, seen.top);
  return (
    <div className="absolute bottom-12 right-2 hidden overflow-hidden rounded-lg border border-hairline/40 bg-panel/90 p-1 backdrop-blur-sm sm:block" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} data-workflow-minimap>
      <svg width={WIDTH} height={HEIGHT} className="block cursor-pointer touch-none" onPointerDown={jump} onPointerMove={jump} role="img" aria-label="Map of the workflow">
        {graph.nodes.map((entry) => {
          const corner = at(entry.x, entry.y);
          const kind = entry.type === "prompt" ? "text" : entry.type === "output" ? "any" : entry.type === "asset" ? String(entry.params.kind || "image") : workflowNodeModel(entry)?.kind ?? "any";
          const status = states.get(entry.id)?.status;
          return (
            <rect key={entry.id} x={corner.x} y={corner.y} width={NODE_WIDTH * scale} height={height(entry.id) * scale} rx={2}
              fill={status === "failed" ? "var(--color-danger)" : portColor(kind as "text" | "image" | "video" | "audio" | "any")} fillOpacity={status === "running" ? 0.9 : 0.45} />
          );
        })}
        <rect x={frame.x} y={frame.y} width={(seen.right - seen.left) * scale} height={(seen.bottom - seen.top) * scale} fill="none" stroke="var(--color-ink-secondary)" strokeWidth={1} rx={2} />
      </svg>
    </div>
  );
}
