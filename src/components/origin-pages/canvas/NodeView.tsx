import { memo, type ReactNode } from "react";
import { FONT_STACKS, fontStack, layoutText, type CanvasNode, type LeadForm, type Scene } from "../../../../shared/canvas-scene";
import { LEAD_FIELD_LABELS, LEAD_FORM_METRICS, arrowHead, leadFormColors, pathData } from "../../../../shared/canvas-page";
import { cornerRadii, gradientLine, gradientStops, imagePlacement, roundedRectPath, unevenCorners } from "../../../../shared/canvas-paint";
import { booleanGroupPath } from "../../../../shared/canvas-boolean-group";
import { measureText } from "./geometry";

export type RenderOptions = {
  index: ReadonlyMap<string | null, readonly CanvasNode[]>;
  images: ReadonlyMap<string, string>;
  interactive: boolean;
  editing?: string | null;
  prefix: string;
  /** Nodes whose subtree changed since the last render; the rest skip rendering. Absent: render everything. */
  dirty?: ReadonlySet<string>;
};

function GradientDef({ id, node }: { id: string; node: CanvasNode }) {
  const gradient = node.gradient!;
  const stops = gradientStops(gradient).map((stop, at) => <stop key={at} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity < 1 ? stop.opacity : undefined} />);
  if (gradient.kind === "radial") return <radialGradient id={id} cx={0.5} cy={0.5} r={0.5}>{stops}</radialGradient>;
  return <linearGradient id={id} gradientUnits="userSpaceOnUse" {...gradientLine(gradient, node.width, node.height)}>{stops}</linearGradient>;
}

/** The node's fill: its gradient (defined next to it under `id`) or its solid colour. */
const paint = (node: CanvasNode, id: string, fallback: string) => (node.gradient ? `url(#${id})` : node.fill ?? fallback);

function Box({ node, fill, hit, stroke }: { node: CanvasNode; fill: string; hit?: object; stroke?: object }) {
  const radii = cornerRadii(node);
  if (radii && unevenCorners(radii)) return <path {...hit} d={roundedRectPath(node.width, node.height, radii)} fill={fill} {...stroke} />;
  return <rect {...hit} width={node.width} height={node.height} rx={radii?.[0] || undefined} fill={fill} {...stroke} />;
}

function TextShape({ node, hiddenText, fill }: { node: CanvasNode; hiddenText: boolean; fill: string }) {
  const layout = layoutText(node, measureText);
  const size = node.fontSize ?? 16;
  const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start";
  const x = node.align === "center" ? node.width / 2 : node.align === "right" ? node.width : 0;
  return (
    <text x={x} fill={fill} fontSize={size} fontWeight={node.fontWeight} fontFamily={fontStack(node)} textAnchor={anchor}
      opacity={hiddenText ? 0 : undefined} style={{ whiteSpace: "pre" }}>
      {layout.lines.map((line, index) => (
        <tspan key={index} x={x} y={index * layout.lineHeight + layout.lineHeight / 2 + size * 0.35}>{line || " "}</tspan>
      ))}
    </text>
  );
}

function LeadFormPreview({ node, form, surface }: { node: CanvasNode; form: LeadForm; surface: string }) {
  const colors = leadFormColors(form, node.fill ?? surface);
  const { gap, radius } = LEAD_FORM_METRICS;
  let y = 0;
  const rows = form.fields.map((field) => {
    const height = field === "message" ? LEAD_FORM_METRICS.message : LEAD_FORM_METRICS.field;
    const row = { field, y, height };
    y += height + gap;
    return row;
  });
  const fontFamily = FONT_STACKS.sans;
  return (
    <g pointerEvents="none">
      {rows.map((row) => (
        <g key={row.field} transform={`translate(0 ${row.y})`}>
          <rect width={node.width} height={row.height} rx={radius} fill={colors.field} stroke={colors.border} />
          <text x={14} y={22} dominantBaseline="central" fontSize={16} fontFamily={fontFamily} fill={colors.placeholder}>{LEAD_FIELD_LABELS[row.field]}</text>
        </g>
      ))}
      <g transform={`translate(0 ${y})`}>
        <rect width={node.width} height={LEAD_FORM_METRICS.button} rx={radius} fill={colors.button} />
        <text x={node.width / 2} y={LEAD_FORM_METRICS.button / 2} dominantBaseline="central" textAnchor="middle" fontSize={16} fontWeight={600} fontFamily={fontFamily} fill={colors.buttonText}>{form.button}</text>
      </g>
    </g>
  );
}

function Shape({ node, options, surface }: { node: CanvasNode; options: RenderOptions; surface: string }): ReactNode {
  const stroke = node.stroke && node.strokeWidth > 0 ? { stroke: node.stroke, strokeWidth: node.strokeWidth } : {};
  const hit = options.interactive ? { "data-node-id": node.id } : {};
  const gradient = `${options.prefix}grad-${node.id}`;
  const empty = options.interactive ? "transparent" : "none";
  const defs = node.gradient ? <GradientDef id={gradient} node={node} /> : null;
  switch (node.type) {
    case "rect":
    case "frame":
      return (
        <>
          {defs}
          <Box node={node} hit={hit} fill={paint(node, gradient, empty)} stroke={stroke} />
          {node.leadForm && <LeadFormPreview node={node} form={node.leadForm} surface={surface} />}
        </>
      );
    case "ellipse":
      return <>{defs}<ellipse {...hit} cx={node.width / 2} cy={node.height / 2} rx={node.width / 2} ry={node.height / 2} fill={paint(node, gradient, empty)} {...stroke} /></>;
    case "text":
      return (
        <g {...hit}>
          {defs}
          {options.interactive && <rect width={Math.max(node.width, 4)} height={Math.max(node.height, 4)} fill="transparent" />}
          <TextShape node={node} hiddenText={options.editing === node.id} fill={paint(node, gradient, "transparent")} />
        </g>
      );
    case "group":
      return node.boolean ? <>{defs}<path {...hit} d={booleanGroupPath(node, options.index)} fill={paint(node, gradient, "none")} fillRule="evenodd" strokeLinejoin="round" {...stroke} /></> : null;
    case "line":
    case "arrow":
    case "path": {
      const points = node.points ?? [0, 0, node.width, node.height];
      const width = Math.max(node.strokeWidth, 0.5);
      const filled = node.type === "path" && node.closed && (node.fill || node.gradient);
      return (
        <g {...hit}>
          {defs}
          {options.interactive && <path d={pathData(points, node.closed, node.curves, node.breaks)} fill={node.type === "path" && node.closed ? "transparent" : "none"} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
          <path d={pathData(points, node.closed, node.curves, node.breaks)} fill={filled ? paint(node, gradient, "none") : "none"} fillRule="evenodd" stroke={node.stroke ?? "transparent"} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
          {node.type === "arrow" && points.length >= 4 && <path d={arrowHead(points, Math.max(8, width * 3.5))} fill={node.stroke ?? "transparent"} stroke={node.stroke ?? "transparent"} strokeWidth={width} strokeLinejoin="round" />}
        </g>
      );
    }
    case "image":
      return <ImageShape node={node} options={options} hit={hit} stroke={stroke} />;
    default:
      return null;
  }
}

function ImageShape({ node, options, hit, stroke }: { node: CanvasNode; options: RenderOptions; hit: object; stroke: object }) {
  const url = node.fileId ? options.images.get(node.fileId) : undefined;
  const clip = `${options.prefix}img-${node.id}`;
  const tile = `${options.prefix}tile-${node.id}`;
  const place = imagePlacement(node);
  const clipped = Boolean(cornerRadii(node)) || place.kind === "crop";
  return (
    <g {...hit}>
      {clipped && <clipPath id={clip}><Box node={node} fill="#000" /></clipPath>}
      {url && place.kind === "tile" && (
        <pattern id={tile} patternUnits="userSpaceOnUse" width={place.width} height={place.height}>
          <image href={url} width={place.width} height={place.height} preserveAspectRatio="xMidYMid slice" />
        </pattern>
      )}
      <g clipPath={clipped ? `url(#${clip})` : undefined}>
        <rect width={node.width} height={node.height} fill={!url ? node.fill ?? "#E5E7EB" : place.kind === "tile" ? `url(#${tile})` : "transparent"} />
        {url && place.kind === "fit" && <image href={url} width={node.width} height={node.height} preserveAspectRatio={place.preserve} />}
        {url && place.kind === "crop" && <image href={url} x={place.x} y={place.y} width={place.width} height={place.height} preserveAspectRatio="xMidYMid slice" />}
      </g>
      {"stroke" in stroke && <Box node={node} fill="none" stroke={stroke} />}
    </g>
  );
}

function Effects({ id, node }: { id: string; node: CanvasNode }) {
  const shadow = node.shadow;
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      {shadow && <feDropShadow dx={shadow.x} dy={shadow.y} stdDeviation={shadow.blur / 2} floodColor={shadow.color.slice(0, 7)} floodOpacity={shadow.color.length === 9 ? parseInt(shadow.color.slice(7), 16) / 255 : 1} />}
      {node.blur ? <feGaussianBlur stdDeviation={node.blur / 2} /> : null}
    </filter>
  );
}

type NodeProps = { node: CanvasNode; options: RenderOptions; surface?: string };

const unchanged = (before: NodeProps, after: NodeProps) => Boolean(after.options.dirty) && before.node === after.node && before.surface === after.surface
  && !after.options.dirty!.has(after.node.id) && before.options.images === after.options.images && before.options.editing === after.options.editing
  && before.options.interactive === after.options.interactive && before.options.prefix === after.options.prefix;

export const NodeView = memo(function NodeView({ node, options, surface = "#FFFFFF" }: NodeProps): ReactNode {
  if (node.hidden || node.deleted) return null;
  const children = node.leadForm ? [] : options.index.get(node.id) ?? [];
  const transform = `translate(${node.x} ${node.y})${node.rotation ? ` rotate(${node.rotation} ${node.width / 2} ${node.height / 2})` : ""}`;
  const clip = node.type === "frame" && node.clip ? `${options.prefix}clip-${node.id}` : null;
  const effect = node.shadow || node.blur ? `${options.prefix}fx-${node.id}` : null;
  return (
    <g transform={transform} opacity={node.opacity < 1 ? node.opacity : undefined} filter={effect ? `url(#${effect})` : undefined}>
      {effect && <Effects id={effect} node={node} />}
      <Shape node={node} options={options} surface={surface} />
      {children.length > 0 && (
        <>
          {clip && <clipPath id={clip}><Box node={node} fill="#000" /></clipPath>}
          <g clipPath={clip ? `url(#${clip})` : undefined} opacity={node.boolean ? 0 : undefined}>
            {children.map((child) => <NodeView key={child.id} node={child} options={options} surface={node.fill ?? surface} />)}
          </g>
        </>
      )}
    </g>
  );
}, unchanged);

export const SceneLayer = memo(function SceneLayer({ options }: { options: RenderOptions }) {
  return <>{(options.index.get(null) ?? []).map((node) => <NodeView key={node.id} node={node} options={options} />)}</>;
});

/** The nodes whose own object or subtree differs between two scenes, with their ancestors. */
export function changedSubtrees(before: Scene, after: Scene): Set<string> {
  const dirty = new Set<string>();
  const mark = (id: string | null | undefined, scene: Scene) => {
    let current = id;
    while (current && !dirty.has(current)) { dirty.add(current); current = scene.get(current)?.parentId; }
  };
  for (const [id, node] of after) {
    const old = before.get(id);
    if (old === node) continue;
    mark(id, after);
    if (old) mark(old.parentId, before);
  }
  for (const [id, node] of before) if (!after.has(id)) mark(node.parentId, before);
  return dirty;
}
