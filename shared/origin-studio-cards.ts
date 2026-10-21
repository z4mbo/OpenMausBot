import type { StudioMediaKind, StudioStatus } from "./studio.ts";

/** One generation as an Origin Studio tool showed it in chat; the card follows it live while the app reaches the project. */
export interface OriginStudioCardGeneration {
  id: string;
  status: StudioStatus;
  modelLabel: string;
  kind: StudioMediaKind;
  prompt: string;
  outputs: Array<{ url: string; kind: StudioMediaKind }>;
  error?: string;
}

/** What a Studio tool made, started or offered, drawn in chat as media tiles and preset cards that open Studio. */
export interface OriginStudioCards {
  heading: string;
  projectId: string;
  generations?: OriginStudioCardGeneration[];
  /** STUDIO_PRESETS ids, shown with their preview images. */
  presets?: string[];
}

export const ORIGIN_STUDIO_CARDS_MAX = 8;
export const ORIGIN_STUDIO_PRESET_CARDS_MAX = 12;

/** The cards with their heading, prompts and errors passed through `change`, such as a secret scrubber. */
export function withStudioCardText(cards: OriginStudioCards, change: (text: string) => string): OriginStudioCards {
  return {
    ...cards, heading: change(cards.heading),
    ...(cards.generations ? { generations: cards.generations.map((generation) => ({ ...generation, prompt: change(generation.prompt), ...(generation.error === undefined ? {} : { error: change(generation.error) }) })) } : {}),
  };
}
