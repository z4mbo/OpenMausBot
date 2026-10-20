import { memo, type ReactNode } from "react";
import { FONT_STACKS, layoutText, type CanvasNode } from "../../../../shared/canvas-scene";
import { measureText } from "./geometry";

export type RenderOptions = {
  index: ReadonlyMap<string | null, readonly CanvasNode[]>;
  images: ReadonlyMap<string, string>;
  interactive: boolean;
  editing?: string | null;
  prefix: string;
};

function pairs(points: readonly number[]) {
  const out: [number, number][] = [];
  for (let index = 0; index + 1 < points.length; index += 2) out.push([points[index], points[index + 1]]);
  return out;
}

function arrowHead(points: readonly number[], size: number): string {
  const list = pairs(points);
  const [x2, y2] = list[list.length - 1];
  let [x1, y1] = list[list.length - 2];
  for (let index = list.length - 2; index >= 0 && x1 === x2 && y1 === y2; index--) [x1, y1] = list[index];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  const a = { x: x2 - size * Math.cos(angle - spread), y: y2 - size * Math.sin(angle - spread) };
  const b = { x: x2 - size * Math.cos(angle + spread), y: y2 - size * Math.sin(angle + spread) };
  return `M${x2} ${y2}L${a.x} ${a.y}L${b.x} ${b.y}Z`;
}

const pathData = (points: readonly number[], closed?: boolean) =>
  pairs(points).map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join("") + (closed ? "Z" : "");

function TextShape({ node, hiddenText }: { node: CanvasNode; hiddenText: boolean }) {
  const layout = layoutText(node, measureText);
  const size = node.fontSize ?? 16;
  const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
  const x = node.align === "center" ? node.width / 2 : node.align === "right" ? node.width : 0;
  return (
    <text x={x} fill={node.fill ?? "transparent"} fontSize={size} fontWeight={node.fontWeight} fontFamily={FONT_STACKS[node.font ?? "sans"]} textAnchor={anchor}
      opacity={hiddenText ? 0 : undefined} style={{ whiteSpace: "pre" }}>
      {layout.lines.map((line, index) => (
        <tspan key={index} x={x} y={index * layout.lineHeight + layout.lineHeight / 2 + size * 0.35}>{line || " "}</tspan>
      ))}
    </text>
  );
}

function Shape({ node, options }: { node: CanvasNode; options: RenderOptions }): ReactNode {
  const stroke = node.stroke && node.strokeWidth > 0 ? { stroke: node.stroke, strokeWidth: node.strokeWidth } : {};
  const radius = Math.min(node.radius, node.width / 2, node.height / 2);
  const hit = options.interactive ? { "data-node-id": node.id } : {};
  switch (node.type) {
    case "rect":
    case "frame":
      return <rect {...hit} width={node.width} height={node.height} rx={radius || undefined} fill={node.fill ?? (options.interactive ? "transparent" : "none")} {...stroke} />;
    case "ellipse":
      return <ellipse {...hit} cx={node.width / 2} cy={node.height / 2} rx={node.width / 2} ry={node.height / 2} fill={node.fill ?? (options.interactive ? "transparent" : "none")} {...stroke} />;
    case "text":
      return (
        <g {...hit}>
          {options.interactive && <rect width={Math.max(node.width, 4)} height={Math.max(node.height, 4)} fill="transparent" />}
          <TextShape node={node} hiddenText={options.editing === node.id} />
        </g>
      );
    case "line":
    case "arrow":
    case "path": {
      const points = node.points ?? [0, 0, node.width, node.height];
      const width = Math.max(node.strokeWidth, 0.5);
      return (
        <g {...hit}>
          {options.interactive && <path d={pathData(points, node.closed)} fill="none" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
          <path d={pathData(points, node.closed)} fill={node.type === "path" && node.closed && node.fill ? node.fill : "none"} stroke={node.stroke ?? "transparent"} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
          {node.type === "arrow" && points.length >= 4 && <path d={arrowHead(points, Math.max(8, width * 3.5))} fill={node.stroke ?? "transparent"} stroke={node.stroke ?? "transparent"} strokeWidth={width} strokeLinejoin="round" />}
        </g>
      );
    }
    case "image": {
      const url = node.fileId ? options.images.get(node.fileId) : undefined;
      const clip = `${options.prefix}img-${node.id}`;
      return (
        <g {...hit}>
          {radius > 0 && <clipPath id={clip}><rect width={node.width} height={node.height} rx={radius} /></clipPath>}
          <g clipPath={radius > 0 ? `url(#${clip})` : undefined}>
            <rect width={node.width} height={node.height} fill={url ? "transparent" : node.fill ?? "#E5E7EB"} />
            {url && <image href={url} width={node.width} height={node.height} preserveAspectRatio={node.imageFit === "contain" ? "xMidYMid meet" : "xMidYMid slice"} />}
          </g>
          {stroke.stroke && <rect width={node.width} height={node.height} rx={radius || undefined} fill="none" {...stroke} />}
        </g>
      );
    }
    default:
      return null;
  }
}

export function NodeView({ node, options }: { node: CanvasNode; options: RenderOptions }): ReactNode {
  if (node.hidden || node.deleted) return null;
  const children = options.index.get(node.id) ?? [];
  const transform = `translate(${node.x} ${node.y})${node.rotation ? ` rotate(${node.rotation} ${node.width / 2} ${node.height / 2})` : ""}`;
  const clip = node.type === "frame" && node.clip ? `${options.prefix}clip-${node.id}` : null;
  const radius = Math.min(node.radius, node.width / 2, node.height / 2);
  return (
    <g transform={transform} opacity={node.opacity < 1 ? node.opacity : undefined}>
      {node.type !== "group" && <Shape node={node} options={options} />}
      {children.length > 0 && (
        <>
          {clip && <clipPath id={clip}><rect width={node.width} height={node.height} rx={radius || undefined} /></clipPath>}
          <g clipPath={clip ? `url(#${clip})` : undefined}>
            {children.map((child) => <NodeView key={child.id} node={child} options={options} />)}
          </g>
        </>
      )}
    </g>
  );
}

export const SceneLayer = memo(function SceneLayer({ options }: { options: RenderOptions }) {
  return <>{(options.index.get(null) ?? []).map((node) => <NodeView key={node.id} node={node} options={options} />)}</>;
});
