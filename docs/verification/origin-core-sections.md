# Project bar and core sections

The project bar (`src/components/ProjectSectionBar.tsx`) leads with the Chief,
then Agents, Issues, Chat, Call, Studio and Publish, with Assets, Vault, Repo,
Feedback and Settings as icons on its right. This recipe drives every core
section of a seeded launch project in the full renderer, at 1280 and 375 px,
dark and light.

## Run

```sh
OMB_VERIFY_PLAYWRIGHT=<path to playwright's index.mjs> \
  node --experimental-strip-types scripts/verify-origin-core-sections.ts
```

Nothing leaves this computer. The real Convex functions of `backend/convex`
run in memory (`scripts/testing/origin-campaigns-backend.ts`), seeded with a
project "Walkies": two members, seven issues across Draft, Todo and In
progress, assets, two vault items encrypted
with the fixture passphrase, a feedback portal with two reports, a pull
request, call notes and a team chat thread. The server is the disposable
fake-engine fixture with a Chief, Atlas, and two agents, Nova and Echo.

Without `--park` the script runs `scripts/testing/check-origin-core-sections.mjs`
and exits non-zero on any failure. With `--park` it prints the preview URL and
waits, so the check can be rerun against it:

```sh
node scripts/testing/check-origin-core-sections.mjs <previewUrl>
```

## What the check proves

In each theme and width it opens the Chief, then every section from the bar
(through More on a phone), and fails on a page error or horizontal overflow:

- Chief: the composer takes text.
- Agents: an agent's chat opens (and goes back on a phone); New agent opens
  and Escape closes it.
- Issues: New issue opens and closes; a card's actions menu opens fully
  visible above the lane that holds it, and Escape returns focus to its
  button; search and the MVP filter narrow the board; the list view's last
  actions menu is fully visible; Done lists the finished issue; an issue's
  detail shows its comment.
- Chat: the seeded thread loads and a sent message appears.
- Call: the lobby offers Start call.
- Assets: Files, Tokens and Brand switch; Add asset opens and closes.
- Vault: the passphrase unlocks it and a revealed item shows its value.
- Repo: Refresh answers; Feedback: every filter and Convert to issue.
- Settings: the page renders.

At 1280 dark it also narrows the window from 1120 to 800 px with Publish or
Studio open behind More and fails if the tab strip runs past its row.

The report goes to `docs/verification/evidence/round6/core-sections-report.json`;
`core-issues.png`, `core-issue-detail.png`, `core-agents.png` and
`core-vault.png` beside it are the 1280 dark views. Every other screenshot is
written to `origin-core-sections` in the system temporary directory.

Calls stop at the lobby: headless Chromium has no camera or microphone. The
fixture backend gives every issue the same short key, because in-memory ids
share their last characters.
