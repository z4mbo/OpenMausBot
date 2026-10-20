export type StudioMode = "image" | "video" | "audio" | "edit";
export type StudioMediaKind = "image" | "video" | "audio";
export type StudioStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type Family =
  | "nano" | "flux3" | "imageSize" | "veo" | "kling" | "seedance" | "tts" | "music" | "sfx" | "nanoEdit" | "upscale" | "custom";

/** One fal.ai endpoint Studio offers. `source: "image"` needs a project image asset to start from. */
export interface StudioModel {
  id: string;
  label: string;
  mode: StudioMode;
  kind: StudioMediaKind;
  family: Family;
  source: "none" | "image";
  aspectRatios?: readonly string[];
  durations?: readonly string[];
  voices?: readonly string[];
  /** The largest batch one prompt may ask for. */
  maxCount: number;
}

const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const SIZE_FOR_RATIO: Record<string, string> = { "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9", "4:3": "landscape_4_3", "3:4": "portrait_4_3" };
const VOICES = ["Rachel", "Aria", "Roger", "Sarah", "Laura", "Charlie", "George", "Callum", "River", "Liam", "Charlotte", "Alice", "Matilda", "Will", "Jessica", "Eric", "Chris", "Brian", "Daniel", "Lily", "Bill"] as const;

/** The endpoint id a custom generation uses: any fal.ai model or deployed workflow, such as a ComfyUI one. */
export const STUDIO_CUSTOM_MODEL = "custom";

export const STUDIO_MODELS: readonly StudioModel[] = [
  { id: "fal-ai/nano-banana-pro", label: "Nano Banana Pro", mode: "image", kind: "image", family: "nano", source: "none", aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3"], maxCount: 4 },
  { id: "blackforestlabs/flux-3/text-to-image", label: "FLUX 3", mode: "image", kind: "image", family: "flux3", source: "none", aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3"], maxCount: 4 },
  { id: "fal-ai/flux-2-pro", label: "FLUX.2 Pro", mode: "image", kind: "image", family: "imageSize", source: "none", aspectRatios: IMAGE_RATIOS, maxCount: 4 },
  { id: "fal-ai/krea-2/turbo", label: "Krea 2 Turbo", mode: "image", kind: "image", family: "imageSize", source: "none", aspectRatios: IMAGE_RATIOS, maxCount: 4 },
  { id: "fal-ai/flux/schnell", label: "FLUX.1 schnell (fast)", mode: "image", kind: "image", family: "imageSize", source: "none", aspectRatios: IMAGE_RATIOS, maxCount: 4 },
  { id: "fal-ai/veo3.1", label: "Veo 3.1", mode: "video", kind: "video", family: "veo", source: "none", aspectRatios: ["16:9", "9:16"], durations: ["4s", "6s", "8s"], maxCount: 2 },
  { id: "fal-ai/veo3.1/fast", label: "Veo 3.1 Fast", mode: "video", kind: "video", family: "veo", source: "none", aspectRatios: ["16:9", "9:16"], durations: ["4s", "6s", "8s"], maxCount: 2 },
  { id: "fal-ai/kling-video/v3/pro/text-to-video", label: "Kling 3 Pro", mode: "video", kind: "video", family: "kling", source: "none", aspectRatios: ["16:9", "9:16", "1:1"], durations: ["5", "10"], maxCount: 2 },
  { id: "bytedance/seedance-2.5/text-to-video", label: "Seedance 2.5", mode: "video", kind: "video", family: "seedance", source: "none", aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: ["5", "10"], maxCount: 2 },
  { id: "fal-ai/veo3.1/image-to-video", label: "Veo 3.1 · from image", mode: "video", kind: "video", family: "veo", source: "image", aspectRatios: ["auto", "16:9", "9:16"], durations: ["4s", "6s", "8s"], maxCount: 2 },
  { id: "fal-ai/kling-video/v3/pro/image-to-video", label: "Kling 3 Pro · from image", mode: "video", kind: "video", family: "kling", source: "image", durations: ["5", "10"], maxCount: 2 },
  { id: "bytedance/seedance-2.5/image-to-video", label: "Seedance 2.5 · from image", mode: "video", kind: "video", family: "seedance", source: "image", durations: ["5", "10"], maxCount: 2 },
  { id: "fal-ai/elevenlabs/tts/eleven-v3", label: "ElevenLabs v3 voice", mode: "audio", kind: "audio", family: "tts", source: "none", voices: VOICES, maxCount: 2 },
  { id: "fal-ai/elevenlabs/music", label: "ElevenLabs Music", mode: "audio", kind: "audio", family: "music", source: "none", durations: ["15s", "30s", "60s", "120s"], maxCount: 2 },
  { id: "fal-ai/elevenlabs/sound-effects/v2", label: "ElevenLabs sound effect", mode: "audio", kind: "audio", family: "sfx", source: "none", durations: ["2s", "5s", "10s", "20s"], maxCount: 4 },
  { id: "fal-ai/nano-banana-pro/edit", label: "Nano Banana Pro edit", mode: "edit", kind: "image", family: "nanoEdit", source: "image", aspectRatios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"], maxCount: 4 },
  { id: "fal-ai/seedvr/upscale/image", label: "SeedVR upscale", mode: "edit", kind: "image", family: "upscale", source: "image", maxCount: 1 },
  { id: "fal-ai/topaz/upscale/image", label: "Topaz upscale", mode: "edit", kind: "image", family: "upscale", source: "image", maxCount: 1 },
];

export function studioModel(id: string): StudioModel | undefined {
  return STUDIO_MODELS.find((model) => model.id === id);
}

export function studioModelsFor(mode: StudioMode): StudioModel[] {
  return STUDIO_MODELS.filter((model) => model.mode === mode);
}

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
  /** A designAssets id of the project: the image an edit, upscale or image-to-video starts from. */
  sourceAssetId?: string;
  /** 1 to the model's maxCount; each becomes its own generation. */
  count?: number;
  endpoint?: string;
  /** The custom endpoint's whole input; `prompt` is added when it has none. */
  input?: Record<string, unknown>;
  /** Image and video prompts carry the project's brand kit unless this is false. */
  brand?: boolean;
}

/** One finished file of a generation, as fal hosts it. */
export interface StudioOutput {
  url: string;
  kind: StudioMediaKind;
  contentType?: string;
}

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
  status: StudioStatus;
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

const ENDPOINT = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){1,5}$/i;

export function validStudioEndpoint(endpoint: string): boolean {
  return endpoint.length <= 200 && ENDPOINT.test(endpoint) && !endpoint.split("/").includes("..");
}

const seconds = (value: string | undefined) => Number.parseFloat(value ?? "") || undefined;

/** The fal input for one generation; `source` is the starting image as a URL or data URI. */
export function studioInput(model: StudioModel, request: Pick<StudioGenerateRequest, "prompt" | "aspectRatio" | "duration" | "voice">, source?: string): Record<string, unknown> {
  const prompt = request.prompt.trim();
  const pick = (allowed: readonly string[] | undefined, value: string | undefined) => (value && allowed?.includes(value) ? value : allowed?.[0]);
  const aspect = pick(model.aspectRatios, request.aspectRatio);
  const duration = pick(model.durations, request.duration);
  switch (model.family) {
    case "nano": return { prompt, aspect_ratio: aspect, num_images: 1 };
    case "flux3": return { prompt, aspect_ratio: aspect };
    case "imageSize": return { prompt, image_size: SIZE_FOR_RATIO[aspect ?? "1:1"] ?? "square_hd", num_images: 1 };
    case "veo": return { prompt, aspect_ratio: aspect, duration, ...(source ? { image_url: source } : {}) };
    case "kling": return source ? { prompt, start_image_url: source, duration } : { prompt, aspect_ratio: aspect, duration };
    case "seedance": return source ? { prompt, image_url: source, duration } : { prompt, aspect_ratio: aspect, duration };
    case "tts": return { text: prompt, voice: pick(model.voices, request.voice) };
    case "music": return { prompt, music_length_ms: Math.round((seconds(duration) ?? 30) * 1000) };
    case "sfx": return { text: prompt, duration_seconds: seconds(duration) };
    case "nanoEdit": return { prompt, image_urls: source ? [source] : [], aspect_ratio: aspect, num_images: 1 };
    case "upscale": return { image_url: source, upscale_factor: 2, ...(prompt && model.id.includes("topaz") ? { prompt } : {}) };
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
      found.push({ url: file.url, kind: kindOf(contentType, key), ...(contentType ? { contentType } : {}) });
      return;
    }
    for (const [name, child] of Object.entries(file)) visit(child, name, depth + 1);
  };
  visit(result, "", 0);
  return found;
}
