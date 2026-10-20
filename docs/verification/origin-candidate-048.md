# Origin 0.4.1 integration candidate

Prepared on 2026-10-20. This finite integration combines correction source `5aafbf02ab2ded075d2c75955419f35a45cce99a` with published 0.4.0 source `f76cbe9b8019b648bb08f9125daefe35e6625185`. Neither source or immutable tag is replaced. PR 3 still targets `origin-integration`; no app task PR is merged by this workflow.

## Concurrent publication and delivery boundary

A fresh read-only pre-delivery check found [0.4.0](https://github.com/z4mbo/Origin/releases/tag/origin-v0.4.0) published at `2026-10-20T06:37:29Z`, with both public update feeds and all three download aliases already naming 0.4.0. The running website image was `sha256:b3be41ef45f30a7cd6fa35babcbc1e17d29b937b5c7652705ced0bb8b2f54679`. The previous 0.3.2 publication guard refused the changed baseline before any production mutation.

The immutable 0.3.2 tag remains at `5aafbf02ab2ded075d2c75955419f35a45cce99a`. Its required local client/shared suite passed 604 files and 6,254 tests, with both TypeScript checks, lint, locale/release checks, Electron syntax and source/documentation guards passing. Those results remain qualified to that source. Native run 39382063332 and duplicate cloud tag run 39382063028 were cancelled as obsolete. No 0.3.2 assets, credentials, backend export/deployment, private website build or public promotion occurred. All 047 operators remain held.

## Integration scope

The newer source adds Pages, Campaigns, pipeline replies and sequences, monthly budgets, Chief heartbeats, call action items, lazy tool domains and local-browser/companion/egress security. The integration preserves these features and the [0.3.2 corrections](origin-candidate-047.md). Daily computer API limits and project monthly limits serve different scopes; both apply to eligible teammate-hosted work. Canonical What's new lists 0.4.1, followed by the published 0.4.0 and 0.3.0 history, omitting unpublished intermediate candidates.

The conflict resolution retains exact-thread cancellation and lease behavior, budgeted helper-model requests, call-note recording, channel readiness, responsive toolbars, monthly-budget indicators and the minimal Usage panel. Existing size limits use the smaller parent values; no limit is raised. A stale lead-detail UI mock is updated for the new sequence query and required settings field without relaxing readiness assertions.

Two additional concrete access/accounting scenarios receive regression coverage: a workspace member outside a private project could read its agent budget by known ID, and a teammate-hosted run ignored the same monthly budget checked by ordinary shared runs. The corrected backend requires project access, checks monthly admission throughout hosted ownership transitions, and records completed hosted usage once under its existing receipt fence. New public-facing upstream product names are changed to Origin while legal attribution and internal compatibility identifiers remain intact.

## Verification and remaining gates

Fresh combined-source checks cover changed backend paths, actual UI bodies, auth/egress interoperability, client/shared behavior, TypeScript, lint and required guards. The [retained correction evidence](evidence/origin-candidate-047/README.md) remains historical before/after proof; it is never relabelled as 0.4.1 acceptance. Production application data is not used for tests.

Publication remains pending an immutable combined source, exact successful replacement workflows, actual Windows/Mac package audit and isolated copied-resource smoke, backward-compatible backend deployment with fresh full-storage backup and verified temporary-key cleanup, private compiled-site browser acceptance, and independently hashed public downloads/feeds. Physical Mac installation, signed updater behavior, real subscription-provider billing and real recipient email delivery remain separate acceptance limits.
