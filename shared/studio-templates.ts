import { STUDIO_CAMERA_MOTIONS, studioModel, type StudioGeneration, type StudioMediaKind, type StudioMode, type StudioModel, type StudioParams } from "./studio.ts";
import { STUDIO_PRESETS, studioPresetModel, type StudioPreset, type StudioPresetGroup } from "./studio-presets.ts";
import { fillBlanks, promptTakesBlanks, templateBlanks } from "./studio-blanks.ts";

/** The settings a template carries, in StudioGenerateRequest's names. */
export const TEMPLATE_SETTINGS = ["aspectRatio", "duration", "resolution", "voice", "motion", "angle", "sound", "negativePrompt"] as const;

/** A row of studioTemplates as studioTemplates:list returns it: a generation the team saved to make again. */
export interface StudioTemplate {
  _id: string;
  projectId: string;
  name: string;
  description: string;
  mode: StudioMode;
  model: string;
  prompt: string;
  params: StudioParams;
  /** Example inputs for the model's `needs`, in order; each one is a slot a person may refill. */
  sources: Array<{ assetId: string; kind: StudioMediaKind; url: string | null; name: string }>;
  cover?: { url: string; kind: StudioMediaKind };
  generationId?: string;
  createdByName: string;
  agentName?: string;
  createdAt: number;
  updatedAt: number;
}

export const STUDIO_TEMPLATE_NAME_MAX = 80;
export const STUDIO_TEMPLATE_DESCRIPTION_MAX = 400;

/** The template a generation suggests: its model, prompt and settings, its starting files as example inputs. */
export function templateFromGeneration(row: Pick<StudioGeneration, "model" | "mode" | "prompt" | "aspectRatio" | "duration" | "params">): { model: string; mode: StudioMode; prompt: string; params: StudioParams } {
  const params: StudioParams = {};
  if (row.aspectRatio) params.aspectRatio = row.aspectRatio;
  if (row.duration) params.duration = row.duration;
  for (const key of TEMPLATE_SETTINGS) {
    const value = row.params?.[key];
    if (value !== undefined && params[key] === undefined) params[key] = value;
  }
  return { model: row.model, mode: row.mode, prompt: row.prompt, params };
}

/** A suggested name: the template's first few prompt words. */
export function templateName(prompt: string, fallback: string): string {
  const words = fillBlanks(prompt).replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  const name = words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : fallback;
  return name.slice(0, STUDIO_TEMPLATE_NAME_MAX);
}

/** What the Create gallery shows for a built-in preset or a project template alike. */
export interface TemplateCard {
  id: string;
  source: "preset" | "project";
  name: string;
  description: string;
  group: StudioPresetGroup | "project";
  model: StudioModel;
  prompt: string;
  blanks: number;
  /** What the person supplies, such as Character and Motion video. */
  inputs: string[];
  cover?: { url: string; kind: StudioMediaKind };
  by?: string;
}

export function modelInputs(model: StudioModel): string[] {
  return model.needs.map((kind, index) => model.inputLabels?.[index] ?? `${kind[0]!.toUpperCase()}${kind.slice(1)}${model.needs.filter((other) => other === kind).length > 1 ? ` ${index + 1}` : ""}`);
}

export function presetCard(preset: StudioPreset, image?: string): TemplateCard {
  const model = studioPresetModel(preset);
  return {
    id: preset.id, source: "preset", name: preset.label, description: preset.description, group: preset.group, model, prompt: preset.prompt ?? "",
    blanks: promptTakesBlanks(model) ? templateBlanks(preset.prompt ?? "").length : 0, inputs: modelInputs(model), ...(image ? { cover: { url: image, kind: "image" as const } } : {}),
  };
}

export function projectTemplateCard(template: StudioTemplate): TemplateCard | null {
  const model = studioModel(template.model);
  if (!model) return null;
  return {
    id: template._id, source: "project", name: template.name, description: template.description || settingsLine(model, template.params), group: "project", model, prompt: template.prompt,
    blanks: promptTakesBlanks(model) ? templateBlanks(template.prompt).length : 0, inputs: modelInputs(model), ...(template.cover ? { cover: template.cover } : {}),
    by: template.agentName ?? template.createdByName,
  };
}

/** The settings a template fixes, in a short line. */
export function settingsLine(model: StudioModel, params: StudioParams): string {
  const motion = STUDIO_CAMERA_MOTIONS.find((entry) => entry.id === params.motion)?.label;
  const duration = typeof params.duration === "string" ? (params.duration.endsWith("s") ? params.duration : `${params.duration}s`) : undefined;
  return [model.label, params.aspectRatio, duration, params.resolution, params.voice, motion].filter((value) => typeof value === "string" && value).join(" · ");
}

export function allPresetCards(image: (id: string) => string | undefined): TemplateCard[] {
  return STUDIO_PRESETS.map((preset) => presetCard(preset, image(preset.id)));
}
