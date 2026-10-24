# Deleting a workspace and switching between workspaces

## What changed

Delete workspace sits in the workspace switcher for the workspace's owner and
admins. The head's own Delete in the sidebar opens the same dialog. Members and
viewers are told only an owner or admin can delete it, and the backend refuses
them as well. The dialog lists what goes: projects, shared agents, open issues,
members, and the agents on this computer. It deletes nothing until the
workspace's name is typed exactly.

Deleting runs in this order:

1. On this computer: the workspace's group chats, its agents and project
   Chiefs, then its emptied teams. Each goes through the route a single
   deletion uses (`/api/groups/ID`, `/api/bots/ID`, `/api/sidebar-sections`),
   so computers, browser data, routines and memory go with it. A standalone
   agent goes only if it is shared through this workspace.
2. In Origin: `workspaces:remove`. It removes every membership at once, so the
   workspace leaves every member's list. A scheduled step then removes
   everything else in bounded, resumable batches: projects, issues, columns,
   comments, team chat, calls, invitations, Vault entries, assets and their
   files, feedback portals, shared agents and their threads, runs and hosts,
   notifications, and the dormant Studio, Design and Publish rows. The
   `resume interrupted workspace deletions` cron restarts a purge that
   stalled. GitHub repositories stay; only their links go.
3. The head itself. If anything fails before this, the head is still there, so
   deleting it again picks up where it stopped.

Deleting the last workspace leaves the account at the "create or join a
workspace" screen.

Switching workspaces had three faults:

- One team failing in the shared-agent round stopped the round for every team
  after it. A stale head link or a project without edit rights kept every later
  workspace's agents off this computer. Each team now syncs on its own, and
  links to teams outside the signed-in account are skipped.
- If one workspace's project list failed, the whole Origin round stopped. Now
  the other workspaces still import.
- The sidebar built its workspace list from the bots the search matched, minus
  pinned ones. A pinned workspace head could not be switched to. Every visible
  head is now offered.

## Run

```sh
pnpm test:backend
pnpm exec vitest run src/lib/origin-workspace-deletion.test.ts src/components/DeleteWorkspaceDialog.test.ts src/components/WorkspaceSwitcher.delete.test.ts src/lib/origin-shared-agents.test.ts src/components/OriginSync.test.ts src/lib/origin-workspaces.test.ts
node --experimental-strip-types scripts/verify-origin-workspace-deletion.ts
```

The backend test (backend/convex/workspaceDeletion.test.ts) seeds two workspaces through the public functions. It also
inserts rows into the dormant tables and 700 team chat messages, enough to
need several purge steps. After the purge it scans every table in the schema
for any row that names the deleted workspace, its projects, its agent or its
thread, and finds none. The other workspace's rows are unchanged. It also
checks:

- roles: member, outsider and a wrong name are refused, and an admin can
  delete;
- invitations: a workspace being deleted cannot be joined;
- files: a file still used by another scope survives;
- recovery: a stalled deletion resumes, and running it twice is harmless.

The fixture script runs the real Convex functions in memory
(`scripts/testing/origin-convex-backend.ts`) behind a disposable fake-engine
harness. That harness has its own data directory, and its ports are in
27310-27380. The script:

1. imports two workspaces and their projects through
   `/api/origin/import/workspaces` and `/api/origin/import/projects`, and adds
   one agent to each project plus a standalone agent;
2. switches to the second workspace and chats with its project agent;
3. deletes the first workspace with the renderer's own deletion code;
4. checks that no Origin row names the first workspace or its project, and
   that its head, Chief, agent, links and teams are gone from the harness while
   the second workspace and the standalone agent remain.

The script writes its checks to
[report.json](evidence/origin-workspace-deletion-cascade/report.json).

## Not proven here

- The dialog and the switcher are proven from component tests, not driven in a
  browser.
- Other members' computers keep their own local copy of a deleted workspace's
  agents until they delete them. That copy is hidden there, because the
  workspace is no longer in their account.
- No deployed backend was used. Adding the indexes (`teams.by_deletingAt`,
  `connectorGrants.by_teamId`, `notifications.by_teamId`) backfills them on the
  next deploy.
