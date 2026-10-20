/** Frames an Origin canvas tool made, changed, shot or submitted, drawn in chat as live thumbnails that open the canvas in Studio's Design mode. */
export interface OriginDesignCard {
  heading: string;
  projectId: string;
  teamId: string;
  canvasId: string;
  canvasName: string;
  /** Top-level frames, at most ORIGIN_DESIGN_FRAMES_MAX; the first is the one the card opens on. */
  frames: { id: string; name: string }[];
  /** The issue a submitted design is linked to, as ORI-XXXX. */
  issueKey?: string;
}

export const ORIGIN_DESIGN_FRAMES_MAX = 4;
