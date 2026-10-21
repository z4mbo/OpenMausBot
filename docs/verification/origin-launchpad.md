# Launchpad and milestones

Launchpad runs against the real Convex functions of `backend/convex`, held in
memory by convex-test and served over the HTTP wire `ConvexHttpClient` speaks,
beside a disposable fake-engine server that creates the new Chief. Nothing
reaches the network and no GitHub repository is created.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-launchpad.ts
```

It seeds a workspace with two projects. In Walkies the Chief's kickoff already
ran through the real `origin_milestone_set` tool: MVP and Launch milestones
over seven Draft issues. Empty idea has no issues. It prints `previewUrl`.
Drive it from a second terminal:

```sh
node scripts/testing/check-origin-launchpad.mjs <previewUrl> docs/verification/evidence/origin-launchpad
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers 375 px and 1280 px:

- the Issues strip shows each milestone with its progress, and selecting one
  filters Issues to it; an issue's Milestone chip moves it and the strip's
  count follows; a new milestone is selected;
- Empty idea offers "Plan from an idea" in Issues, and Launchpad sends the
  Chief the kickoff brief with only the fields given;
- New project creates the shared project (repository later), the Chief with
  the project-lead role on the fixture server, links them and sends the
  kickoff.

The backend rules are in `backend/convex/launchpad.test.ts` and the agent
tools in `server/origin-launchpad-tools.test.ts`. Run the check once per
fixture start, since it edits the seeded data, and stop the launcher with
Ctrl-C so it removes its temporary data.
