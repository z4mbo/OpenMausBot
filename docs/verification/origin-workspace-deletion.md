# Local workspace deletion and residual sidebar sections

Deleting a whole workspace, in Origin and on this computer, is described in
[Deleting a workspace and switching between workspaces](origin-workspace-delete-cascade.md);
the head's sidebar Delete now opens that dialog. This page covers what
deleting the head bot itself leaves behind: the bot, its conversation, files,
memory and owned computers go; shared team computers remain.

With two synthetic local workspaces, Primary and Secondary, deleting the
Secondary head previously left `Workspace: Secondary` in the saved section
registry. The primary workspace then showed an empty Secondary dropdown that
needed a second deletion. The reserved name also made a replacement import use
`Workspace: Secondary 2`; startup reconciliation could recreate a Chief for
the leftover section.

The store retires that reserved section only when no other bot, group chat or
shared team computer occupies it. Startup applies the same check to existing
empty reserved sections before creating missing Chiefs. It durably revokes
exact grants to a retired name before freeing it, so a later workspace with
the same name cannot inherit those grants. Unrelated project bots, their
conversations, ordinary empty team sections and nonempty workspace sections
remain. Unknown computer occupancy retains the section; an unreadable
computer registry stops retirement.

The production Store receives the shared computer lookup at construction.
All its deletion callers inherit that check: the normal HTTP deletion,
organization-library partial-install cleanup, package-import rollback,
bot-creation rollback and team-backup rollback. These are local operations;
the change adds no cloud mutation or automatic shared-workspace deletion.

Run the focused synthetic regression tests from an isolated checkout:

```sh
pnpm exec vitest run server/workspace-head-deletion.test.ts server/origin-import.test.ts server/store.test.ts server/origin-cloud-sync.test.ts scripts/testing/file-size-ratchet.test.ts
pnpm exec tsc -p tsconfig.server.json
```

The test setup creates a throwaway home before loading the real store. The
import suite runs real local HTTP handlers with a fake cloud client that
rejects every cloud mutation. It proves that a still-visible cloud workspace
can recreate its local head with the original section name and leaves the
saved cloud connection unchanged. It does not exercise a live account.

The identical final 33 deletion/import tests against the original
`0757f71888d2c5aaf41bd877724949a63d815aa2` Store and team modules produce
8 failures and 25 passes. The changed modules pass all 33. The larger focused
run passes 193 tests and skips one existing Windows case; the unchanged team
computer symlink test additionally fails with Windows `EPERM` at
`symlinkSync`, before its product assertion. That environment limitation was
retained without changing or skipping the assertion. Server types, touched
Oxlint checks and both decreased file-size limits pass.

The browser comparison uses the real App and sidebar with two disposable
fake-engine servers. The baseline loads the original Store and team modules;
the final fixture loads the changed modules. Both wait for startup
reconciliation before creating and deleting the synthetic heads through the
real HTTP routes. Only cloud synchronization is disabled in the preview so
unlinked local workspaces stay visible; no real Origin account is used.
The retained [manifest](evidence/origin-workspace-delete-031/manifest.json)
binds the screenshots, source hashes and test proof.

[Before](evidence/origin-workspace-delete-031/before-sidebar.jpg) /
[after](evidence/origin-workspace-delete-031/after-sidebar.jpg): the empty
Secondary dropdown disappears while the Primary head and standalone agent
remain.

An already recreated Chief is deliberately preserved: it may contain new
conversations or files. A reserved section containing another bot, group or
shared computer also remains rather than discarding work. Deleting a local
head while its shared cloud workspace remains visible can cause cloud sync
to import that head again; this fix removes the orphan section/name suffix,
not the cloud workspace.

Bot and section files are separate durable writes. A normal section-write
failure restores the bot roster before deleting transcript or bot data, as
the regression verifies. A process or power failure between those writes
can leave an empty saved section; the next successful startup repair removes
it. This is not an atomic multi-file transaction, and it is not packaged
Windows or macOS acceptance.
