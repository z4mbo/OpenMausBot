/** What a project canvas is for: a Figma-like design file, a freehand whiteboard, or a presentation of 16:9 slides. */
export const CANVAS_KINDS = ["design", "board", "deck"] as const;
export type CanvasKind = (typeof CANVAS_KINDS)[number];

export const canvasKind = (value: unknown): CanvasKind => ((CANVAS_KINDS as readonly unknown[]).includes(value) ? value as CanvasKind : "design");

/** Frames an Origin canvas tool made, changed, shot or submitted, drawn in chat as live thumbnails that open the canvas in Design. */
export interface OriginDesignCard {
  heading: string;
  projectId: string;
  teamId: string;
  canvasId: string;
  canvasName: string;
  /** Absent on cards from before boards and presentations, which were all design files. */
  kind?: CanvasKind;
  /** Top-level frames (slides, for a presentation), at most ORIGIN_DESIGN_FRAMES_MAX; the first is the one the card opens on. A board's card has none and shows the whole board. */
  frames: { id: string; name: string }[];
  /** The issue a submitted design is linked to, as ORI-XXXX. */
  issueKey?: string;
}

export const ORIGIN_DESIGN_FRAMES_MAX = 4;
