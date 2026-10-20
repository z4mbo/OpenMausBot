import { STUDIO_CAMERA_MOTIONS, STUDIO_CUSTOM_MODEL, STUDIO_MODELS } from "../../shared/studio.ts";
import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

export const STUDIO_TOOL_DEFINITIONS = [
  {
    name: "origin_studio_generate",
    description: "Generate images, video or audio in an Origin project's Studio with fal.ai, on the person's own fal key: the team watches it live and every finished output lands in Assets (folder Studio) by itself. count makes variations. Animate, upscale, extend or remix a result by passing it in sources with a model that starts from it. Images and audio wait for the result (up to 40 s); video returns at once." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["image", "video", "audio", "edit"], description: "edit changes, upscales or cuts out an image. Default image." },
        prompt: { type: "string", maxLength: 8_000, description: "What to make; for an ElevenLabs voice, the words spoken." },
        model: { type: "string", enum: [...STUDIO_MODELS.map((model) => model.id), STUDIO_CUSTOM_MODEL], description: "Default: the mode's first model that takes as many sources as you pass." },
        sources: { type: "array", maxItems: 4, items: { type: "string", maxLength: 70 }, description: "What the model starts from, in order (image, video or audio): asset ids from origin_list_assets, or generation ids with an optional :index." },
        reference_asset_ids: { type: "array", maxItems: 4, items: { type: "string", maxLength: 64 }, description: "Image assets to keep a character, product or style consistent (Nano Banana Pro, FLUX.2 Pro)." },
        aspect_ratio: { type: "string", maxLength: 10, description: "Such as 1:1, 16:9, 9:16." },
        duration: { type: "string", maxLength: 10, description: "Video or audio length, such as 5, 8s or 30s." },
        resolution: { type: "string", maxLength: 10, description: "Such as 2K, 1080p." },
        voice: { type: "string", maxLength: 40, description: "ElevenLabs voice name, such as Rachel or Brian." },
        camera_motion: { type: "string", enum: STUDIO_CAMERA_MOTIONS.map((motion) => motion.id), description: "Video camera move." },
        negative_prompt: { type: "string", maxLength: 2_000 },
        seed: { type: "integer" },
        sound: { type: "boolean", description: "Video soundtrack where the model makes one. Default true." },
        enhance: { type: "boolean", description: "Rewrite the prompt with a cheap model first." },
        count: { type: "integer", minimum: 1, maximum: 4 },
        source_asset_id: { type: "string", maxLength: 64, description: "Same as one sources entry." },
        endpoint: { type: "string", maxLength: 200, description: "With model custom: any fal.ai endpoint id, such as a deployed ComfyUI workflow." },
        input: { type: "object", description: "With model custom: the endpoint's whole input." },
        wait: { type: "boolean", description: "Wait for the result. Default true except for video." }, brand: { type: "boolean", description: "Put the brand kit's imagery style and colours ahead of an image or video prompt. Default true." }, project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_studio_list",
    description: "List an Origin project's Studio generations, newest first: id, status, model, prompt, output links, the asset ids of saved outputs and which are picked for Broadcast." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["queued", "running", "done", "failed", "cancelled"] },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Default 15." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_studio_save_asset",
    description: "Save a finished Studio generation to the project's Assets (all its outputs, or one with index; finished outputs are usually there already) and with broadcast true pick it for Broadcast posts. Returns the asset ids." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        generation_id: { type: "string", minLength: 1, maxLength: 64, description: "From origin_studio_list or origin_studio_generate." },
        index: { type: "integer", minimum: 0, maximum: 7, description: "One output; omit for all." },
        broadcast: { type: "boolean", description: "Also pick it for Broadcast." },
        project: ORIGIN_PROJECT,
      },
      required: ["generation_id"],
    },
  },
  {
    name: "origin_studio_workflow_list",
    description: "List an Origin project's Studio workflows (node graphs that chain fal models, such as product shot to music reel) and the built-in templates, with each one's input nodes and the latest runs and their outputs." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        workflow_id: { type: "string", maxLength: 64, description: "Show only this workflow or template and its runs." },
        runs: { type: "integer", minimum: 0, maximum: 10, description: "Recent runs to show. Default 3." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_studio_workflow_run",
    description: "Run a Studio workflow or template on the person's fal key; the team watches each step live and Output nodes save to Assets (folder Studio)." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        workflow_id: { type: "string", minLength: 1, maxLength: 64, description: "From origin_studio_workflow_list, such as template:product-reel." },
        inputs: { type: "object", additionalProperties: { type: "string", maxLength: 8_000 }, description: "Input node id to prompt text, or to an asset id for a file input." },
        name: { type: "string", maxLength: 120 },
        wait: { type: "boolean", description: "Wait up to 40 s for the run. Default false." },
        project: ORIGIN_PROJECT,
      },
      required: ["workflow_id"],
    },
  },
];
