# Canvas design tools, collaboration and agents

Canvas covers the design work of a Figma-class tool: components and variants, constraints, complete auto layout,
the pen tool with bezier editing, boolean operations, brand-bound colour and text styles, effects, pages, rulers and
guides, layout grids, comments, version history, prototype links with Present mode, a Dev mode code panel, SVG import
and PNG, SVG and PDF export. Agents read and edit the same scene, see their work as screenshots, comment, and design
Origin issues for the Chief to review.

Start the disposable fixture (fake engine plus the production DrawingCanvas against a synthetic cloud adapter):

```powershell
node --experimental-strip-types scripts/verify-origin-draw.ts
```

Then, from a second terminal, with the printed `previewUrl`:

```powershell
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-canvas-pro.mjs http://127.0.0.1:PRINTED_PORT/__origin-draw.html
node scripts/testing/check-origin-draw.mjs http://127.0.0.1:PRINTED_PORT/__origin-draw.html
pnpm exec vitest run shared/canvas-components.test.ts shared/canvas-boolean.test.ts shared/canvas-svg-import.test.ts shared/canvas-ops.test.ts server/origin-canvas-tools.test.ts src/components/origin-pages/DrawingCanvas.test.ts
pnpm --filter @origin/backend exec vitest run canvasCollab
```

The checker accepts only the loopback fixture path. At 1280 pixels in Midnight and Daylight it:

- draws a vector with the pen (click, drag a smooth anchor, click, Enter), opens it for editing with Enter and drags an
  anchor;
- unions two rectangles with Ctrl+Alt+U, undoes it, then subtracts them from the Design panel;
- makes a frame a component (Ctrl+Alt+K), places an instance from the Assets tab and checks a fill change on the
  component reaches the instance;
- adds a layout grid and a drop shadow (then removes it), pins a vector to the right and widens its frame;
- applies the Heading 1 text style, turns on wrapping in a row auto layout, reads the React and Tailwind code;
- links one frame to another, presents it with Ctrl+Alt+Enter and follows the link with a click;
- pastes SVG markup as editable vectors and exports a frame as a PDF;
- comments on a layer with an @mention, replies and resolves the thread;
- drags a guide out of the ruler, saves a named version, deletes a frame and restores the version;
- shows a teammate's selection, an agent's cursor and the issue chip of a designed frame;
- opens the Ask panel with the zoom controls and toolbar still clear of it, and briefs the agent to design an
  issue, which asks for `origin_design_submit`;
- adds a page, checks a shape drawn there stays off the first page;
- in Midnight, presses every tool key and shortcut (tools, group, frame, ungroup, the four booleans, flatten, nudges,
  hide, z-order, copy and paste, lock, rulers, zoom, space-pan and the image menu);
- loads a frame of 1,500 shapes, drags it, and records the frame times.

At 375 pixels it adds a page, opens Assets and the code tab, comments with the comment tool, presents, and opens the
Ask panel. Screenshots and `browser-checks.json` go to `docs/verification/evidence/origin-canvas-pro/`.

The agent tools are covered by `server/origin-canvas-tools.test.ts`: a large edit streams in batches under the agent's
cursor with a named version saved first, `origin_canvas_screenshot` returns a PNG image the model sees, and
`origin_design_submit` links frames, pins the rationale and asks the Chief to review. The backend test covers pages,
comments and their mention notifications, version snapshots and restores, design links and agent presence.

## Evidence boundaries

The browser run proves the editor, its gestures and panels against the synthetic adapter; it does not qualify real
Convex latency or a live model. Screenshots render text with the server computer's fonts, so a brand web font may show
as its fallback in an agent's screenshot. Instances follow components on the same canvas live; an instance placed from
another canvas's library updates when someone presses Update on it.

Stop the launcher with Ctrl-C; it removes its temporary workspace.
