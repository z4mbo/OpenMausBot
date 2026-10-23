# Evidence integrity: origin-agent-threads-043

Reviewed 2026-10-20T04:33:42.843Z. This checks retained bytes and references, without recapturing screens or rerunning the fixture.

## Provenance

The retained [browser proof](browser-proof.json) records 2026-10-19T21:44:25.399Z. Actual ProjectAgentsPage/ChatView/StoreProvider and disposable native server/fake CLI coordinator. Two browser views share that isolated server. Baseline transforms only the exact previous ProjectAgentsPage component; surrounding source and synthetic backend are current. No real provider semantics, cloud hosting, full App or packaged desktop claim.

Digests retained in browser-proof.json beside its checkedAt field. This review does not independently establish digest-computation time or browser startup identity.

## Recorded source bindings

7 of 8 recorded digests match the current file bytes. Drift: `shared/wire.ts`.

| Source | Recorded SHA-256 | Current SHA-256 | Result |
| --- | --- | --- | --- |
| `src/components/ProjectAgentsPage.tsx` | `bc0da387b9209d91d8f2e6026f10b49a2e6af93e0289288652ce1a419ccf938f` | `bc0da387b9209d91d8f2e6026f10b49a2e6af93e0289288652ce1a419ccf938f` | matches_current_raw_bytes |
| `src/components/AgentThreads.tsx` | `1d9eebdd75ed407267d033ee568f0f1c0f0284ba3c864484d6f48c5b89449827` | `1d9eebdd75ed407267d033ee568f0f1c0f0284ba3c864484d6f48c5b89449827` | matches_current_raw_bytes |
| `src/lib/origin-agent-navigation.ts` | `a1af6d3643a57e5dc20ff719841c05a538d062406f5b36cdcb9ddd7f8f710548` | `a1af6d3643a57e5dc20ff719841c05a538d062406f5b36cdcb9ddd7f8f710548` | matches_current_raw_bytes |
| `src/state/store.tsx` | `0d51034069faf7c33f744e14582894353367f1f6bc41430a4346bf4d0cbe4048` | `0d51034069faf7c33f744e14582894353367f1f6bc41430a4346bf4d0cbe4048` | matches_current_raw_bytes |
| `src/state/thread-navigation.ts` | `1dba4724bceffd6db9c15de765125588d7958336836d3213c3ad817960912a17` | `1dba4724bceffd6db9c15de765125588d7958336836d3213c3ad817960912a17` | matches_current_raw_bytes |
| `shared/wire.ts` | `97395362c195ddb0462e87afa612853f90d5ef3097f6337c7796e8fed5b3c469` | `902b640633a9062184485e563b17791660d9d7d9f68b1936d71698eb0068f47f` | current_source_drifted |
| `server/delegation-thread.ts` | `eb63c754afb25427c5081e82e3abb4d9dbeb45b62e5049487c94d8d83a6cea85` | `eb63c754afb25427c5081e82e3abb4d9dbeb45b62e5049487c94d8d83a6cea85` | matches_current_raw_bytes |
| `server/delegation-notification.ts` | `de01f45a324fbe93922e60d26322ca2aa42fe6d94b54c929317f9bdd4f3d6bcc` | `de01f45a324fbe93922e60d26322ca2aa42fe6d94b54c929317f9bdd4f3d6bcc` | matches_current_raw_bytes |

## Baseline

The recorded baseline component `src/components/ProjectAgentsPage.tsx` at `cf9e6fdec944700aa1ee395d05512afbaf95da97` matches the retained digest `28446999149990e7005ba84447e55de87961cc8c0b580e56372f167e36d68208` when read directly from Git. This identifies that component blob only, not a baseline of the entire app or server.

## Retained files

11 original files were hashed without modification. The existing [manifest](manifest.json) was preserved: 10/10 entries match current raw bytes.

- [after-delegated-desktop-dark.png](after-delegated-desktop-dark.png)
- [after-direct-desktop-dark.png](after-direct-desktop-dark.png)
- [agents-light-375.png](agents-light-375.png)
- [before-desktop-dark.png](before-desktop-dark.png)
- [browser-proof.json](browser-proof.json)
- [console-review.json](console-review.json)
- [delegated-light-375.png](delegated-light-375.png)
- [direct-b-after-project-follow-up.png](direct-b-after-project-follow-up.png)
- [manifest.json](manifest.json)
- [new-independent-thread.png](new-independent-thread.png)
- [same-notification-reopens-mobile.png](same-notification-reopens-mobile.png)

Image signatures and dimensions were read; their pixels were not re-reviewed. 8 of 8 screenshots have JPEG bytes despite their retained .png filename suffix. The raw capture bytes and filenames remain unchanged.

## Current inventory and limits

The [machine-readable review](integrity-report.json) records 10 current source paths at 2026-10-20T04:33:42.843Z, under Git HEAD `2a29a82702fef4f9b3b4c2c91e52fb3af72deab4` with an unfrozen working tree. These are review-time hashes and never substitute for capture-time bindings.

The [SHA-256 manifest](integrity-manifest.json) covers retained originals and both integrity reports, excluding itself. Git's text attribute is unset for the evidence folder; this review did not stage files or verify a commit/index round trip. No behavior, provider, native package or production acceptance is added by this archival check.
