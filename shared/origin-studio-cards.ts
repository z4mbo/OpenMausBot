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

/** A project template as a tool showed it: opening it sets up Studio's prompt bar with its blanks. */
export interface OriginStudioCardTemplate {
  id: string;
  name: string;
  description: string;
  cover?: { url: string; kind: StudioMediaKind };
  /** What a person brings, such as Character and Motion video. */
  inputs: string[];
  /** The labels or default words of the prompt's `[placeholders]`. */
  blanks: string[];
}

/** A workflow run as a tool started it; the card follows its steps live while the app reaches the project. */
export interface OriginStudioCardRun {
  id: string;
  name: string;
  status: "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  outputs: Array<{ url: string; kind: StudioMediaKind; name: string }>;
}

/** What a Studio tool made, started or offered, drawn in chat as media tiles, template and run cards that open Studio. */
export interface OriginStudioCards {
  heading: string;
  projectId: string;
  generations?: OriginStudioCardGeneration[];
  /** STUDIO_PRESETS ids, shown with their preview images. */
  presets?: string[];
  templates?: OriginStudioCardTemplate[];
  runs?: OriginStudioCardRun[];
}

export const ORIGIN_STUDIO_CARDS_MAX = 8;
export const ORIGIN_STUDIO_PRESET_CARDS_MAX = 12;

/** The cards with their heading, prompts and errors passed through `change`, such as a secret scrubber. */
export function withStudioCardText(cards: OriginStudioCards, change: (text: string) => string): OriginStudioCards {
  return {
    ...cards, heading: change(cards.heading),
    ...(cards.generations ? { generations: cards.generations.map((generation) => ({ ...generation, prompt: change(generation.prompt), ...(generation.error === undefined ? {} : { error: change(generation.error) }) })) } : {}),
    ...(cards.templates ? { templates: cards.templates.map((template) => ({ ...template, name: change(template.name), description: change(template.description), blanks: template.blanks.map(change) })) } : {}),
    ...(cards.runs ? { runs: cards.runs.map((run) => ({ ...run, name: change(run.name), outputs: run.outputs.map((output) => ({ ...output, name: change(output.name) })) })) } : {}),
  };
}
