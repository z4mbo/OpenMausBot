# Studio: create, workflows and Assets

Studio runs against the real Convex functions of `backend/convex`, held in
memory by convex-test, and against a loopback fal: a queue on
`http://127.0.0.1` (`OMB_FAL_QUEUE_URL`) and a media host on `https://127.0.0.1`
with a throwaway self-signed certificate. A job finishes on its second status
poll unless its prompt contains "hold", which keeps it queued and then running.
The fixture server's fal key and Origin session exist only in its temporary
data directory, so nothing reaches fal.ai or a real deployment.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-studio.ts
```

It seeds a project with finished, failed and cancelled generations, a
product photo in Assets, an "Aurora bottle" product in the Studio library and a
"Launch hero" project template with two named blanks, then prints `previewUrl`. Drive it from a second
terminal:

```sh
node scripts/testing/check-origin-studio.mjs <previewUrl> docs/verification/evidence/origin-studio
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. At 1280 and 375 px, dark and light, the
check covers:

- Create and Workflows share one header: the Studio title and the same two-way
  control; templates, the library and Design live outside those two views;
- the seeded video has no poster from fal, so its tile shows the first frame,
  drawn in the browser from the fixture's WebM and kept in the Cache API; the
  video itself loads only on hover;
- `/` focuses the prompt and Ctrl+Enter generates; the tile shows progress with
  an ETA, then the image;
- a held generation is cancelled from its tile with the keyboard and fal's
  `cancel_url` is called once;
- 1 to 4 switch mode, Veo shows aspect, duration, resolution, camera motion and
  a Sound switch, M opens the model picker and search plus Enter picks FLUX 3;
- Enhance rewrites the prompt through `fal-ai/any-llm`;
- at 1280 px dark: the voice picker plays a sample and picks Brian; A on a tile
  sets up Animate with that output as the start frame and U upscales it at
  once; an output is picked for Broadcast from its tile;
- Enter opens the viewer, the arrows walk the results and ? lists the
  shortcuts;
- the Podcast template runs step by step and its three Outputs land in Assets;
- Library opens the project's characters, products and styles; at
  1280 px dark a character is saved from a generated image, "Create with" it
  sets up the next generation, and fal receives its reference image and the
  line "Keep … consistent with the reference images: …"; L on a tile opens a
  new entry seeded with that output;
- C opens the Campaign pack: one brief runs `POST /api/studio/campaign`, the
  cheap model writes the voice-over and caption, the strip shows hero, square
  post, 9:16 reel (Kling plus the voice-over merged in) and voice-over as they
  finish, and the feed post and reel are drafted in Broadcast; at 1280 px dark
  the run's editor shows "2 Broadcast drafts" and Broadcast lists them with the
  written caption;
- in the template editor the node palette searches models, Undo and Redo walk
  the edit, and a two-finger pinch (touch pointer events) zooms the canvas;
- at 1280 px dark: a workflow is built from the palette, with Ctrl+Z,
  Ctrl+Shift+Z, Ctrl+C then Ctrl+V and a double-click on empty canvas, links
  are dragged, and it is saved with Ctrl+S, run with Ctrl+Enter and listed;
- at 1280 px dark: T opens the template gallery (the project's own templates
  first, then the presets with their ComfyUI preview images); search plus Enter
  picks Motion transfer, whose slots read Character and Motion video, and fal's
  Kling motion control receives the character image, the video and
  `character_orientation`;
- at 1280 px dark: S on a result opens Save as template; a selected word
  becomes a named placeholder, the template is saved, picked from "Yours", its
  blanks show as fields in the prompt bar, and fal receives the prompt with the
  filled values and no brackets;
- at 1280 px dark: G on a result opens it as a workflow, one model step per
  generation in its line, with the inputs panel beside the canvas;
- Assets shows every finished output under the Studio folder without a Save
  step.

The runner, workflow executor and agent tools are covered without a browser by
`server/origin-studio.test.ts`; the Convex side (auto-filing in Assets, the
uploaded-copy swap, workflow steps kept out of Assets, run permissions, the
library, joining a large output's pieces, a run's Broadcast drafts) by
`backend/convex/studio.test.ts` and `backend/convex/studioWorkflows.test.ts`;
copy, paste, undo and palette search by
`src/components/origin-studio/workflow-edit.test.ts`. Templates and blanks are
covered the same way: `shared/studio-blanks.test.ts` reads, fills, sets and
marks `[Label: default]` blanks; `shared/studio-workflow.test.ts` lays every
workflow template out without overlaps and turns a generation's line into a
valid workflow; `backend/convex/studioTemplates.test.ts` saves a generation as
a template with its cover, example inputs and settings and refuses other
models and inputs of the wrong kind; `server/origin-studio.test.ts` saves and
lists templates with `origin_studio_template_save` and `origin_studio_presets`,
fills blanks through `origin_studio_generate`'s `template` and `fill`, saves
workflows from a template or a generation with `origin_studio_workflow_save`,
and returns a run card from `origin_studio_workflow_run`. Presets are covered the
same way:

- `shared/studio-presets.test.ts` checks every preset's model, unique id,
  preview image in `src/assets/studio-presets/` and its credit in
  `third_party/comfyui-workflow-templates/README.md`, and the fal input of the
  motion transfer, Wan Animate, start and end frame, try-on, camera angle,
  video edit and video background models; `server/origin-studio.test.ts`
  lists presets with `origin_studio_presets` and generates from one with
  `origin_studio_generate`, and `server/origin-cloud.test.ts` shows a Studio
  tool's cards in the turn's thread.

## Outputs over 15 MB

The deployment's upload route is a Convex HTTP action, whose request body
stops at 20 MB, and Convex storage has no append or multipart upload. The app
therefore streams a fal output through in 12 MB pieces, each an ordinary
scoped upload, and the `studioUpload:assemble` Node action (512 MiB of memory)
joins them into one project file and deletes the pieces. It joins only pieces
the same member uploaded to that project within the last ten minutes that no
asset references yet. Files up to 150 MB are copied; a larger output keeps its
fal link. The fixture's media host is not fal's, so this path is proven by the
unit and convex-test suites rather than the browser check.

Stop the launcher with Ctrl-C so it removes its temporary data.
