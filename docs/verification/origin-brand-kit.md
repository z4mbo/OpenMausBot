# Brand kit

The brand kit runs against the real Convex functions of `backend/convex`, held
in memory by convex-test and served over the HTTP wire `ConvexHttpClient`
speaks. The fixture server's Origin session points at that backend and its fal
queue at a loopback fake, so Studio's generate route reads the kit and submits
to the fake. The agent tools run in the launcher through `runOriginTool` with
the real Convex client, against the same backend. Nothing reaches the network:
the check blocks every request off 127.0.0.1, Google Fonts included, so faces
render in their fallback stacks.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-brand-kit.ts
```

It seeds a project "Lumen" with a logo, an icon and a document in Assets, a
viewer, and a "Landing" canvas whose "Hero" frame is drawn off-brand, then
prints `previewUrl`. Drive it from a second terminal:

```sh
node scripts/testing/check-origin-brand-kit.mjs <previewUrl> docs/verification/evidence/origin-brand-kit
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers:

- Assets > Brand without a kit opens on defaults, and Draft with the Chief
  sends the drafting brief into its chat;
- `origin_brand_update`, called as the Chief, saves a kit the panel shows live
  (preview, logo, contrast checks), and `origin_brand_get` reads it back;
- the kit at 1280 px dark and light and 375 px dark, without sideways scroll;
- editing shows a failing contrast as it is typed, and saving writes colour,
  heading font and imagery through `brand:update`;
- Canvas: Apply brand on the frame restyles it (background neutral, accent to
  primary, heading and body faces), and a text layer shows the Heading style
  and the brand swatches;
- the frame published as a page requests the kit's faces from Google Fonts and
  sets its heading in the heading face;
- Studio: Use brand is on once a kit exists; fal receives the imagery and
  colours ahead of the prompt, and with it off the prompt as written;
- a viewer reads the kit without save, draft or editable fields.

Stop the launcher with Ctrl-C so it removes its temporary data.
