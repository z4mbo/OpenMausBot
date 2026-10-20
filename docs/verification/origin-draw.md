# Origin Canvas verification

Canvas is the project's shared design surface: frames, shapes, text, lines, images and groups that people and agents
edit together. Start a disposable fake-engine server and the real Canvas renderer:

```powershell
node --experimental-strip-types scripts/verify-origin-draw.ts
```

Use the exact printed `previewUrl` in a second terminal:

```powershell
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-draw.mjs http://127.0.0.1:PRINTED_PORT/__origin-draw.html
pnpm exec vitest run src/components/origin-pages/DrawingCanvas.test.ts src/lib/origin-drawing-outbox.test.ts shared/canvas-ops.test.ts server/origin-canvas-tools.test.ts
pnpm --filter @origin/backend exec vitest run projectWorkflow
```

The checker accepts only the loopback fixture path. The page renders the production DrawingCanvas and ProjectDrawPage
against a synthetic cloud adapter (scene, presence, files, assets, uploads served by the preview itself); it never
connects to Convex or a provider, and Ask is captured by a fake store instead of sending a bot turn.

The browser matrix covers Midnight and Daylight at 375 and 1280 pixels with reduced motion. Each case:

- draws a frame, rectangle, text, ellipse and arrow with the keyboard tools and checks they land inside the frame;
- moves, undoes, redoes, duplicates and deletes a shape;
- holds a drag and checks the shape's new position is saved before the pointer is released, then undoes it in one step;
- at 375 pixels, opens Layers and checks the Rectangle tool is still the element under its own centre, and that opening
  the Design panel closes Layers;
- receives an agent-built pricing section (built with `applyCanvasOps`, as `origin_canvas_edit` does) plus two
  Excalidraw rows from before Canvas, checks the agent's estimated text sizes are measured and saved once, and that the
  old drawing renders converted;
- at 1280 pixels, Alt-drags a card inside the auto-layout pricing row and checks the copy lands in that row, then drills into a card, edits its radius and the row's auto-layout gap in the inspector, hides and shows a
  layer, exports PNG and SVG, saves the selection to Assets, inserts an asset image and sends the selection to Ask;
- in view-only mode, checks there are no editing tools and that dragging and Delete change nothing;
- on the project page, creates, renames and deletes a canvas.

Screenshots and machine-readable results are written to `docs/verification/evidence/origin-draw/`.

## Evidence boundaries

Browser evidence proves the renderer, gestures, inspector, layers, export and the synthetic adapter workflow. It does
not qualify real Convex availability, multi-device latency, or native Electron packaging. Concurrent edits converge per
node (higher version, then lower nonce), so two people changing different properties of the same node at the same moment
keep only one change.

Stop the foreground launcher with Ctrl-C. It closes its own preview and fake-engine child and removes its temporary
workspace; the printed server log remains.
