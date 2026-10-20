# Pulse

Pulse runs against the real Convex functions of `backend/convex`, held in
memory by convex-test and served over the HTTP wire `ConvexHttpClient` speaks,
as in [Campaigns in Broadcast](origin-campaigns.md). Nothing reaches the
network.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-pulse.ts
```

It seeds one workspace with three projects and prints `previewUrl`:

- Rocket: Draft ideas, a month of issues and completions, two open pull
  requests, two published pages with daily view counts, published and
  scheduled posts with campaign metrics, leads in every stage with unread
  replies and an agent draft, agent runs with costs and a project budget;
- Apollo: a few issues, an open pull request, a failed run and a reached
  budget;
- Notes: one idea and nothing else.

Drive it from a second terminal:

```sh
node scripts/testing/check-origin-pulse.mjs <previewUrl> docs/verification/evidence/origin-pulse
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers 1280 px dark and light
and 375 px dark:

- the project Pulse at 7 and 30 days: the stage strip at Grow, the Build,
  Launch, Grow and Team tiles with their numbers, daily bars and their hover
  readout, the budget meter and the attention chips;
- attention chips, tile links and stage buttons open Repo, Pipeline and
  Broadcast;
- Notes sits at Idea and each tile says what moves it on;
- the workspace Pulse on the Org page lists one row per project, Apollo first
  because it has the most waiting, and a row opens that project's Pulse.

The backend half is covered by `backend/convex/pulse.test.ts`, including the
`origin_pulse` agent tool through the real query.

Stop the launcher with Ctrl-C so it removes its temporary data.
