# Canvas design tools, collaboration and agents

Canvas covers the design work of a Figma-class tool: components and variants, constraints, complete auto layout,
the pen tool with bezier editing (click a segment to add a point), non-destructive boolean groups whose shapes stay
editable, corner radius per corner, linear and radial gradient fills, image fill, fit, stretch, crop and tile modes, brand-bound colour and text styles, effects, rulers and
guides, layout grids, comments, version history, prototype links with Present mode, a Dev mode code panel, SVG import
and PNG, SVG and PDF export. Agents read and edit the same scene, see their work as screenshots, comment, and design
Origin issues for the Chief to review.

Canvas lives in Studio as its Design mode, after Workflows; a link to the old Canvas section
(`setChiefSectionOf(chief, "draw")`, used by issue design chips) opens Studio there. The stage takes the app's ground
colour (the header's black in dark skins, the inset tone in light ones) and the Layers, Design and Ask panels float
over it, with the toolbar, zoom controls, rulers and zoom-to-fit kept to the area between them.

Start the disposable fixture (fake engine plus the production DrawingCanvas against a synthetic cloud adapter):

```powershell
node --experimental-strip-types scripts/verify-origin-draw.ts
```

Then, from a second terminal, with the printed `previewUrl`:

```powershell
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-canvas-pro.mjs http://127.0.0.1:PRINTED_PORT/__origin-draw.html
node scripts/testing/check-origin-draw.mjs http://127.0.0.1:PRINTED_PORT/__origin-draw.html
pnpm exec vitest run shared/canvas-components.test.ts shared/canvas-boolean.test.ts shared/canvas-boolean-group.test.ts shared/canvas-design-system.test.ts shared/canvas-svg-import.test.ts shared/canvas-ops.test.ts src/components/origin-pages/canvas/path-edit.test.ts server/origin-canvas-tools.test.ts server/canvas-fonts.test.ts src/components/origin-pages/DrawingCanvas.test.ts
pnpm exec vitest run server/origin-design-agent.e2e.test.ts
pnpm --filter @origin/backend exec vitest run canvasCollab
```

The checker accepts only the loopback fixture path. At 1280 pixels in Midnight and Daylight it:

- draws a vector with the pen (click, drag a smooth anchor, click, Enter), opens it for editing with Enter, drags an
  anchor and clicks the middle of a segment to add a point;
- unions two rectangles with Ctrl+Alt+U into a boolean group that keeps both rectangles, undoes it, subtracts them from
  the Design panel, then enters the group and resizes its rectangles while it stays a subtract group;
- makes a frame a component (Ctrl+Alt+K), places an instance from the Assets tab and checks a fill change on the
  component reaches the instance;
- adds a layout grid and a drop shadow (then removes it), pins a vector to the right and widens its frame;
- gives a frame independent corners (top left 24) and a 45° linear gradient with an edited stop;
- inserts a project image, switches it to Crop, presses Enter and drags the picture inside its box;
- applies the Heading 1 text style, turns on wrapping in a row auto layout, reads the React and Tailwind code;
- links one frame to another, presents it with Ctrl+Alt+Enter and follows the link with a click;
- pastes SVG markup as editable vectors and exports a frame as a PDF;
- comments on a layer with an @mention, replies and resolves the thread;
- drags a guide out of the ruler, saves a named version, deletes a frame and restores the version;
- shows a teammate's selection, an agent's cursor and the issue chip of a designed frame;
- opens the Ask panel with the zoom controls and toolbar still clear of it, and briefs the agent to design an
  issue, which asks for `origin_design_submit`; then picks Dana from the panel's agent menu, asks her, and reads her
  streamed reply and tool step from her own thread's transcript;
- checks a canvas is a single page with no Add page control and no published pages menu;
- builds a Design system frame from the Assets tab: colour swatches and text specimens bound to the brand styles, and
  Button (primary and secondary variants), Input, Card and Nav components;
- in Midnight, presses every tool key and shortcut (tools, group, frame, ungroup, the four booleans, flatten, nudges,
  hide, z-order, copy and paste, lock, rulers, zoom, space-pan and the image menu);
- loads a frame of 1,500 shapes, drags it, and records the frame times.

At 375 pixels it opens Assets and the code tab, comments with the comment tool, presents, and opens the
Ask panel. Screenshots and `browser-checks.json` go to `docs/verification/evidence/origin-canvas-pro/`; the `round5-*`
screenshots (1280 pixels, Midnight) show a boolean group, corners and gradient, a crop, the design system and the Ask
panel streaming another agent's reply.

The agent tools are covered by `server/origin-canvas-tools.test.ts`: a large edit streams in batches under the agent's
cursor with a named version saved first, `origin_canvas_screenshot` returns a PNG image the model sees, and
`origin_design_submit` links frames, pins the rationale and asks the Chief to review. Screenshots load the brand's Google
fonts: `server/canvas-fonts.ts` downloads TrueType files from fonts.gstatic.com once into `<data>/cache/fonts` and hands
them to resvg; `server/canvas-fonts.test.ts` covers the cache, the host check and offline fallback. The backend test covers pages,
comments and their mention notifications, version snapshots and restores, design links and agent presence.

### A design issue, end to end through an agent

`pnpm exec vitest run server/origin-design-agent.e2e.test.ts` (about 10 s) runs the real `backend/convex` functions in
memory (fake Convex, seeded with a workspace, a project, a canvas and an issue) and an isolated server with the fake
engine. A Chief's scripted turn calls `origin_assign_issue` with `design: true`; the handoff reaches the designer through
`coordinate_bots` in a new thread with the design brief, and the designer's scripted turn makes real `agents` MCP calls:
`origin_canvas`, `origin_canvas_edit` (a "Pricing" frame with children), `origin_canvas_screenshot` (a PNG attached to the
turn), `origin_canvas_comment` and `origin_design_submit`. The check then reads the backend: the frame carries the issue,
the agent's comment and the pinned rationale exist, and `canvasCollab:designsForIssue` returns the link in review under
the agent's name. Finally it renders the real `DesignChips` (shown on the issue detail in `IssuesPage`) with that link and
asserts the "Design Pricing in review" chip.

## Evidence boundaries

The browser run proves the editor, its gestures and panels against the synthetic adapter; it does not qualify real
Convex latency or a live model. An agent's screenshot shows a brand web font only once its files could be downloaded;
offline, the tool says which face fell back. The Ask panel's streaming is proven against a scripted thread transcript in
the browser, not a live engine. Instances follow components on the same canvas live; an instance placed from
another canvas's library updates when someone presses Update on it.

Stop the launcher with Ctrl-C; it removes its temporary workspace.
