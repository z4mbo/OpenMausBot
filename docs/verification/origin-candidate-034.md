# Origin 0.2.13 integration batch

This is an unpublished integration checkpoint. It batches the user's rapid-drag,
branding, unrelated Cloud subscription and one-row sidebar requests with the
held signup/logging/project-list work. Public 0.2.11 remains the last verified
delivery. Neither the earlier 0.2.12 builds nor a source commit establishes
publication of this batch.

The [033 source](origin-candidate-033.md) was frozen at
`87ff77be5ea79272175219d479b9a8017b4e8fcc`. Its exact-source CI run
[39166463163](https://github.com/z4mbo/Origin/actions/runs/39166463163) was still
running at this document's initial checkpoint; its terminal result is recorded
below. The native run
[39166452147](https://github.com/z4mbo/Origin/actions/runs/39166452147) was
deliberately cancelled when the user requested the additional fixes before
publication. Its private website image was not built. The older 032 annotated
tag, draft, artifacts, staging and image were archived separately without
changing their bytes. None of those outputs authorizes 0.2.13 publication.

Run 39166463163, attempt 1, completed with failure at `2026-10-18T21:45:23Z`:
21 jobs succeeded, Windows Vitest shard 3/4 and the aggregate CI job failed,
and the broker deployment was intentionally skipped. The failed Comms case
expected the fake provider's rate-limit text but received an MCP request timeout.
The shard passed 4,664 tests, failed one and skipped 101. The
[terminal CI record](evidence/origin-ci-033.json) retains source, job identities,
the actual assertion and the private raw-log hash. This differs from 032's
HTTP connection-reset failure; neither failed run is described as green.

## Integrated findings

| Finding | Logical fix | Evidence |
| --- | --- | --- |
| P2: rapid pointer moves stack card animations until other cards leave the board | `d57c0bfc6`, timing `1d54aab6f` | [Actual browser before/after](origin-issue-drag.md) |
| P2: an editor loses permission while dragging and still submits a move | `ce336ce77` | [Revocation/project-switch checks](origin-issue-drag-permission.md); backend still denies unauthorized writes |
| P1: failed metadata saves leave unsaved changes live; deletion loses SQLite messages before metadata saves | `fb43fec3b` | [Real filesystem and HTTP regressions](origin-thread-durability.md) |
| P2: default packaged Origin opens a vendor subscription offer from its computer menu | `7ce85eddd` | [Native policy and real component captures](origin-desktop-cloud-policy.md) |
| P2: saved server controls squeeze the name to approximately 6 px on a 375 px screen | `c6141cbbd` | Same report, with separate layout before/after |
| P2: phone/companion Live calls require an unrelated plan before checking the configured key | `c6371c2b4` | [Fake-provider HTTP calls and authority controls](origin-live-policy.md) |
| P2: self-hosted updates query upstream, miss Origin tags and offer upstream installation commands | `67d5d8a26` | [Checker, HTTP and isolated-server evidence](origin-update-channel.md) |
| P2: a nonsettling engine status probe keeps registry discovery pending | `67dbb03a8` | [Real registry with virtual-clock deadlines and a normal isolated server](origin-provider-snapshot-deadline.md); CLI termination escalation is deferred |
| P3: startup/tray and PWA install name show the upstream product | `eeb992491`, `7a5716f74` | Native startup proof retained by the branding review; current integration still needs final checks |
| P2: launch promotion points to the upstream Product Hunt page | `43d25faab` | Related notice/queue regressions passed at its worker checkpoint |

The user's one-row footer preference is implemented by `27ab9b426`. Its existing
39 focused checks pass. The [finite browser matrix](sidebar-footer-single-row.md)
retains 16 before/after captures: all eight updated cases stay on one line, with
contained, disjoint controls at least 25.125 px wide, correct keyboard order and
working Apps selection. Broader product-copy integration and the new CI fixture
investigation remain pending. These statuses must be updated before freeze.

## Release and inspection boundary

The current shared changelog rolls the four unpublished 0.2.12 notes into eleven
0.2.13 notes. It does not present 0.2.12 as a published history entry. In-app,
website, GitHub and updater copies must be generated from the same final source.

Final integrated client/shared, TypeScript, lint, locale, guards, touched server
and website checks are pending. Fresh source-bound CI, Windows/Mac builds,
artifact/feed validation, private website acceptance and public delivery remain
pending. No new backend deployment is required merely by changing the desktop
version: the complete final backend closure must first be compared with deployed
0.2.11 before deciding whether backend changes are necessary.

This batch does not establish every feature or component as accepted. The
[upstream review](origin-upstream-fit-034.md) distinguishes source-fit ideas from
tested adaptations. Cross-machine sender-runs/offline recovery, complete Chief
delegation and GitHub App review-to-human-merge journeys, real recipient email,
physical Mac/hardware/TURN and interactive installed-app acceptance retain their
separate limits. The conversation fix handles synchronous save failure, not a
cross-file power-loss journal. Existing Windows builds are unsigned; existing
Mac builds are ad hoc signed and unnotarized.
