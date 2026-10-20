import { workflowPorts, type StudioWorkflowGraph, type StudioWorkflowNode } from "../../../shared/studio-workflow";

export const NODE_WIDTH = 248;
export const NODE_HEADER = 36;
export const PORT_ROW = 26;

export interface Point {
  x: number;
  y: number;
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

/** Where a port's handle sits in graph space: inputs on the node's left edge, outputs on its right, one row each. */
export function portPoint(node: StudioWorkflowNode, side: "in" | "out", portId: string): Point {
  const ports = workflowPorts(node);
  const list = side === "in" ? ports.inputs : ports.outputs;
  const index = Math.max(0, list.findIndex((port) => port.id === portId));
  return { x: side === "in" ? node.x : node.x + NODE_WIDTH, y: node.y + NODE_HEADER + PORT_ROW * index + PORT_ROW / 2 };
}

/** A horizontal S-curve from an output to an input. */
export function edgePath(from: Point, to: Point): string {
  const bend = Math.max(48, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

export function clampZoom(zoom: number): number {
  return Math.min(1.6, Math.max(0.35, zoom));
}

/** The view that shows every node inside a viewport, with a margin. */
export function fitView(graph: StudioWorkflowGraph, width: number, height: number, heights: ReadonlyMap<string, number> = new Map()): View {
  if (!graph.nodes.length || width <= 0 || height <= 0) return { x: 24, y: 24, zoom: 1 };
  const left = Math.min(...graph.nodes.map((node) => node.x));
  const top = Math.min(...graph.nodes.map((node) => node.y));
  const right = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH));
  const bottom = Math.max(...graph.nodes.map((node) => node.y + (heights.get(node.id) ?? 180)));
  const margin = 32;
  const zoom = clampZoom(Math.min((width - margin * 2) / (right - left), (height - margin * 2) / (bottom - top), 1));
  return { zoom, x: (width - (right - left) * zoom) / 2 - left * zoom, y: Math.max(margin, (height - (bottom - top) * zoom) / 2) - top * zoom };
}

/** Graph coordinates of a point on screen, relative to the canvas's top-left corner. */
export function toGraph(point: Point, view: View): Point {
  return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
}

/** Zooms about a screen point, keeping that point fixed. */
export function zoomAt(view: View, point: Point, factor: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const scale = zoom / view.zoom;
  return { zoom, x: point.x - (point.x - view.x) * scale, y: point.y - (point.y - view.y) * scale };
}

let counter = 0;
export function newNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36).slice(-5)}${counter.toString(36)}`;
}
