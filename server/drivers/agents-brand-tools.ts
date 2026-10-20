import { BRAND_FONT_IDS } from "../../shared/brand-fonts.ts";
import { BRAND_LIMITS } from "../../shared/brand-kit.ts";
import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

/** Appended to the tools that write copy, so drafts follow the project's voice. */
export const BRAND_VOICE = " Match the brand voice.";

const words = (count: number, max: number, description: string) => ({ type: "array", maxItems: count, items: { type: "string", maxLength: max }, description });
const hex = (description: string) => ({ type: "string", maxLength: 9, description });

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; additionalProperties: false; properties: Record<string, unknown>; required?: string[] };
}

export const BRAND_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "origin_brand_get",
    description: "Read an Origin project's brand kit: name, tagline, voice (adjectives, do and don't), colours with contrast checks, heading and body fonts, logo and icon assets and imagery style. Read it before you design, generate media or write copy." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_brand_update",
    description: "Draft or change an Origin project's brand kit; fields you leave out keep their value. Draft it from the project's description and brief; the team reviews it in Assets > Brand. Canvas, Pages, Studio, Broadcast and Pipeline all use it." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: BRAND_LIMITS.name },
        tagline: { type: "string", maxLength: BRAND_LIMITS.tagline },
        voice_adjectives: words(BRAND_LIMITS.adjectives, BRAND_LIMITS.word, "How the brand sounds, such as warm, precise."),
        voice_do: words(BRAND_LIMITS.rules, BRAND_LIMITS.line, "Writing rules to follow."),
        voice_dont: words(BRAND_LIMITS.rules, BRAND_LIMITS.line, "Writing habits to avoid."),
        primary: hex("Hex, such as #2563EB."),
        secondary: hex("Hex."),
        neutrals: { type: "array", minItems: 1, maxItems: BRAND_LIMITS.neutrals, items: { type: "string", maxLength: 9 }, description: "Hex; the lightest is the background, the darkest the text." },
        heading_font: { type: "string", enum: BRAND_FONT_IDS },
        body_font: { type: "string", enum: BRAND_FONT_IDS },
        logos: words(BRAND_LIMITS.logos, 200, "Image asset names or ids from origin_list_assets; [] removes them."),
        icon: { type: "string", maxLength: 200, description: "An image asset name or id; empty removes it." },
        imagery: words(BRAND_LIMITS.imagery, 40, "Style words for generated images and video, such as soft daylight, film grain."),
        project: ORIGIN_PROJECT,
      },
    },
  },
];
