# Origin 0.2.13 integration batch

This is an unpublished integration checkpoint. It batches the user's rapid-drag,
branding, unrelated Cloud subscription and one-row sidebar requests with the
held signup/logging/project-list work. Public 0.2.11 remains the last verified
delivery. Neither the earlier 0.2.12 builds nor a source commit establishes
publication of this batch.

The initial 0.2.13 freeze at `f44ebe30a9568ed634b9eb8a45476f42e4c059b1`
also failed CI. Its private draft, original annotated tag, native artifacts,
website image and staging bytes are retained under
`origin-candidate-v0.2.13-f44ebe30`. No publication was attempted. The
[CI follow-up](origin-ci-followup-034.md) records the terminal run and the
three logical corrections; replacement source-bound checks and artifacts are
required before this version can ship.

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
| P2: startup/tray, PWA installation, agent messages and setup copy identify the upstream product | `eeb992491`, `7a5716f74`, `795ca0077` | [Native startup, real pairing/onboarding and compatibility evidence](origin-branding.md) |
| P2: launch promotion points to the upstream Product Hunt page | `43d25faab` | Related notice/queue regressions passed at its worker checkpoint |
| P1: optional fleet upgrade executes the upstream npm install as root before restarting Origin services | `5821d0c0a` | [Four red-before regressions and executor recording](origin-cli-distribution.md); planning refuses before a mutation |
| P2: CLI setup and service recovery instructions launch the upstream package | `256509b8f` | Same report: six red-before cases, 189 selected passes and five existing platform skips |
| P2: optional Sentinel scheduling chooses an installed upstream app instead of Origin | `ec60e5a8a` | Same report: four red-before cases, 26 selected passes and one existing skip; native scheduling is separate |
| P2: the initial branding candidate skips an unavailable uppercase legacy computer descriptor on case-sensitive filesystems and mounts an older connection | `a9134c95b` | [Unmocked Linux filesystem before/after and priority controls](origin-ci-followup-034.md); the current Origin descriptor remains authoritative |

The user's one-row footer preference is implemented by `27ab9b426`. Its existing
39 focused checks pass. The [finite browser matrix](sidebar-footer-single-row.md)
retains 16 before/after captures: all eight updated cases stay on one line, with
contained, disjoint controls at least 25.125 px wide, correct keyboard order and
working Apps selection. [Product-copy integration](origin-branding.md) preserves
stored legacy restart warnings and the external relay's exact wire contract;
neither candidate-only regression reached production. The
[provider-error CI fixture](origin-ci-provider-error.md) now isolates its fake
HTTP 429 from unrelated MCP initialization. This reproduces the timeout mechanism,
not the unobserved timing of the original GitHub runner. The integrated Live-call
and full Comms files passed all 53 cases. Fresh CI is still required.

The initial 0.2.13 CI run completed all 24 jobs with 19 successes, four failures
and one intentional broker skip. Eight distinct assertions failed across three
platform shards: four stale product-copy expectations, three stale catalog
digest expectations and the Linux descriptor regression above. Test-only
commits `c2026a75e` and `ec3c964cf` retain the refusal, PWA, wire hash, tool,
schema and permission checks. The six affected files pass 104 cases locally,
with five platform skips; the real Linux descriptor probe passes six
comparisons. These results do not turn the original failed CI green.

The [landing image](origin-landing-capture.md) now comes from one real 0.2.13
renderer frame with the requested footer. Its seven product-module blobs match
the integration; the tooling-title correction changes no product pixels. Three
whole-frame derivatives preserve that capture, with the previous image retained.

## Release and inspection boundary

The current shared changelog rolls the four unpublished 0.2.12 notes into eleven
0.2.13 notes. It does not present 0.2.12 as a published history entry. In-app,
website, GitHub and updater copies must be generated from the same final source.

The final integrated client/shared run passed **5,992 cases across 567 files**
in 366.62 seconds. Its 1,350 bound inputs match at both run boundaries and at
the reporting checkpoint, while documentation/server-only commits advanced.
This is a boundary comparison, not continuous filesystem monitoring. The
earlier full diagnostic's four stale copy expectations and the corrected full
rerun are both retained in the [local integration record](evidence/origin-candidate-034/report.json).
Both TypeScript checks, full lint, locale validation and 43
release/documentation guards passed; current website tests passed 25 cases and
integrated Live/Comms passed 53. The raw successful UI log includes refused
loopback-port-3000 diagnostics; its terminal footer and process exit are green.
Replacement source-bound CI, Windows/Mac builds, artifact/feed validation and
public delivery remain pending. The original private compiled website has
16 qualified visual cases. All 1,350 client/shared acceptance bindings and all
151 website inputs remain equivalent at product checkpoint `ec3c964cf`;
the original reports retain their original sources and timestamps. Reuse is
input equivalence, not a new full test or browser run. A rebuilt image and its
eventual public routes still need their own release evidence. No new backend
deployment is required merely by changing the desktop
version. The [backend closure comparison](origin-backend-reuse-034.md) records
100 bindings at `ec60e5a8a`, equal to deployed 0.2.11 apart from the root version.
All 100 bindings were also carried forward unchanged at the local reporting
checkpoint. The final freeze must retain them before reusing that deployment.

This batch does not establish every feature or component as accepted. The
[feature acceptance register](origin-feature-acceptance-034.md) records 34 areas
and distinguishes historical inventory from actual runtime acceptance. The
[upstream review](origin-upstream-fit-034.md) distinguishes source-fit ideas from
tested adaptations. Cross-machine sender-runs/offline recovery, complete Chief
delegation and GitHub App review-to-human-merge journeys, real recipient email,
physical Mac/hardware/TURN and interactive installed-app acceptance retain their
separate limits. The conversation fix handles synchronous save failure, not a
cross-file power-loss journal. Existing Windows builds are unsigned; existing
Mac builds are ad hoc signed and unnotarized.
