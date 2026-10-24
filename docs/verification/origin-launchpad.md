# Launchpad

Launchpad runs against the real Convex functions of `backend/convex`, held in
memory by convex-test and served over the HTTP wire `ConvexHttpClient` speaks,
beside a disposable fake-engine server that creates the new Chief. Nothing
reaches the network and no GitHub repository is created.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-launchpad.ts
```

It seeds a workspace with two projects. Walkies holds the seven Draft issues
a kickoff produces. Empty idea has no issues. It prints `previewUrl`.
Drive it from a second terminal:

```sh
node scripts/testing/check-origin-launchpad.mjs <previewUrl> docs/verification/evidence/origin-launchpad
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers 375 px and 1280 px:

- the Issues board lists the kickoff issues and shows no milestones;
- Empty idea shows no "Start from an idea" banner in Issues;
- New project creates the shared project (repository later), the Chief with
  the project-lead role on the fixture server, links them and sends the
  kickoff, with no milestone step.

The backend rules are in `backend/convex/launchpad.test.ts`. Run the check once per
fixture start, since it edits the seeded data, and stop the launcher with
Ctrl-C so it removes its temporary data.
