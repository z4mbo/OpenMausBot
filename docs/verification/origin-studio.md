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

It seeds a project with finished, failed and cancelled generations and a
product photo in Assets, then prints `previewUrl`. Drive it from a second
terminal:

```sh
node scripts/testing/check-origin-studio.mjs <previewUrl> docs/verification/evidence/origin-studio
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. At 1280 and 375 px, dark and light, the
check covers:

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
- at 1280 px dark: a workflow is built by adding nodes and dragging links,
  saved with Ctrl+S, run with Ctrl+Enter and listed;
- Assets shows every finished output under the Studio folder without a Save
  step.

The runner, workflow executor and agent tools are covered without a browser by
`server/origin-studio.test.ts`; the Convex side (auto-filing in Assets, the
uploaded-copy swap, workflow steps kept out of Assets, run permissions) by
`backend/convex/studio.test.ts` and `backend/convex/studioWorkflows.test.ts`.

Stop the launcher with Ctrl-C so it removes its temporary data.
