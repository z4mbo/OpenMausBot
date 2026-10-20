import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

// The Canvas and Pages tools of the agents catalog: definitions only, sent to the model on every turn.
export const CANVAS_TOOL_DEFINITIONS = [
  {
    name: "origin_canvas",
    description: "List an Origin project's design canvases, or read one (or one frame of it with node) as compact JSON: frames, shapes, text, images and their layout, editable with origin_canvas_edit." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; omit to list them." },
        node: { type: "string", maxLength: 100, description: "Read only this node and its children." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_canvas_edit",
    description: "Design on an Origin project's canvas: the people on it see each change live. ops run in order: {op:\"create\",parent?,node}, {op:\"update\",id,set}, {op:\"delete\",id}. A node is {type: frame|rect|ellipse|line|arrow|text|image|group|path, name, x, y (relative to its parent), w, h, fill, stroke, strokeWidth, radius, opacity, rotation, text, fontSize, fontWeight, align, font: sans|serif|mono, points [[x,y]], asset (an image asset's name), link (an https or mailto address it opens on a published page), key, children}. Frames take layout {direction: row|column, gap, padding, align: start|center|end|stretch, justify: start|center|end|between, hug: width|height|both}; children of a layout frame need no x, y, and grow:true shares its free space. leadForm {fields: [name, email, phone, message], button, accent} turns an empty frame into a signup form on the published page. Build a section as one frame, e.g. a 1440-wide column frame with hug height holding a heading and a row of cards. Read the canvas first to reuse its ids and style." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; optional when the project has one." },
        new_canvas: { type: "string", maxLength: 80, description: "Start a new canvas with this name and apply ops to it." },
        ops: { type: "array", minItems: 1, maxItems: 200, items: { type: "object" } },
        project: ORIGIN_PROJECT,
      },
      required: ["ops"],
    },
  },
  {
    name: "origin_page_publish",
    description: "Publish a top-level canvas frame as a public web page, or republish it after changes: auto-layout frames reflow on phones, and a leadForm frame files each signup as a Pipeline lead with the slug as its source. Returns the page's address." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        canvas: { type: "string", maxLength: 120, description: "Canvas name or id; optional when the project has one." },
        frame: { type: "string", maxLength: 120, description: "The frame's id or name." },
        slug: { type: "string", maxLength: 48, description: "The page's address, like waitlist. Default: from the title." },
        title: { type: "string", maxLength: 120, description: "Browser and link-preview title. Default: the frame's name." },
        description: { type: "string", maxLength: 300, description: "Search and link-preview summary. Default: the page's first paragraph." },
        project: ORIGIN_PROJECT,
      },
      required: ["frame"],
    },
  },
  {
    name: "origin_page_list",
    description: "List an Origin project's published pages with their addresses, views and the leads each one collected." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
];
