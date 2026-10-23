import { STUDIO_CAMERA_ANGLES, STUDIO_CAMERA_MOTIONS, STUDIO_CHARACTER_KINDS, STUDIO_CUSTOM_MODEL, STUDIO_MODELS } from "../../shared/studio.ts";
import { STUDIO_PRESET_GROUPS, STUDIO_PRESETS } from "../../shared/studio-presets.ts";
import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

export const STUDIO_TOOL_DEFINITIONS = [
  {
    name: "origin_studio_generate",
    description: "Generate images, video or audio in an Origin project's Studio with fal.ai, on the person's own fal key: the team watches it live and every finished output lands in Assets (folder Studio) by itself. count makes variations. Animate, upscale, extend or remix a result by passing it in sources with a model that starts from it. preset picks a ready-made effect and template one of the project's own templates, both from origin_studio_presets; fill sets their blanks. Images and audio wait for the result (up to 40 s); video returns at once." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        preset: { type: "string", enum: STUDIO_PRESETS.map((preset) => preset.id), description: "A ready-made effect from origin_studio_presets: its model, settings and prompt, unless you pass your own." },
        template: { type: "string", maxLength: 80, description: "A project template id or name from origin_studio_presets: its model, settings, prompt and example inputs, unless you pass your own." },
        fill: { type: "object", additionalProperties: { type: "string", maxLength: 400 }, description: "Values for the [placeholders] in the prompt, by label, by default words or by position (1, 2 …); blanks you leave out keep their default words." },
        mode: { type: "string", enum: ["image", "video", "audio", "edit"], description: "edit changes, upscales or cuts out an image. Default image." },
        prompt: { type: "string", maxLength: 8_000, description: "What to make; for an ElevenLabs voice, the words spoken." },
        model: { type: "string", enum: [...STUDIO_MODELS.map((model) => model.id), STUDIO_CUSTOM_MODEL], description: "Default: the mode's first model that takes as many sources as you pass." },
        sources: { type: "array", maxItems: 4, items: { type: "string", maxLength: 70 }, description: "What the model starts from, in order (image, video or audio): asset ids from origin_list_assets, or generation ids with an optional :index. Presets and models that take two take them in their listed order, such as the character image then the motion video." },
        reference_asset_ids: { type: "array", maxItems: 4, items: { type: "string", maxLength: 64 }, description: "Image assets to keep a character, product or style consistent (Nano Banana Pro, FLUX.2 Pro)." },
        character: { type: "string", maxLength: 64, description: "A library entry id or name from origin_studio_library: adds its reference images and description." },
        aspect_ratio: { type: "string", maxLength: 10, description: "Such as 1:1, 16:9, 9:16." },
        duration: { type: "string", maxLength: 10, description: "Video or audio length, such as 5, 8s or 30s." },
        resolution: { type: "string", maxLength: 10, description: "Such as 2K, 1080p." },
        voice: { type: "string", maxLength: 40, description: "ElevenLabs voice name, such as Rachel or Brian." },
        camera_motion: { type: "string", enum: STUDIO_CAMERA_MOTIONS.map((motion) => motion.id), description: "Video camera move." },
        camera_angle: { type: "string", enum: STUDIO_CAMERA_ANGLES.map((angle) => angle.id), description: "The viewpoint the Camera angles model re-renders an image from." },
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
    description: "List an Origin project's Studio generations, newest first: id, status, model, prompt, output links, the asset ids of saved outputs and which are picked for Publish." + ORIGIN_SCOPE,
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
    description: "Save a finished Studio generation to the project's Assets (all its outputs, or one with index; finished outputs are usually there already) and with broadcast true pick it for Publish posts. Returns the asset ids." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        generation_id: { type: "string", minLength: 1, maxLength: 64, description: "From origin_studio_list or origin_studio_generate." },
        index: { type: "integer", minimum: 0, maximum: 7, description: "One output; omit for all." },
        broadcast: { type: "boolean", description: "Also pick it for Publish." },
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
        character: { type: "string", maxLength: 64, description: "A library entry every image and video step follows." },
        caption: { type: "string", maxLength: 2_000, description: "Text of the Publish drafts its Output nodes fill, such as template:campaign-pack's feed post and reel." },
        fill: { type: "object", additionalProperties: { type: "string", maxLength: 400 }, description: "Values for the [placeholders] in its Prompt nodes, by label or default words, as origin_studio_workflow_list shows them." },
        name: { type: "string", maxLength: 120 },
        wait: { type: "boolean", description: "Wait up to 40 s for the run. Default false." },
        project: ORIGIN_PROJECT,
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "origin_studio_workflow_save",
    description: "Save a Studio workflow the team can open, edit and run: from a template id (such as template:talking-avatar), a copy of a saved workflow, or a finished generation, whose animate, remix and upscale steps become one model node each with its prompt as an input. Returns its id for origin_studio_workflow_run." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        from: { type: "string", minLength: 1, maxLength: 64, description: "A template id or workflow id from origin_studio_workflow_list, or a generation id from origin_studio_list." },
        name: { type: "string", minLength: 1, maxLength: 120 },
        description: { type: "string", maxLength: 400 },
        project: ORIGIN_PROJECT,
      },
      required: ["from", "name"],
    },
  },
  {
    name: "origin_studio_template_save",
    description: "Save a finished Studio generation as one of the project's templates: its model, settings and starting files as examples, its result as the cover. Write prompt with the words people should change as [Label: default words]; each becomes a blank in Studio's prompt bar and in fill." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        generation_id: { type: "string", minLength: 1, maxLength: 64, description: "From origin_studio_list or origin_studio_generate." },
        name: { type: "string", minLength: 1, maxLength: 80 },
        prompt: { type: "string", maxLength: 8_000, description: "The prompt with [Label: default] blanks. Default: the generation's own prompt." },
        description: { type: "string", maxLength: 400 },
        keep_inputs: { type: "boolean", description: "Keep its starting file as an example input people can swap. Default true." },
        project: ORIGIN_PROJECT,
      },
      required: ["generation_id", "name"],
    },
  },
  {
    name: "origin_studio_presets",
    description: "List the templates Studio offers: the project's own (saved from generations, with [blanks] to fill) and the ready-made effects (motion transfer, talking photo, start to end frame, new camera angle, relight, virtual try-on, product scene, voice-over and more), each with its model, the sources it needs in order and its prompt. Pass a preset id as preset, or a project template as template, to origin_studio_generate." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        group: { type: "string", enum: STUDIO_PRESET_GROUPS.map((group) => group.value), description: "Only this group." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_studio_library",
    description: "List an Origin project's Studio library (characters, products and styles saved from reference images), or save one so every later generation and workflow keeps it consistent." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "save"], description: "Default list." },
        name: { type: "string", maxLength: 60 },
        kind: { type: "string", enum: STUDIO_CHARACTER_KINDS.map((kind) => kind.value) },
        description: { type: "string", maxLength: 600, description: "What must stay the same: looks, wardrobe, materials, palette." },
        references: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", maxLength: 70 }, description: "Image asset ids, or generation ids with an optional :index." },
        character_id: { type: "string", maxLength: 64, description: "Replace this entry instead of adding one." },
        project: ORIGIN_PROJECT,
      },
    },
  },
];
