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

### Every other member's computers

As `workspaces:remove` revokes each active membership, it writes one
`deletedWorkspaces` row for that member: the workspace's id and name, who
deleted it and when. Members the first step cannot reach get theirs when the
purge removes their membership. The rows outlive the workspace on purpose and
expire after 180 days. `workspaces:deleted` returns only the signed-in
person's rows, matched by their email as memberships are.

Each Origin sync round on a member's computer reads that list before anything
else. For each deleted workspace it removes the local copy with the same
helper the deleting computer uses: everything under the head linked to that
workspace, or, without a head, the agents shared through it. Group chats,
agents, project Chiefs and emptied teams go first through the single-deletion
routes, the head last. If the app stops midway, the head and its link are
still there, so the next round finishes the job; whatever is already gone is
skipped. If the deleted workspace was open, the round opens another one, or
the "create or join a workspace" screen if none is left. A notice in the
corner, which sits above that screen, says once per computer: "Studio was
deleted by Ada. Its agents, chats and teams on this computer were removed
too." If something cannot go yet, for example an agent that is still
working, the notice says so and later rounds retry.

Nothing is removed when:

- the list cannot be fetched (network error, older backend): the round goes on
  without it;
- nobody is signed in: no round runs;
- the account changes while the list or the workspaces are read: the round
  stops before deleting anything. A removal already under way finishes,
  because the workspace it removes was confirmed deleted;
- the account still lists the workspace;
- the person was only removed from the workspace. Removal writes no row, so
  the local copy stays on disk, hidden from the switcher because the workspace
  is no longer in the account, as before. If they are invited back, sync links
  the same head again. Their local agents may hold their own work, so
  removing someone does not delete them.

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
pnpm exec vitest run src/lib/origin-workspace-deletion.test.ts src/components/DeleteWorkspaceDialog.test.ts src/components/WorkspaceSwitcher.delete.test.ts src/lib/origin-shared-agents.test.ts src/components/OriginSync.test.ts src/lib/origin-workspaces.test.ts src/lib/origin-deleted-workspaces.test.ts
node --experimental-strip-types scripts/verify-origin-workspace-deletion.ts
```

The backend test (backend/convex/workspaceDeletion.test.ts) seeds two workspaces through the public functions. It also
inserts rows into the dormant tables and 700 team chat messages, enough to
need several purge steps. After the purge it scans every table in the schema
for any row that names the deleted workspace, its projects, its agent or its
thread, and finds none except one deletion notice for each of its three
members. The other workspace's rows are unchanged. It also checks:

- roles: member, outsider and a wrong name are refused, and an admin can
  delete;
- invitations: a workspace being deleted cannot be joined;
- files: a file still used by another scope survives;
- recovery: a stalled deletion resumes, and running it twice is harmless;
- notices: the owner, the admin who deleted it and the member each see it in
  `workspaces:deleted`, with who deleted it; an outsider, an invited person who
  never joined, and a member only removed from the other workspace see
  nothing; members whose membership the purge removes are told too; notices
  survive the purge and expire after 180 days.

The renderer tests (`src/lib/origin-deleted-workspaces.test.ts`,
`src/components/OriginSync.test.ts`) prove what a member's computer removes,
in which order, that a failed removal keeps the head and a later round
finishes it, that the notice appears once, that another workspace or the
"create or join" screen opens, and that nothing is removed when the list
fails, the workspace is still listed, the person was only removed, or the
account changes while the list is read.

The fixture script runs the real Convex functions in memory
(`scripts/testing/origin-convex-backend.ts`) behind a disposable fake-engine
harnesses, one for Ada (owner) and one for Bea (member). Each has its own
data directory, and their ports are in 27310-27380. The script:

1. imports two workspaces and their projects through
   `/api/origin/import/workspaces` and `/api/origin/import/projects` on both
   computers, and adds one agent to each project plus a standalone agent on
   Ada's, and an agent and a group chat in Studio's project on Bea's;
2. removes Bea from Shop and checks her computer keeps every local copy;
3. switches to the second workspace and chats with its project agent;
4. deletes the first workspace with the renderer's own deletion code;
5. checks that no Origin row names the first workspace or its project except
   the two members' notices, and that its head, Chief, agent, links and teams
   are gone from Ada's harness while the second workspace and the standalone
   agent remain;
6. runs the renderer's member-side cleanup for Bea: Studio's head, Chief,
   agent, group chat, links and teams leave her harness, Shop stays, a second
   round finds nothing to remove, and the notice text is reported once.

The script writes its checks to
[report.json](evidence/origin-workspace-deletion-cascade/report.json).

## Not proven here

- The dialog and the switcher are proven from component tests, not driven in a
  browser.
- The fixture calls the member-side cleanup the sync round uses rather than
  mounting the sync component; the round itself is proven by component tests.
- Agents shared through a deleted workspace whose own computer has no head
  for it are removed by `shared.teamId`, proven in unit tests only.
- A computer that stays offline, or signed in to another account, for more
  than 180 days after the deletion keeps its hidden copy: the notice has
  expired by then.
- No deployed backend was used. Adding the indexes (`teams.by_deletingAt`,
  `connectorGrants.by_teamId`, `notifications.by_teamId`) and the
  `deletedWorkspaces` table backfills them on the next deploy. A workspace
  whose deletion started before that deploy writes no notices.
