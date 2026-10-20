export type StudioMode = "image" | "video" | "audio" | "edit";
export type StudioMediaKind = "image" | "video" | "audio";
export type StudioStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type Family =
  | "nano" | "flux3" | "imageSize" | "veo" | "kling" | "seedance" | "tts" | "music" | "sfx" | "nanoEdit" | "fluxEdit" | "upscale"
  | "videoUpscale" | "removeBg" | "avatar" | "lipsync" | "extend" | "mergeAudio" | "mergeVideos" | "custom"
  | "motionControl" | "wanAnimate" | "videoEdit" | "relight" | "tryOn" | "angles" | "styleRef" | "productShot" | "videoBg";

/** One fal.ai endpoint Studio offers; fields checked against fal's OpenAPI schemas on 2026-10-20. */
export interface StudioModel {
  id: string;
  /** The fal endpoint, when two Studio models share one with different inputs. */
  endpoint?: string;
  label: string;
  description: string;
  mode: StudioMode;
  kind: StudioMediaKind;
  family: Family;
  /** The media it starts from, in order, beside the prompt. */
  needs: readonly StudioMediaKind[];
  /** What each of `needs` is for, such as Character and Motion video, when the kind alone does not say. */
  inputLabels?: readonly string[];
  prompt: "required" | "optional" | "none";
  aspectRatios?: readonly string[];
  durations?: readonly string[];
  resolutions?: readonly string[];
  voices?: readonly string[];
  seed?: boolean;
  negative?: boolean;
  /** Reference images it accepts, sent through `referenceModel`. */
  references?: number;
  referenceModel?: string;
  /** Has fal's generate_audio switch. */
  sound?: boolean;
  /** Takes a camera-motion preset, written into the prompt. */
  motion?: boolean;
  /** Takes a STUDIO_CAMERA_ANGLES id: the same subject seen from another viewpoint. */
  angles?: boolean;
  /** Typical seconds from start to result, until the project has its own history. */
  eta: number;
  /** The largest batch one prompt may ask for. */
  maxCount: number;
}

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const WIDE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3"] as const;
const SIZE_FOR_RATIO: Record<string, string> = { "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "3:4": "portrait_4_3" };

/** ElevenLabs' premade voices fal accepts by name, with how each sounds. */
export const STUDIO_VOICES: readonly { name: string; tone: string }[] = [
  { name: "Rachel", tone: "Calm · American woman" }, { name: "Aria", tone: "Husky · American woman" }, { name: "Roger", tone: "Confident · American man" },
  { name: "Sarah", tone: "Soft · young American woman" }, { name: "Laura", tone: "Upbeat · young American woman" }, { name: "Charlie", tone: "Natural · Australian man" },
  { name: "George", tone: "Warm · British man" }, { name: "Callum", tone: "Intense · transatlantic man" }, { name: "River", tone: "Relaxed · neutral" },
  { name: "Liam", tone: "Articulate · young American man" }, { name: "Charlotte", tone: "Smooth · Swedish woman" }, { name: "Alice", tone: "Confident · British woman" },
  { name: "Matilda", tone: "Friendly · American woman" }, { name: "Will", tone: "Friendly · young American man" }, { name: "Jessica", tone: "Expressive · young American woman" },
  { name: "Eric", tone: "Smooth · American man" }, { name: "Chris", tone: "Casual · American man" }, { name: "Brian", tone: "Deep · American man" },
  { name: "Daniel", tone: "Authoritative · British man" }, { name: "Lily", tone: "Warm · British woman" }, { name: "Bill", tone: "Trustworthy · older American man" },
];
const VOICES = STUDIO_VOICES.map((voice) => voice.name);

/** Camera moves a video prompt can end with. */
export const STUDIO_CAMERA_MOTIONS: readonly { id: string; label: string; phrase: string }[] = [
  { id: "static", label: "Static", phrase: "locked-off static camera" },
  { id: "dolly-in", label: "Dolly in", phrase: "slow dolly in towards the subject" },
  { id: "dolly-out", label: "Dolly out", phrase: "slow dolly out revealing the scene" },
  { id: "pan-left", label: "Pan left", phrase: "smooth pan to the left" },
  { id: "pan-right", label: "Pan right", phrase: "smooth pan to the right" },
  { id: "orbit", label: "Orbit", phrase: "camera orbits around the subject" },
  { id: "crane-up", label: "Crane up", phrase: "crane shot rising upwards" },
  { id: "handheld", label: "Handheld", phrase: "handheld camera with natural shake" },
  { id: "fpv", label: "FPV drone", phrase: "fast FPV drone flythrough" },
  { id: "zoom-in", label: "Crash zoom", phrase: "quick crash zoom in" },
];

/** Viewpoints a multiple-angles model re-renders a subject from, as fal's azimuth, elevation and zoom. */
export const STUDIO_CAMERA_ANGLES: readonly { id: string; label: string; horizontal: number; vertical: number; zoom: number }[] = [
  { id: "three-quarter-right", label: "¾ right", horizontal: 45, vertical: 0, zoom: 5 },
  { id: "right", label: "Right side", horizontal: 90, vertical: 0, zoom: 5 },
  { id: "back", label: "Back", horizontal: 180, vertical: 0, zoom: 5 },
  { id: "left", label: "Left side", horizontal: 270, vertical: 0, zoom: 5 },
  { id: "three-quarter-left", label: "¾ left", horizontal: 315, vertical: 0, zoom: 5 },
  { id: "high", label: "High angle", horizontal: 0, vertical: 60, zoom: 5 },
  { id: "top", label: "Bird's-eye", horizontal: 0, vertical: 90, zoom: 4 },
  { id: "low", label: "Low angle", horizontal: 0, vertical: -30, zoom: 5 },
  { id: "close", label: "Close-up", horizontal: 0, vertical: 0, zoom: 9 },
  { id: "wide", label: "Wide shot", horizontal: 0, vertical: 0, zoom: 1 },
];

/** The endpoint id a custom generation uses: any fal.ai model or deployed workflow, such as a ComfyUI one. */
export const STUDIO_CUSTOM_MODEL = "custom";
/** fal's OpenRouter proxy; Studio's prompt enhancer asks its cheapest fast model. */
export const STUDIO_ENHANCER = { endpoint: "fal-ai/any-llm", model: "google/gemini-2.5-flash-lite" } as const;

const none = [] as const;
const image = ["image"] as const;
const video = ["video"] as const;

export const STUDIO_MODELS: readonly StudioModel[] = [
  { id: "fal-ai/nano-banana-pro", label: "Nano Banana Pro", description: "Google's sharpest image model: text in images, layouts, product shots.", mode: "image", kind: "image", family: "nano", needs: none, prompt: "required", aspectRatios: WIDE_RATIOS, resolutions: ["1K", "2K", "4K"], seed: true, references: 4, referenceModel: "fal-ai/nano-banana-pro/edit", eta: 25, maxCount: 4 },
  { id: "blackforestlabs/flux-3/text-to-image", label: "FLUX 3", description: "Black Forest Labs' newest: photoreal detail and faithful prompts.", mode: "image", kind: "image", family: "flux3", needs: none, prompt: "required", aspectRatios: WIDE_RATIOS, resolutions: ["1k", "2k", "4k"], eta: 15, maxCount: 4 },
  { id: "fal-ai/flux-2-pro", label: "FLUX.2 Pro", description: "Polished photography and illustration; takes reference images.", mode: "image", kind: "image", family: "imageSize", needs: none, prompt: "required", aspectRatios: IMAGE_RATIOS, seed: true, references: 4, referenceModel: "fal-ai/flux-2-pro/edit", eta: 12, maxCount: 4 },
  { id: "fal-ai/krea-2/turbo", label: "Krea 2 Turbo", description: "Fast, aesthetic stills with natural light.", mode: "image", kind: "image", family: "imageSize", needs: none, prompt: "required", aspectRatios: IMAGE_RATIOS, seed: true, eta: 8, maxCount: 4 },
  { id: "fal-ai/flux/schnell", label: "FLUX.1 schnell", description: "Drafts in about three seconds for pennies.", mode: "image", kind: "image", family: "imageSize", needs: none, prompt: "required", aspectRatios: IMAGE_RATIOS, seed: true, eta: 4, maxCount: 4 },
  { id: "fal-ai/krea-2/turbo/style", label: "Krea 2 · style match", description: "New images in the look of a style reference.", mode: "image", kind: "image", family: "styleRef", needs: image, inputLabels: ["Style"], prompt: "required", aspectRatios: IMAGE_RATIOS, seed: true, eta: 10, maxCount: 4 },
  { id: "fal-ai/veo3.1", label: "Veo 3.1", description: "Cinematic video with synced sound and dialogue.", mode: "video", kind: "video", family: "veo", needs: none, prompt: "required", aspectRatios: ["16:9", "9:16"], durations: ["4s", "6s", "8s"], resolutions: ["720p", "1080p", "4k"], seed: true, negative: true, sound: true, motion: true, eta: 120, maxCount: 2 },
  { id: "fal-ai/veo3.1/fast", label: "Veo 3.1 Fast", description: "Veo at half the wait and cost.", mode: "video", kind: "video", family: "veo", needs: none, prompt: "required", aspectRatios: ["16:9", "9:16"], durations: ["4s", "6s", "8s"], resolutions: ["720p", "1080p", "4k"], seed: true, negative: true, sound: true, motion: true, eta: 60, maxCount: 2 },
  { id: "fal-ai/kling-video/v3/pro/text-to-video", label: "Kling 3 Pro", description: "Fluid motion and physics, up to 15 seconds.", mode: "video", kind: "video", family: "kling", needs: none, prompt: "required", aspectRatios: ["16:9", "9:16", "1:1"], durations: ["5", "10", "15"], negative: true, sound: true, motion: true, eta: 150, maxCount: 2 },
  { id: "bytedance/seedance-2.5/text-to-video", label: "Seedance 2.5", description: "Multi-shot storytelling at up to 1080p.", mode: "video", kind: "video", family: "seedance", needs: none, prompt: "required", aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: ["5", "10", "15"], resolutions: ["480p", "720p", "1080p"], sound: true, motion: true, eta: 120, maxCount: 2 },
  { id: "fal-ai/veo3.1/image-to-video", label: "Veo 3.1 · animate", description: "Brings a still to life with sound.", mode: "video", kind: "video", family: "veo", needs: image, prompt: "required", aspectRatios: ["auto", "16:9", "9:16"], durations: ["4s", "6s", "8s"], resolutions: ["720p", "1080p", "4k"], seed: true, negative: true, sound: true, motion: true, eta: 120, maxCount: 2 },
  { id: "fal-ai/kling-video/v3/pro/image-to-video", label: "Kling 3 Pro · animate", description: "Animates an image with Kling's motion.", mode: "video", kind: "video", family: "kling", needs: image, prompt: "optional", durations: ["5", "10", "15"], negative: true, sound: true, motion: true, eta: 150, maxCount: 2 },
  { id: "bytedance/seedance-2.5/image-to-video", label: "Seedance 2.5 · animate", description: "Animates an image, keeping its look.", mode: "video", kind: "video", family: "seedance", needs: image, prompt: "optional", durations: ["5", "10", "15"], resolutions: ["480p", "720p", "1080p"], sound: true, motion: true, eta: 120, maxCount: 2 },
  { id: "fal-ai/kling-video/v3/pro/start-end", endpoint: "fal-ai/kling-video/v3/pro/image-to-video", label: "Kling 3 Pro · start & end", description: "A shot that travels from one frame to another.", mode: "video", kind: "video", family: "kling", needs: ["image", "image"], inputLabels: ["Start frame", "End frame"], prompt: "optional", durations: ["5", "10", "15"], negative: true, sound: true, motion: true, eta: 150, maxCount: 2 },
  { id: "fal-ai/kling-video/v3/pro/motion-control", label: "Kling 3 Pro · motion transfer", description: "A character copies every move of a reference video.", mode: "video", kind: "video", family: "motionControl", needs: ["image", "video"], inputLabels: ["Character", "Motion video"], prompt: "optional", eta: 240, maxCount: 1 },
  { id: "fal-ai/kling-video/v3/standard/motion-control", label: "Kling 3 · motion transfer", description: "Motion transfer at a lower cost.", mode: "video", kind: "video", family: "motionControl", needs: ["image", "video"], inputLabels: ["Character", "Motion video"], prompt: "optional", eta: 180, maxCount: 1 },
  { id: "fal-ai/wan/v2.2-14b/animate/move", label: "Wan Animate · move", description: "Drives a still character with a video's body and face motion.", mode: "video", kind: "video", family: "wanAnimate", needs: ["image", "video"], inputLabels: ["Character", "Motion video"], prompt: "none", resolutions: ["480p", "580p", "720p"], seed: true, eta: 300, maxCount: 1 },
  { id: "fal-ai/wan/v2.2-14b/animate/replace", label: "Wan Animate · swap", description: "Puts your character into a video in place of its actor.", mode: "video", kind: "video", family: "wanAnimate", needs: ["image", "video"], inputLabels: ["Character", "Video"], prompt: "none", resolutions: ["480p", "580p", "720p"], seed: true, eta: 300, maxCount: 1 },
  { id: "fal-ai/kling-video/o3/pro/video-to-video/edit", label: "Kling O3 · video edit", description: "Restyles or changes a 3 to 15 second clip by instruction.", mode: "video", kind: "video", family: "videoEdit", needs: video, prompt: "required", references: 4, eta: 240, maxCount: 1 },
  { id: "bria/video/background-removal/v3", label: "Remove video background", description: "Cuts the subject out of a clip onto transparency.", mode: "video", kind: "video", family: "videoBg", needs: video, prompt: "none", eta: 90, maxCount: 1 },
  { id: "fal-ai/kling-video/ai-avatar/v2/pro", label: "Kling Avatar", description: "A talking video from a portrait and a voice track.", mode: "video", kind: "video", family: "avatar", needs: ["image", "audio"], prompt: "optional", eta: 240, maxCount: 1 },
  { id: "fal-ai/sync-lipsync/v3", label: "Sync 3 lipsync", description: "Sync's sharpest lip sync of a video to new audio.", mode: "video", kind: "video", family: "lipsync", needs: ["video", "audio"], prompt: "none", eta: 150, maxCount: 1 },
  { id: "fal-ai/sync-lipsync/v2", label: "Sync lipsync", description: "Re-times a video's lips to new audio.", mode: "video", kind: "video", family: "lipsync", needs: ["video", "audio"], prompt: "none", eta: 120, maxCount: 1 },
  { id: "fal-ai/veo3.1/fast/extend-video", label: "Veo 3.1 · extend", description: "Continues a clip by seven seconds.", mode: "video", kind: "video", family: "extend", needs: video, prompt: "required", seed: true, negative: true, sound: true, motion: true, eta: 90, maxCount: 1 },
  { id: "fal-ai/topaz/upscale/video", label: "Topaz video upscale", description: "Doubles a video's resolution.", mode: "video", kind: "video", family: "videoUpscale", needs: video, prompt: "none", eta: 180, maxCount: 1 },
  { id: "fal-ai/ffmpeg-api/merge-audio-video", label: "Add soundtrack", description: "Lays an audio track under a video.", mode: "video", kind: "video", family: "mergeAudio", needs: ["video", "audio"], prompt: "none", eta: 20, maxCount: 1 },
  { id: "fal-ai/ffmpeg-api/merge-videos", label: "Sequence clips", description: "Joins two clips end to end.", mode: "video", kind: "video", family: "mergeVideos", needs: ["video", "video"], prompt: "none", eta: 25, maxCount: 1 },
  { id: "fal-ai/elevenlabs/tts/eleven-v3", label: "ElevenLabs v3 voice", description: "Expressive speech; [whispers] and [laughs] tags work.", mode: "audio", kind: "audio", family: "tts", needs: none, prompt: "required", voices: VOICES, eta: 10, maxCount: 2 },
  { id: "fal-ai/elevenlabs/music", label: "ElevenLabs Music", description: "Full songs or instrumentals from a description.", mode: "audio", kind: "audio", family: "music", needs: none, prompt: "required", durations: ["15s", "30s", "60s", "120s"], eta: 45, maxCount: 2 },
  { id: "fal-ai/elevenlabs/sound-effects/v2", label: "ElevenLabs sound effect", description: "Foley, whooshes and ambience.", mode: "audio", kind: "audio", family: "sfx", needs: none, prompt: "required", durations: ["2s", "5s", "10s", "20s"], eta: 10, maxCount: 4 },
  { id: "fal-ai/nano-banana-pro/edit", label: "Nano Banana Pro edit", description: "Changes an image by instruction: remix, restyle, add text.", mode: "edit", kind: "image", family: "nanoEdit", needs: image, prompt: "required", aspectRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"], resolutions: ["1K", "2K", "4K"], seed: true, references: 3, eta: 25, maxCount: 4 },
  { id: "fal-ai/qwen-image-edit-2511-multiple-angles", label: "Camera angles", description: "The same subject from another side, height or distance.", mode: "edit", kind: "image", family: "angles", needs: image, prompt: "optional", angles: true, seed: true, eta: 20, maxCount: 4 },
  { id: "fal-ai/iclight-v2", label: "IC-Light relight", description: "Relights a photo and its background from a description.", mode: "edit", kind: "image", family: "relight", needs: image, prompt: "required", aspectRatios: IMAGE_RATIOS, seed: true, eta: 20, maxCount: 4 },
  { id: "fal-ai/fashn/tryon/v1.6", label: "FASHN try-on", description: "Dresses a person in a garment from a photo or flat lay.", mode: "edit", kind: "image", family: "tryOn", needs: ["image", "image"], inputLabels: ["Person", "Garment"], prompt: "none", seed: true, eta: 20, maxCount: 4 },
  { id: "fal-ai/bria/product-shot", label: "Bria product shot", description: "Places a product cut-out into a described scene.", mode: "edit", kind: "image", family: "productShot", needs: image, inputLabels: ["Product"], prompt: "optional", eta: 20, maxCount: 1 },
  { id: "fal-ai/bria/background/remove", label: "Remove background", description: "Cuts the subject out onto transparency.", mode: "edit", kind: "image", family: "removeBg", needs: image, prompt: "none", eta: 8, maxCount: 1 },
  { id: "fal-ai/seedvr/upscale/image", label: "SeedVR upscale", description: "Doubles an image's resolution, faithfully.", mode: "edit", kind: "image", family: "upscale", needs: image, prompt: "none", eta: 15, maxCount: 1 },
  { id: "fal-ai/topaz/upscale/image", label: "Topaz upscale", description: "Upscale with face and detail recovery.", mode: "edit", kind: "image", family: "upscale", needs: image, prompt: "optional", eta: 30, maxCount: 1 },
];

export function studioModel(id: string): StudioModel | undefined {
  return STUDIO_MODELS.find((model) => model.id === id);
}

export function studioModelsFor(mode: StudioMode): StudioModel[] {
  return STUDIO_MODELS.filter((model) => model.mode === mode);
}

/** The model Studio uses for a one-click action on a finished output. */
export const STUDIO_ACTIONS = {
  animate: "fal-ai/kling-video/v3/pro/image-to-video",
  upscale: "fal-ai/seedvr/upscale/image",
  upscaleVideo: "fal-ai/topaz/upscale/video",
  remix: "fal-ai/nano-banana-pro/edit",
  removeBackground: "fal-ai/bria/background/remove",
  extend: "fal-ai/veo3.1/fast/extend-video",
} as const;
export type StudioAction = keyof typeof STUDIO_ACTIONS;

/** Where a generation's starting media comes from: a project asset, or an output of an earlier generation. */
export type StudioSource = { assetId: string } | { generationId: string; index?: number };

/** A generation request, from the Studio page or an agent's origin_studio_generate. */
export interface StudioGenerateRequest {
  projectId: string;
  mode: StudioMode;
  /** A STUDIO_MODELS id, or STUDIO_CUSTOM_MODEL with `endpoint` and `input`. */
  model: string;
  prompt: string;
  aspectRatio?: string;
  duration?: string;
  voice?: string;
  resolution?: string;
  seed?: number;
  negativePrompt?: string;
  /** fal's generate_audio; models with sound default to on. */
  sound?: boolean;
  /** A STUDIO_CAMERA_MOTIONS id. */
  motion?: string;
  /** A STUDIO_CAMERA_ANGLES id, for a model with `angles`. */
  angle?: string;
  /** The STUDIO_PRESETS id the generation was set up from. */
  preset?: string;
  /** A designAssets id of the project: the image an edit, upscale or image-to-video starts from. */
  sourceAssetId?: string;
  /** The model's `needs`, in order; overrides sourceAssetId. */
  sources?: StudioSource[];
  /** Image assets a model with `references` follows for characters, products or style. */
  referenceAssetIds?: string[];
  /** 1 to the model's maxCount; each becomes its own generation. */
  count?: number;
  endpoint?: string;
  /** The custom endpoint's whole input; `prompt` is added when it has none. */
  input?: Record<string, unknown>;
  /** Image and video prompts carry the project's brand kit unless this is false. */
  brand?: boolean;
  /** A studioCharacters id: its reference images and description keep a person, product or style consistent. */
  characterId?: string;
  /** The generation this one was made from, and how. */
  parent?: { generationId: string; action: string };
}

/** One finished file of a generation, as fal hosts it. */
export interface StudioOutput {
  url: string;
  kind: StudioMediaKind;
  contentType?: string;
}

export type StudioParams = Record<string, string | number | boolean>;

/** A row of the studioGenerations table as studio:list returns it. */
export interface StudioGeneration {
  _id: string;
  projectId: string;
  mode: StudioMode;
  model: string;
  modelLabel: string;
  kind: StudioMediaKind;
  prompt: string;
  aspectRatio?: string;
  duration?: string;
  sourceAssetId?: string;
  /** The controls it ran with, so Remix can run it again. */
  params?: StudioParams;
  parentId?: string;
  action?: string;
  workflowRunId?: string;
  nodeId?: string;
  /** A workflow step's output: kept off the canvas and out of Assets unless an Output node saves it. */
  intermediate?: boolean;
  status: StudioStatus;
  queuePosition?: number;
  error?: string;
  outputs: StudioOutput[];
  /** Output index to the designAssets id it was saved as. */
  saved: Array<{ index: number; assetId: string }>;
  /** Outputs marked for Broadcast, each already saved as an asset. */
  broadcast: Array<{ index: number; assetId: string; at: number }>;
  createdByName: string;
  agentName?: string;
  /** fal received the prompt with the brand kit's imagery style and colours ahead of it. */
  branded?: boolean;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type StudioCharacterKind = "character" | "product" | "style";
export const STUDIO_CHARACTER_KINDS: readonly { value: StudioCharacterKind; label: string }[] = [
  { value: "character", label: "Character" }, { value: "product", label: "Product" }, { value: "style", label: "Style" },
];
export const STUDIO_CHARACTER_REFERENCES_MAX = 4;

/** A row of studioCharacters as studioLibrary:list returns it, with each reference's current link. */
export interface StudioCharacter {
  _id: string;
  projectId: string;
  name: string;
  kind: StudioCharacterKind;
  description: string;
  referenceAssetIds: string[];
  references: Array<{ assetId: string; url: string | null }>;
  createdByName: string;
  agentName?: string;
  createdAt: number;
  updatedAt: number;
}

/** The sentence a library entry adds to an image or video prompt. */
export function studioCharacterLine(character: Pick<StudioCharacter, "name" | "kind" | "description">): string {
  const about = character.description.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const name = character.name.trim();
  if (character.kind === "style") return `In the ${name} style${about ? `: ${about}` : ""}.`;
  if (character.kind === "product") return `Show ${name} exactly as in the reference images${about ? `: ${about}` : ""}.`;
  return `Keep ${name} consistent with the reference images${about ? `: ${about}` : ""}.`;
}

export function studioCharacterPrompt(character: Pick<StudioCharacter, "name" | "kind" | "description">, prompt: string): string {
  const line = studioCharacterLine(character);
  return prompt.trim() ? `${prompt.trim().replace(/[.\s]*$/, ".")} ${line}` : line;
}

/** The largest output the app copies into project storage; a larger one keeps fal's link. */
export const STUDIO_STORED_MAX = 150 * 1024 * 1024;
/** Each piece of a larger output: one request to the deployment's upload route, which takes 15 MB. */
export const STUDIO_CHUNK_BYTES = 12 * 1024 * 1024;

/** The Assets folder every Studio output lands in. */
export const STUDIO_ASSET_FOLDER = "Studio";

export function studioExtension(contentType: string | undefined, kind: StudioMediaKind): string {
  const subtype = contentType?.split(";")[0]?.split("/")[1]?.toLowerCase();
  if (subtype === "jpeg") return "jpg";
  if (subtype === "mpeg" && kind === "audio") return "mp3";
  if (subtype && /^[a-z0-9]{2,5}$/.test(subtype)) return subtype;
  return kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
}

/** An output's file name in Assets: its prompt, numbered when the generation made several. */
export function studioAssetName(generation: Pick<StudioGeneration, "prompt" | "modelLabel" | "outputs">, index: number, contentType?: string): string {
  const output = generation.outputs[index];
  const base = generation.prompt.replace(/\s+/g, " ").trim() || generation.modelLabel;
  const stem = base.length > 100 ? `${base.slice(0, 99)}…` : base;
  return `${stem}${generation.outputs.length > 1 ? ` ${index + 1}` : ""}.${studioExtension(contentType ?? output?.contentType, output?.kind ?? "image")}`;
}

const ENDPOINT = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){1,5}$/i;

export function validStudioEndpoint(endpoint: string): boolean {
  return endpoint.length <= 200 && ENDPOINT.test(endpoint) && !endpoint.split("/").includes("..");
}

const seconds = (value: string | undefined) => Number.parseFloat(value ?? "") || undefined;

export type StudioInputRequest = Pick<StudioGenerateRequest, "prompt" | "aspectRatio" | "duration" | "voice" | "resolution" | "seed" | "negativePrompt" | "sound" | "motion" | "angle">;

/** The prompt with its camera move, for models that take one. */
export function studioMotionPrompt(model: StudioModel, prompt: string, motion: string | undefined): string {
  const phrase = model.motion ? STUDIO_CAMERA_MOTIONS.find((entry) => entry.id === motion)?.phrase : undefined;
  if (!phrase) return prompt;
  return prompt ? `${prompt.replace(/[.\s]+$/, "")}. Camera: ${phrase}.` : `Camera: ${phrase}.`;
}

/** The endpoint one generation runs on: a model with references switches to its reference-taking twin. */
export function studioEndpoint(model: StudioModel, references: readonly string[]): string {
  return references.length && model.referenceModel ? model.referenceModel : model.endpoint ?? model.id;
}

/**
 * The fal input for one generation. `media` holds the model's `needs` in order and any reference images,
 * each as a URL or data URI.
 */
export function studioInput(model: StudioModel, request: StudioInputRequest, media: { sources?: readonly string[]; references?: readonly string[] } = {}): Record<string, unknown> {
  const prompt = studioMotionPrompt(model, request.prompt.trim(), request.motion);
  const [first, second] = media.sources ?? [];
  const references = (media.references ?? []).slice(0, model.references ?? 0);
  const pick = (allowed: readonly string[] | undefined, value: string | undefined) => (value && allowed?.includes(value) ? value : allowed?.[0]);
  const aspect = pick(model.aspectRatios, request.aspectRatio);
  const duration = pick(model.durations, request.duration);
  const resolution = pick(model.resolutions, request.resolution);
  const extras = {
    ...(model.seed && Number.isInteger(request.seed) ? { seed: request.seed } : {}),
    ...(model.negative && request.negativePrompt?.trim() ? { negative_prompt: request.negativePrompt.trim().slice(0, 2_000) } : {}),
    ...(model.sound && request.sound === false ? { generate_audio: false } : {}),
  };
  const referenced = references.length > 0 && model.referenceModel !== undefined;
  switch (model.family) {
    case "nano": return referenced
      ? { prompt, image_urls: references, aspect_ratio: aspect, resolution, num_images: 1, ...extras }
      : { prompt, aspect_ratio: aspect, resolution, num_images: 1, ...extras };
    case "flux3": return { prompt, aspect_ratio: aspect, resolution };
    case "imageSize": return referenced
      ? { prompt, image_urls: references, image_size: SIZE_FOR_RATIO[aspect ?? "1:1"] ?? "auto", ...extras }
      : { prompt, image_size: SIZE_FOR_RATIO[aspect ?? "1:1"] ?? "square_hd", num_images: 1, ...extras };
    case "veo": return { prompt, aspect_ratio: aspect, duration, resolution, ...(first ? { image_url: first } : {}), ...extras };
    case "kling": return first ? { prompt, start_image_url: first, ...(second ? { end_image_url: second } : {}), duration, ...extras } : { prompt, aspect_ratio: aspect, duration, ...extras };
    case "seedance": return first ? { prompt, image_url: first, duration, resolution, ...extras } : { prompt, aspect_ratio: aspect, duration, resolution, ...extras };
    case "tts": return { text: prompt, voice: pick(model.voices, request.voice) };
    case "music": return { prompt, music_length_ms: Math.round((seconds(duration) ?? 30) * 1000) };
    case "sfx": return { text: prompt, duration_seconds: seconds(duration) };
    case "nanoEdit": return { prompt, image_urls: [first, ...references].filter(Boolean), aspect_ratio: aspect, resolution, num_images: 1, ...extras };
    case "fluxEdit": return { prompt, image_urls: [first, ...references].filter(Boolean), ...extras };
    case "upscale": return { image_url: first, upscale_factor: 2, ...(prompt && model.id.includes("topaz") ? { prompt } : {}) };
    case "videoUpscale": return { video_url: first, upscale_factor: 2 };
    case "removeBg": return { image_url: first };
    case "avatar": return { image_url: first, audio_url: second, ...(prompt ? { prompt } : {}) };
    case "lipsync": return { video_url: first, audio_url: second };
    case "extend": return { prompt, video_url: first, ...extras };
    case "mergeAudio": return { video_url: first, audio_url: second };
    case "mergeVideos": return { video_urls: (media.sources ?? []).filter(Boolean) };
    case "motionControl": return { image_url: first, video_url: second, character_orientation: "video", keep_original_sound: true, ...(prompt ? { prompt } : {}) };
    case "wanAnimate": return { image_url: first, video_url: second, resolution, ...extras };
    case "videoEdit": return { prompt, video_url: first, keep_audio: true, ...(references.length ? { image_urls: references } : {}) };
    case "videoBg": return { video_url: first, background_color: "Transparent", output_container_and_codec: "webm_vp9" };
    case "relight": return { prompt, image_url: first, image_size: SIZE_FOR_RATIO[aspect ?? "1:1"] ?? "square_hd", ...extras };
    case "tryOn": return { model_image: first, garment_image: second, num_samples: 1, ...extras };
    case "angles": {
      const view = STUDIO_CAMERA_ANGLES.find((entry) => entry.id === request.angle) ?? STUDIO_CAMERA_ANGLES[0]!;
      return { image_urls: [first], horizontal_angle: view.horizontal, vertical_angle: view.vertical, zoom: view.zoom, ...(prompt ? { additional_prompt: prompt } : {}), ...extras };
    }
    case "styleRef": return { prompt, reference_image_urls: [first], image_size: SIZE_FOR_RATIO[aspect ?? "1:1"] ?? "square_hd", ...extras };
    case "productShot": return { image_url: first, ...(prompt ? { scene_description: prompt } : {}), num_results: 1, fast: true };
    case "custom": return { prompt };
  }
}

/** The media files of a fal result, whatever shape the endpoint returns (`images`, `image`, `video`, `audio`). */
export function studioOutputs(result: unknown, fallback: StudioMediaKind): StudioOutput[] {
  const found: StudioOutput[] = [];
  const kindOf = (contentType: string | undefined, key: string): StudioMediaKind => {
    if (contentType?.startsWith("image/") || /image/.test(key)) return "image";
    if (contentType?.startsWith("video/") || /video/.test(key)) return "video";
    if (contentType?.startsWith("audio/") || /audio/.test(key)) return "audio";
    return fallback;
  };
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 3 || found.length >= 8 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }
    const file = value as Record<string, unknown>;
    if (typeof file.url === "string" && /^https:\/\//i.test(file.url)) {
      const contentType = typeof file.content_type === "string" ? file.content_type : undefined;
      if (key === "mask_image" || key === "thumbnail") return;
      found.push({ url: file.url, kind: kindOf(contentType, key), ...(contentType ? { contentType } : {}) });
      return;
    }
    for (const [name, child] of Object.entries(file)) visit(child, name, depth + 1);
  };
  visit(result, "", 0);
  return found;
}

/** Seconds a model usually takes: the median of the project's own finished runs, else the catalogue's guess. */
export function studioEta(model: string, rows: readonly Pick<StudioGeneration, "model" | "status" | "startedAt" | "createdAt" | "finishedAt">[]): number {
  const took = rows.filter((row) => row.model === model && row.status === "done" && row.finishedAt)
    .map((row) => (row.finishedAt! - (row.startedAt ?? row.createdAt)) / 1000).filter((value) => value > 0).slice(0, 15).sort((a, b) => a - b);
  if (took.length >= 2) return took[Math.floor(took.length / 2)]!;
  return studioModel(model)?.eta ?? 30;
}
