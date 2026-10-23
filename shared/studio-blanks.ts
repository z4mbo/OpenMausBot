import type { StudioModel } from "./studio.ts";

/**
 * One `[placeholder]` of a template prompt: the words a person replaces before generating. `[Label: default words]`
 * names it; `[default words]` is named by its words.
 */
export interface TemplateBlank {
  label: string;
  value: string;
  start: number;
  end: number;
}

const BLANK = /\[([^\]\n]{1,160})\]/g;
const NAMED = /^\s*([^:\]]{1,32}):\s?(.*)$/;

export function templateBlanks(prompt: string): TemplateBlank[] {
  return [...prompt.matchAll(BLANK)].map((match) => {
    const inner = match[1]!;
    const named = NAMED.exec(inner);
    return { label: named ? named[1]!.trim() : "", value: named ? named[2]! : inner, start: match.index, end: match.index + match[0].length };
  });
}

/** The prompt as sent: each blank becomes its filled value, or its own words without brackets. */
export function fillBlanks(prompt: string, values: readonly (string | undefined)[] = []): string {
  let index = 0;
  const filled = prompt.replace(BLANK, (whole: string) => {
    const blank = templateBlanks(whole)[0]!;
    const value = values[index]?.replace(/\s+/g, " ").trim();
    index += 1;
    return value || blank.value.trim();
  });
  return filled.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").trim();
}

/** The prompt with blank `index` set to `value`, still a blank; an emptied unnamed blank is named by its old words. */
export function setBlank(prompt: string, index: number, value: string): string {
  const blank = templateBlanks(prompt)[index];
  if (!blank) return prompt;
  const words = value.replace(/[[\]\n]/g, " ").slice(0, 160);
  const label = blank.label || (words.trim() ? "" : blank.value.replace(/:/g, " ").slice(0, 32).trim());
  return `${prompt.slice(0, blank.start)}[${label ? `${label}: ` : ""}${words}]${prompt.slice(blank.end)}`;
}

/** Values for each blank from names an agent knows: a blank's label, its default words, or its 1-based position. */
export function blankValues(prompt: string, named: Readonly<Record<string, string>>): (string | undefined)[] {
  const entries = Object.entries(named).map(([key, value]) => [key.trim().toLowerCase(), value] as const);
  return templateBlanks(prompt).map((blank, index) => entries.find(([key]) => key === blank.label.toLowerCase() || key === blank.value.trim().toLowerCase() || key === String(index + 1))?.[1]);
}

/** The prompt with `start`..`end` turned into a blank. */
export function markBlank(prompt: string, start: number, end: number, label = ""): string {
  const words = prompt.slice(start, end).replace(/[[\]\n]/g, " ").trim();
  if (!words) return prompt;
  const name = label.replace(/[:[\]\n]/g, " ").trim().slice(0, 32);
  return `${prompt.slice(0, start)}[${name ? `${name}: ` : ""}${words.slice(0, 120)}]${prompt.slice(end)}`;
}

/** ElevenLabs reads `[whispers]` and `[laughs]` as delivery tags, so a voice prompt has no blanks. */
export function promptTakesBlanks(model: StudioModel | undefined): boolean {
  return model?.family !== "tts";
}
