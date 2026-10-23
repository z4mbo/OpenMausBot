# Workspace pages and workspace context

The pages around the projects: Inbox, Chat and Call in the sidebar, Routines
(with scheduled calls), Triggers, Team map, Apps, Search, Settings, the
account menu, New agent and What's new. This recipe drives each of them in the
full renderer at 1280 and 375 px, dark and light, and checks what the
workspace head and a standalone agent are told about the workspace.

## Run

```sh
OMB_VERIFY_PLAYWRIGHT=<path to playwright's index.mjs> \
  node --experimental-strip-types scripts/verify-origin-workspace.ts
```

Nothing leaves this computer. The real Convex functions of `backend/convex`
run in memory (`scripts/testing/origin-campaigns-backend.ts`, reached through
`scripts/testing/origin-workspace-cloud.ts`), seeded with the workspace
"Fixture studio" and its projects Walkies and Bakery with open issues. The
server is the disposable fake-engine fixture with the workspace head, the
Chiefs Atlas and Bea, Nova on Walkies, the standalone agent Scout, two
routines, a scheduled call and a team chat message.

With `--park` the script prints the preview URL, the server URL and the ids
of the head and Scout, and waits, so the check can be rerun against it:

```sh
node scripts/testing/check-origin-workspace.mjs <previewUrl> <serverUrl> <headId> <scoutId>
```

## What the check proves

Before the browser starts it reads `GET /api/bots/ID/system-prompt` for the
head and for Scout. The head's prompt names both projects, their top issues,
the routines and the scheduled call; Scout's says it is one of the
workspace's agents outside its projects and carries the same overview
(`server/origin-workspace-context.ts`, unit-tested in
`server/origin-project-tools.test.ts`).

In each theme and width, failing on a page error or horizontal overflow:

- Inbox lists the seeded issues, and All issues adds Bakery's; on a phone
  the drawer closes when the page opens.
- Chat sends a message to the workspace channel.
- Call offers Start call.
- Routines lists both routines and the call; a call added and then removed
  through `POST /api/calendar-calls` appears and disappears when the window
  regains focus; New routine opens with its title focused and Escape closes
  it; Run logs and Webhooks open; no bot is labelled with a placeholder.
- Triggers, Apps, Search, What's new and New agent (titled New agent, with
  Create agent) open and close; Settings walks its groups; Team map shows
  six bots.

The report goes to `docs/verification/evidence/round7/workspace-report.json`;
`workspace-inbox.png`, `workspace-routines.png`, `workspace-chat.png`,
`workspace-team-map.png`, `workspace-settings.png` and
`workspace-new-agent.png` beside it are the 1280 dark views. Every other
screenshot is written to `origin-workspace` in the system temporary
directory.

Calls stop at the lobby: headless Chromium has no camera or microphone. The
fixture backend gives every issue the same short key, because in-memory ids
share their last characters, and the fixture account has no display name, so
the call preview shows no name.
