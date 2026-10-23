import { studioModel, type StudioModel } from "../shared/studio.ts";
import { blankValues, fillBlanks, promptTakesBlanks } from "../shared/studio-blanks.ts";
import {
  STUDIO_PRESET_GROUPS, STUDIO_PRESETS, studioPreset, studioPresetModel, type StudioPreset,
} from "../shared/studio-presets.ts";
import { ORIGIN_STUDIO_PRESET_CARDS_MAX } from "../shared/origin-studio-cards.ts";
import { clip, record, refuse, text } from "./origin-studio.ts";

export function presetSources(model: StudioModel): string {
  if (!model.needs.length) return "none";
  return model.needs.map((kind, index) => {
    const label = model.inputLabels?.[index];
    return label && label.toLowerCase() !== kind ? `${label} (${kind})` : kind;
  }).join(" then ");
}

function presetLine(preset: StudioPreset): string {
  const model = studioPresetModel(preset);
  const settings = [
    preset.aspectRatio && `aspect ${preset.aspectRatio}`, preset.duration && `duration ${preset.duration}`, preset.resolution && `resolution ${preset.resolution}`,
    preset.motion && `camera_motion ${preset.motion}`, preset.angle && `camera_angle ${preset.angle}`, preset.sound === false && "no sound",
  ].filter(Boolean);
  const prompt = preset.prompt ? `prompt "${preset.prompt}"` : model.prompt === "none" ? "no prompt" : `prompt ${model.prompt}`;
  return `- ${preset.id} "${preset.label}": ${preset.description} · ${model.label} (${model.mode}) · sources: ${presetSources(model)}${settings.length ? ` · ${settings.join(", ")}` : ""} · ${prompt}`;
}

function presetsAcrossGroups(presets: readonly StudioPreset[]): string[] {
  const queues = STUDIO_PRESET_GROUPS.map((group) => presets.filter((preset) => preset.group === group.value));
  const ids: string[] = [];
  for (let round = 0; ids.length < ORIGIN_STUDIO_PRESET_CARDS_MAX && queues.some((queue) => queue.length > round); round += 1) {
    for (const queue of queues) if (queue[round] && ids.length < ORIGIN_STUDIO_PRESET_CARDS_MAX) ids.push(queue[round]!.id);
  }
  return ids;
}

export function presetList(group: unknown): { text: string; ids: string[] } {
  const wanted = text(group);
  if (wanted && !STUDIO_PRESET_GROUPS.some((entry) => entry.value === wanted)) refuse(`group must be ${STUDIO_PRESET_GROUPS.map((entry) => entry.value).join(", ")}.`);
  const groups = STUDIO_PRESET_GROUPS.filter((entry) => !wanted || entry.value === wanted);
  const lines = [
    "Studio presets: ready-made effects. Pass the id as preset to origin_studio_generate with the sources it lists, in that order (asset ids or generation ids). Your prompt replaces the preset's; [bracketed] words are the part to rewrite.",
  ];
  for (const entry of groups) lines.push(`${entry.label}:`, ...STUDIO_PRESETS.filter((preset) => preset.group === entry.value).map(presetLine));
  const shown = STUDIO_PRESETS.filter((preset) => groups.some((entry) => entry.value === preset.group));
  return { text: lines.join("\n"), ids: wanted ? shown.slice(0, ORIGIN_STUDIO_PRESET_CARDS_MAX).map((preset) => preset.id) : presetsAcrossGroups(shown) };
}

/** origin_studio_generate's arguments with a preset's model and settings filling whatever the agent left out. */
export function withPreset(args: Record<string, unknown>): Record<string, unknown> {
  const id = text(args.preset);
  if (!id) return args;
  const preset = studioPreset(id) ?? refuse(`No Studio preset ${clip(id, 64)}; list them with origin_studio_presets.`);
  const model = text(args.model) || preset.model;
  const template = preset.prompt ?? "";
  const fill = Object.fromEntries(Object.entries(record(args.fill)).map(([key, value]) => [key, text(value)]));
  const written = promptTakesBlanks(studioModel(model)) ? fillBlanks(template, blankValues(template, fill)) : template;
  const filled: Record<string, unknown> = { ...args, model, prompt: text(args.prompt).trim() ? args.prompt : written };
  const defaults: Record<string, unknown> = {
    mode: studioModel(model)?.mode, aspect_ratio: preset.aspectRatio, duration: preset.duration, resolution: preset.resolution,
    camera_motion: preset.motion, camera_angle: preset.angle, sound: preset.sound,
  };
  for (const [key, value] of Object.entries(defaults)) if (filled[key] === undefined && value !== undefined) filled[key] = value;
  return filled;
}
