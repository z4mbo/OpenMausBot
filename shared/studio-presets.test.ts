import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STUDIO_CAMERA_ANGLES, studioEndpoint, studioInput, studioModel } from "./studio.ts";
import { presetBlank, presetPromptText, STUDIO_PRESET_GROUPS, STUDIO_PRESETS } from "./studio-presets.ts";

const model = (id: string) => studioModel(id)!;

describe("Studio fal inputs", () => {
  it("sends the character image and the motion video to motion transfer", () => {
    expect(studioInput(model("fal-ai/kling-video/v3/pro/motion-control"), { prompt: "" }, { sources: ["https://x/char.png", "https://x/dance.mp4"] }))
      .toEqual({ image_url: "https://x/char.png", video_url: "https://x/dance.mp4", character_orientation: "video", keep_original_sound: true });
    expect(studioInput(model("fal-ai/wan/v2.2-14b/animate/replace"), { prompt: "ignored", resolution: "580p", seed: 3 }, { sources: ["https://x/char.png", "https://x/clip.mp4"] }))
      .toEqual({ image_url: "https://x/char.png", video_url: "https://x/clip.mp4", resolution: "580p", seed: 3 });
  });

  it("runs start and end frames on Kling's image-to-video endpoint", () => {
    const startEnd = model("fal-ai/kling-video/v3/pro/start-end");
    expect(studioEndpoint(startEnd, [])).toBe("fal-ai/kling-video/v3/pro/image-to-video");
    expect(studioInput(startEnd, { prompt: "fly through", duration: "10" }, { sources: ["https://x/a.png", "https://x/b.png"] }))
      .toEqual({ prompt: "fly through", start_image_url: "https://x/a.png", end_image_url: "https://x/b.png", duration: "10" });
  });

  it("dresses a person in a garment", () => {
    expect(studioInput(model("fal-ai/fashn/tryon/v1.6"), { prompt: "" }, { sources: ["https://x/person.png", "https://x/shirt.png"] }))
      .toEqual({ model_image: "https://x/person.png", garment_image: "https://x/shirt.png", num_samples: 1 });
  });

  it("turns a camera angle id into fal's azimuth, elevation and zoom", () => {
    const angles = model("fal-ai/qwen-image-edit-2511-multiple-angles");
    expect(studioInput(angles, { prompt: "", angle: "top" }, { sources: ["https://x/a.png"] }))
      .toEqual({ image_urls: ["https://x/a.png"], horizontal_angle: 0, vertical_angle: 90, zoom: 4 });
    const first = STUDIO_CAMERA_ANGLES[0]!;
    expect(studioInput(angles, { prompt: "keep the logo", angle: "nowhere" }, { sources: ["https://x/a.png"] }))
      .toEqual({ image_urls: ["https://x/a.png"], horizontal_angle: first.horizontal, vertical_angle: first.vertical, zoom: first.zoom, additional_prompt: "keep the logo" });
  });

  it("edits a video with reference images and cuts out its background", () => {
    const edit = model("fal-ai/kling-video/o3/pro/video-to-video/edit");
    expect(studioEndpoint(edit, ["https://x/r.png"])).toBe(edit.id);
    expect(studioInput(edit, { prompt: "Restyle @Video1" }, { sources: ["https://x/v.mp4"], references: ["https://x/r.png"] }))
      .toEqual({ prompt: "Restyle @Video1", video_url: "https://x/v.mp4", keep_audio: true, image_urls: ["https://x/r.png"] });
    expect(studioInput(model("bria/video/background-removal/v3"), { prompt: "" }, { sources: ["https://x/v.mp4"] }))
      .toEqual({ video_url: "https://x/v.mp4", background_color: "Transparent", output_container_and_codec: "webm_vp9" });
  });
});

describe("Studio presets", () => {
  const credits = readFileSync(new URL("../third_party/comfyui-workflow-templates/README.md", import.meta.url), "utf8");

  it("each has a unique id, a known model and group, a preview image and a credit", () => {
    expect(new Set(STUDIO_PRESETS.map((preset) => preset.id)).size).toBe(STUDIO_PRESETS.length);
    for (const preset of STUDIO_PRESETS) {
      expect(studioModel(preset.model), preset.id).toBeDefined();
      expect(STUDIO_PRESET_GROUPS.some((group) => group.value === preset.group), preset.id).toBe(true);
      expect(existsSync(new URL(`../src/assets/studio-presets/${preset.id}.webp`, import.meta.url)), preset.id).toBe(true);
      expect(credits, preset.id).toContain(`| \`${preset.id}.webp\` | \`${preset.comfy}\` |`);
    }
  });

  it("marks the words to replace and sends them without brackets", () => {
    const prompt = "Replace [the sofa] with [a chair]";
    expect(presetBlank(prompt)).toEqual({ start: 8, end: 18 });
    expect(presetPromptText(prompt)).toBe("Replace the sofa with a chair");
    expect(presetBlank("no blanks")).toBeNull();
  });
});
