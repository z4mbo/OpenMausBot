import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

// The Canvas and Pages tools of the agents catalog: definitions only, sent to the model on every turn.
export const CANVAS_TOOL_DEFINITIONS = [
  {
    name: "origin_canvas",
    description: "List an Origin project's design canvases, or read one (or one frame of it with node) as compact JSON: frames, shapes, text, images, layout, pages, components and what people have selected, editable with origin_canvas_edit." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; omit to list them." },
        node: { type: "string", maxLength: 100, description: "Read only this node and its children." },
        selection: { type: "boolean", description: "Read only what people have selected right now." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_canvas_edit",
    description: "Design on an Origin project's canvas: the people on it see each change live. ops run in order: {op:\"create\",parent?,node}, {op:\"update\",id,set}, {op:\"delete\",id}. A node is {type: frame|rect|ellipse|line|arrow|text|image|group|path, name, x, y (relative to its parent), w, h, fill, stroke, strokeWidth, radius, opacity, rotation, text, fontSize, fontWeight, align, font: sans|serif|mono, points [[x,y]], asset (an image asset's name), link (an https or mailto address it opens on a published page), key, children}. Frames take layout {direction: row|column, gap, padding, align: start|center|end|stretch, justify: start|center|end|between, hug: width|height|both, wrap}; children of a layout frame need no x, y; grow:true shares its free space, absolute:true opts out, minW/maxW/minH/maxH bound it. Outside layout, constraints {h: left|right|center|stretch|scale, v: top|bottom|center|stretch|scale} follow a resized parent. component {set, props} makes a frame a component (variants share set); {op:\"instance\",component,parent?,key?,set} places a copy whose layers you update by id. fillStyle (primary, secondary, background, text, neutral-N) and textStyle (display, h1, h2, h3, body-lg, body, small, caption) bind to the brand kit; shadow {x,y,blur,color} and blur are allowed but keep designs flat. prototype {to: frame} links a click in Present mode. Paths take points with curves [inDx,inDy,outDx,outDy per point]. A group with boolean (union|subtract|intersect|exclude) draws its shapes combined, still editable. radii [tl,tr,br,bl] rounds corners apart; gradient {kind: linear|radial, angle, stops [{at,color}]} replaces the fill; images take imageFit cover|contain|stretch|crop|tile with crop {scale,x,y}. {op:\"design_system\"} builds a Design system frame from the brand kit: colour and text styles plus Button, Input, Card and Nav components. leadForm {fields: [name, email, phone, message], button, accent} turns an empty frame into a signup form on the published page. Build a section as one frame, e.g. a 1440-wide column frame with hug height holding a heading and a row of cards. Read the canvas first to reuse its ids and style." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; optional when the project has one." },
        new_canvas: { type: "string", maxLength: 80, description: "Start a new canvas with this name and apply ops to it." },
        ops: { type: "array", minItems: 1, maxItems: 200, items: { type: "object" } },
        page: { type: "string", maxLength: 40, description: "Page id for new top-level nodes; default the first page." },
        save_version: { type: "string", maxLength: 80, description: "Save a named version of the canvas before these changes." },
        project: ORIGIN_PROJECT,
      },
      required: ["ops"],
    },
  },
  {
    name: "origin_canvas_screenshot",
    description: "See a canvas frame or node (or the canvas's first page) as a PNG, to check your own design work." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; optional when the project has one." },
        node: { type: "string", maxLength: 120, description: "The frame or node id (or a frame's name); omit for the whole first page." },
        scale: { type: "number", minimum: 0.25, maximum: 2 },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_canvas_comment",
    description: "Read a canvas's comment threads, or comment as yourself: pinned to a node, or as a reply. Answer a comment that mentions you here." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; optional when the project has one." },
        text: { type: "string", maxLength: 4_000, description: "The comment; omit to read the threads." },
        node: { type: "string", maxLength: 100, description: "Pin the comment to this node." },
        reply_to: { type: "string", maxLength: 100, description: "The thread's comment id." },
        include_resolved: { type: "boolean" },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_design_submit",
    description: "Link the canvas frames that design an Origin issue to it: they show as Design on the issue, the issue key shows on each frame, your rationale is pinned on the canvas, and in review the project's Chief is asked to review. A Chief approves with status approved." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        issue_id: { type: "string", minLength: 1, maxLength: 64 },
        frames: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", maxLength: 120 }, description: "Frame ids or names." },
        rationale: { type: "string", maxLength: 3_000, description: "Why the design looks the way it does." },
        status: { type: "string", enum: ["draft", "review", "approved"], description: "Default review." },
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; optional when the project has one." },
        project: ORIGIN_PROJECT,
      },
      required: ["issue_id", "frames"],
    },
  },
];
