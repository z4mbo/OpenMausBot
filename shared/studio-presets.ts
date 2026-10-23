import { studioModel, type StudioModel } from "./studio.ts";
import { fillBlanks } from "./studio-blanks.ts";

export type StudioPresetGroup = "motion" | "video" | "photo" | "product" | "audio";

export const STUDIO_PRESET_GROUPS: readonly { value: StudioPresetGroup; label: string }[] = [
  { value: "motion", label: "Motion" },
  { value: "video", label: "Video" },
  { value: "photo", label: "Photo" },
  { value: "product", label: "Product & fashion" },
  { value: "audio", label: "Audio" },
];

/**
 * A ready-made Studio effect: a model, its settings and a starting prompt. `[words in brackets]` in the prompt are the
 * part the person replaces. `comfy` names the ComfyUI workflow template (Comfy-Org/workflow_templates, MIT License)
 * whose preview image the preset shows.
 */
export interface StudioPreset {
  id: string;
  label: string;
  description: string;
  group: StudioPresetGroup;
  model: string;
  prompt?: string;
  aspectRatio?: string;
  duration?: string;
  resolution?: string;
  motion?: string;
  angle?: string;
  sound?: boolean;
  comfy: string;
}

export const STUDIO_PRESETS: readonly StudioPreset[] = [
  { id: "motion-transfer", label: "Motion transfer", description: "Your character copies every move of a reference video.", group: "motion", model: "fal-ai/kling-video/v3/pro/motion-control", comfy: "api_kling_motion_control3" },
  { id: "animate-character", label: "Animate a character", description: "A video's body and face motion drives a still portrait.", group: "motion", model: "fal-ai/wan/v2.2-14b/animate/move", resolution: "720p", comfy: "video_wan_animate2" },
  { id: "character-swap", label: "Character swap", description: "Recast a video with your character in the lead.", group: "motion", model: "fal-ai/wan/v2.2-14b/animate/replace", resolution: "720p", comfy: "template_purz_wan22_animate_auto_character_replace" },
  { id: "talking-photo", label: "Talking photo", description: "A portrait speaks a voice track, lips in sync.", group: "motion", model: "fal-ai/kling-video/ai-avatar/v2/pro", comfy: "api_heygen_talking_photo" },
  { id: "lip-sync", label: "Lip sync", description: "Re-times a video's lips to new audio.", group: "motion", model: "fal-ai/sync-lipsync/v3", comfy: "api_sync_so_lip_sync_video" },
  { id: "start-end-frame", label: "Start to end frame", description: "One shot that travels from your first frame to your last.", group: "video", model: "fal-ai/kling-video/v3/pro/start-end", duration: "5", prompt: "A smooth continuous camera move from the first frame to the last", comfy: "api_kling_v3_flf2v" },
  { id: "restyle-video", label: "Restyle a video", description: "Turns a clip into another look while keeping its motion.", group: "video", model: "fal-ai/kling-video/o3/pro/video-to-video/edit", prompt: "Restyle @Video1 as [a hand-painted watercolour animation], keeping the motion and framing", comfy: "api_wan2_7_video_edit" },
  { id: "product-turntable", label: "Product turntable", description: "A product photo becomes a slow rotating hero shot.", group: "video", model: "fal-ai/kling-video/v3/pro/image-to-video", duration: "5", motion: "orbit", sound: false, prompt: "The product turns slowly on a seamless backdrop as soft light sweeps across it", comfy: "templates_product_scene_transformation" },
  { id: "extend-video", label: "Extend a clip", description: "Continues a video by seven seconds.", group: "video", model: "fal-ai/veo3.1/fast/extend-video", prompt: "The scene continues: [what happens next]", comfy: "api_seedance2_5_video_extend" },
  { id: "video-background", label: "Remove video background", description: "Cuts the subject out of a clip onto transparency.", group: "video", model: "bria/video/background-removal/v3", comfy: "api_bria_remove_video_background_transparent" },
  { id: "video-upscale", label: "Upscale a video", description: "Doubles a clip's resolution.", group: "video", model: "fal-ai/topaz/upscale/video", comfy: "utility_seedvr2_video_upscale" },
  { id: "camera-angle", label: "New camera angle", description: "The same subject from another side, height or distance.", group: "photo", model: "fal-ai/qwen-image-edit-2511-multiple-angles", angle: "three-quarter-right", comfy: "template_qwen_multiangle.app" },
  { id: "relight", label: "Relight", description: "New light on a portrait or scene, background included.", group: "photo", model: "fal-ai/iclight-v2", prompt: "[Warm golden hour sunlight from the left], soft shadows, cinematic", comfy: "template_character_portrait_relighting" },
  { id: "expand-frame", label: "Expand the frame", description: "Outpaints a picture to any aspect ratio.", group: "photo", model: "fal-ai/nano-banana-pro/edit", aspectRatio: "16:9", prompt: "Extend the scene beyond its borders to fill the new frame, matching its content, light and perspective; keep the original untouched", comfy: "template_outpaint_to_any_aspect_ratio_nano_banana_pro" },
  { id: "style-match", label: "Style match", description: "New images in the look of a style reference.", group: "photo", model: "fal-ai/krea-2/turbo/style", prompt: "[A lighthouse on a cliff at dusk]", comfy: "api_krea2_style_reference" },
  { id: "illustration-to-photo", label: "Illustration to photo", description: "Turns a drawing or render into a realistic photo.", group: "photo", model: "fal-ai/nano-banana-pro/edit", prompt: "Turn this illustration into a hyper-realistic photograph with natural skin, real materials and true-to-life light; keep the composition, pose and colours", comfy: "templates-image_to_real" },
  { id: "turnaround", label: "Character turnaround", description: "Front, side and back views on one sheet.", group: "photo", model: "fal-ai/nano-banana-pro/edit", aspectRatio: "16:9", prompt: "Character turnaround sheet of this exact character: front, three-quarter, side and back views, full body, neutral pose, plain light grey background, consistent design and proportions", comfy: "api_google_nano_banana_create_turnaround_sheet" },
  { id: "contact-sheet", label: "Contact sheet", description: "A 3×3 grid of variations of one image.", group: "photo", model: "fal-ai/nano-banana-pro/edit", aspectRatio: "1:1", prompt: "A 3x3 photographic contact sheet of this subject: nine different poses, crops and camera angles in the same setting and light", comfy: "template_3x3_contact_sheet" },
  { id: "remove-object", label: "Remove an object", description: "Erases something and fills in what was behind it.", group: "photo", model: "fal-ai/nano-banana-pro/edit", prompt: "Remove [the person in the background] and fill the area naturally; change nothing else", comfy: "api_bria_eraser" },
  { id: "object-swap", label: "Swap an object", description: "Replaces one thing in a photo, keeping the scene's light.", group: "photo", model: "fal-ai/nano-banana-pro/edit", prompt: "Replace [the sofa] with [a green velvet armchair], matching the room's perspective, light and shadows", comfy: "api_bfl_flux2_max_sofa_swap" },
  { id: "miniature", label: "Isometric miniature", description: "A selfie becomes a tiny 3D diorama figure.", group: "photo", model: "fal-ai/nano-banana-pro/edit", aspectRatio: "1:1", prompt: "Turn this person into a cute isometric 3D miniature figure standing in [a tiny coffee shop] diorama, soft studio light, tilt-shift look", comfy: "templates-2x2_grid-iso_miniatures" },
  { id: "glitch", label: "Glitch art", description: "Pixel sorting, scan lines and colour tearing.", group: "photo", model: "fal-ai/nano-banana-pro/edit", prompt: "Apply a bold glitch art effect: pixel sorting, RGB channel split, scan lines and digital tearing, keeping the subject recognisable", comfy: "templates_purz_pixel_sort_image" },
  { id: "thumbnail", label: "YouTube thumbnail", description: "A loud, high-contrast thumbnail with a big title.", group: "photo", model: "fal-ai/nano-banana-pro", aspectRatio: "16:9", prompt: "High-contrast YouTube thumbnail: [an excited creator holding a glowing phone], huge bold title text \"[THIS CHANGED EVERYTHING]\", saturated colours, clean background", comfy: "template_eric_thumbnail_generator" },
  { id: "remove-background", label: "Remove background", description: "Cuts the subject out onto transparency.", group: "photo", model: "fal-ai/bria/background/remove", comfy: "utility_birefnet_remove_background" },
  { id: "upscale", label: "Upscale", description: "Doubles an image's resolution, faithfully.", group: "photo", model: "fal-ai/seedvr/upscale/image", comfy: "utility_seedvr2_image_upscale" },
  { id: "virtual-try-on", label: "Virtual try-on", description: "Dresses a person in a garment from a photo or flat lay.", group: "product", model: "fal-ai/fashn/tryon/v1.6", comfy: "api_kling_vto" },
  { id: "product-scene", label: "Product in a scene", description: "Places a product into a described setting.", group: "product", model: "fal-ai/bria/product-shot", prompt: "[On a marble bathroom shelf, morning light, eucalyptus leaves]", comfy: "templates-subject_holding_product.app" },
  { id: "product-mockup", label: "Product mockup", description: "Your design on packaging, mugs and merch.", group: "product", model: "fal-ai/nano-banana-pro/edit", prompt: "Apply this design to [a coffee bag, a mug and a tote bag] in a clean product mockup, studio light, realistic materials", comfy: "image_flux2_fp8" },
  { id: "fashion-editorial", label: "Fashion editorial", description: "A character, an outfit and a place as an editorial shoot.", group: "product", model: "fal-ai/nano-banana-pro/edit", aspectRatio: "3:4", prompt: "Fashion editorial photo of this person wearing [the outfit] in [a lush jungle], magazine styling, natural light", comfy: "templates-2x2_grid-character_bg_product" },
  { id: "voice-over", label: "Voice-over", description: "Expressive speech from a script.", group: "audio", model: "fal-ai/elevenlabs/tts/eleven-v3", prompt: "Hi! Here's what's new this week.", comfy: "api_heygen_text_to_speech" },
  { id: "song", label: "Song", description: "A full song or instrumental from a description.", group: "audio", model: "fal-ai/elevenlabs/music", duration: "30s", prompt: "Upbeat indie pop, catchy chorus, about a summer road trip", comfy: "audio_yue2_text2music" },
  { id: "sound-effect", label: "Sound effect", description: "Foley, whooshes and ambience.", group: "audio", model: "fal-ai/elevenlabs/sound-effects/v2", duration: "5s", prompt: "A deep cinematic whoosh into a bass hit", comfy: "api_elevenlabs_text_to_sound_effects" },
];

export function studioPreset(id: string): StudioPreset | undefined {
  return STUDIO_PRESETS.find((preset) => preset.id === id);
}

export function studioPresetModel(preset: StudioPreset): StudioModel {
  return studioModel(preset.model)!;
}

const BLANK = /\[([^\]\n]{1,120})\]/;

/** The first `[placeholder]` of a preset prompt, as the span a person types over. */
export function presetBlank(prompt: string): { start: number; end: number } | null {
  const match = BLANK.exec(prompt);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/** A preset prompt as sent: placeholders nobody replaced keep their words and lose their brackets. */
export function presetPromptText(prompt: string): string {
  return fillBlanks(prompt);
}
