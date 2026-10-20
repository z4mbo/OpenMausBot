# The idea-to-sale journey

A project's bar is its journey: Pulse, then Plan → Build → Launch → Sell, with
the active phase's sections beside it (Plan: Chief, Team, Call, Docs, Canvas;
Build: Issues, Agents, Repo, Ship; Launch: Studio, Broadcast, Assets; Sell:
Sales, Feedback) and Vault and Settings as tools. A phase opens on the section
last seen in it. Section ids and routing are unchanged.

`pulse:journey` (in `backend/convex/pulse.ts`) reads what the project has made,
and `shared/origin-journey.ts` turns that into one next step, decided by the
furthest thing made: Write the Brief, Brief ready → sketch in Canvas, Sketch
done → plan the MVP issues, Build the MVP, MVP issues done → Ship, Shipped →
create launch content, Content ready → publish in Broadcast, Posts live →
follow up leads in Sales. Pulse shows it as a card under the journey strip; the
Chief chat, the step's own section and the section whose work led to it show
it as one line. Each offers its section and a hand-off that sends the step to
the project's Chief. Agents get the same phase and step in their turn context
(`server/origin-project-context.ts`).

## Run

The fixture runs the real Convex functions in memory and needs no Origin
server:

```sh
node --experimental-strip-types scripts/verify-origin-journey.ts
```

It seeds four projects: Seed (nothing), Sketch (a Brief), Forge (a Brief, a
canvas, three open issues) and Rocket (shipped, Studio output, a live post and
leads with replies), and prints `previewUrl`. Drive it from a second terminal:

```sh
node scripts/testing/check-origin-journey.mjs <previewUrl> docs/verification/evidence/origin-journey
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. At 1280 and 375 px in dark and light
(light with reduced motion) it checks:

- Seed's Docs points to Write the Brief, and Ask Seed sends the brief to the
  Chief once and opens its chat;
- Sketch's Docs says Brief ready → sketch in Canvas and its button opens Canvas,
  where only the hand-off remains;
- Forge's Pulse marks Plan done and Build next, the card opens Issues, each
  phase reopens its last section, every section id opens through its phase
  (More holds what does not fit at 375 px), and tools show no phase tabs;
- Rocket's Broadcast says Posts live → follow up leads in Sales, Hide keeps the
  step hidden after a reload, and Pulse sits at Sell;
- no page scrolls sideways.

`?view=inbox` and `?view=org` render the workspace Inbox and Org pages against
the same data for screenshots.

Unit coverage: `shared/origin-journey.test.ts`, `src/components/project-sections.test.ts`,
`backend/convex/pulse.test.ts` (the journey query walks one project from Brief
to leads) and `server/origin-project-tools.test.ts` (the Chief's context line).

Stop the launcher with Ctrl-C.
