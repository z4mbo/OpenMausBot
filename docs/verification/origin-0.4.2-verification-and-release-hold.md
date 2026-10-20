# Origin 0.4.2 verification and production hold

The 0.4.2 app candidate passed its final CI matrix, native package inspection and isolated Windows server/browser smoke. **It was not published.** During verification, another task deployed a website containing newer 0.5.0 source and continued editing the main checkout. Publishing this candidate over it would discard concurrent work. One release owner and a stable integrated source are required before production delivery continues.

The immutable candidate source is `7e89e33def92a3cce1b574a12e478eb392133fa2`, tag `origin-v0.4.2`, on [PR 3](https://github.com/z4mbo/Origin/pull/3). This report is a subsequent documentation update; it does not relabel its commit as the tested app source. No task PR was merged. The [evidence archive](evidence/origin-release-hold-049/README.md) records exact source boundaries, hashes and the explicit delivery hold.

## Completed verification

| Gate | Result on the immutable source |
| --- | --- |
| [CI 39393325724, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39393325724) | All 20 jobs completed: 19 succeeded and the expected PR deployment skipped. All eight Linux/Windows Vitest shards passed; TypeScript, lint, packaged smokes and aggregate CI passed. |
| [Backend/site 39393325708, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39393325708) | 35 files / 293 backend tests, backend typecheck, 2 files / 31 site tests and production Next build passed. |
| [Docs 39393325713, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39393325713) | Build, typecheck and lint passed. |
| [Native 39393415574, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39393415574) | Windows x64 and macOS arm64/x64 builds passed, with canonical version/changelog checks. |
| Actual package audit | All three target resources passed brand, version, architecture, updater-feed, frozen-source and selected compiled implementation checks. |
| Actual copied Windows server/browser smoke | Passed health/search, all 13 proxy paths, MCP initialize/health/drain, doctor/bots, encrypted backup, two desktop-entry starts/cache and bundled browser discovery. No provider credentials or production data were used. Owned processes, listeners and temporary files were removed. |
| Frozen backend archive | 287 files typechecked. Fresh compiled 75-table compatibility preserves both earlier parents' tables/indexes and requires no migration. This is source compatibility, not production acceptance. |
| Private compiled website | Build and source/version labels passed. Browser acceptance remains incomplete; no fixture or static build is substituted for it. |

The PR's actual merge checkout `bb4204f926fde779010f63eaf158e7e8a6ed61f2` has all 8,365 recursive tree entries identical to the release source. Actual checkout logs cover all four workflows. The [earlier integration report](origin-candidate-048.md) separately qualifies 6,275 local client/shared passes and its focused backend/UI results; those are not a new whole local execution on the literal/version correction.

The two downloaded GitHub workflow archives total 1,853,540,321 bytes. All 15 prepared distribution files total **1,858,102,633 bytes**. The [release manifest](evidence/origin-release-hold-049/release-manifest-0.4.2.json) records 13 payload/feed files; [SHA256SUMS](evidence/origin-release-hold-049/SHA256SUMS-0.4.2.txt) covers those records. The manifest and checksum file are the remaining two distribution files. No draft release or GitHub assets were created.

| Receipt | SHA-256 |
| --- | --- |
| Final native audit and smoke | `1bc70ee4d5387e8a3e5c9fc896f9291a4e430bf230f59794fcb0420f91aab938` |
| Passed three-target static proof | `b14fdd3df2d9f49230dda16770a40eb19bc40a2738bd34ce87ff3247adc1cf0a` |
| Distribution manifest | `1958d0d15e37f6c48eb8c848fb8aa1d2792d5ca23d42f87a80e45073f71bbf7d` |
| Distribution checksums | `ba73ac7b41ef250177fcca1940c8ed5013e3fab4207b9feacc3ea4ccc8668813` |
| Private site build | `79f062de0a290478d8cc24a7e05693a2be29627084c24b3d13d4f6dc7a678a2c` |
| Concurrent source comparison | `f515e9484c2574f3944d827bdb132b903a0eb66a7a1e2ea8f35977bbe74383a6` |

## Bugs, UI and delivery corrections

The [integration report](origin-candidate-048.md#concrete-integration-fixes) lists each app bug, scenario, severity, source and fix commit. It includes private-project budget access (`1697edd4a`), hosted monthly-cap/accounting (`a4af30264`), the narrow chat budget header (`d03d8ddf8`), Canvas panel visibility and wheel behavior (`ccb65fbab`, `86b9326af`), and visible upstream promotions (`6d1c772d1`). The [0.4.2 correction report](origin-candidate-049.md) adds compatible phone-setup wording (`bfccd2a3f`) and the stale browser-refusal test expectation (`40bb8be3a`). The corrected phone suites passed 66 tests; the actual hostile-page Chromium case passed. The preceding failed CI remains recorded honestly.

The [UI archive](evidence/origin-integration-048/ui/README.md) contains 20 feature and before/after captures, actual component bindings, narrow-window geometry and bounded interactions. Shared thread navigation, fallback/source ordering, Usage, chat layouts and other earlier changes retain their linked reports. These are isolated synthetic checks, not production account tests.

Actual delivery checks exposed verification-helper issues before publication. Windows plain sources and the smoke script use CRLF checkout serialization. The repaired comparator accepts only raw Git bytes or exact Windows LF-to-CRLF serialization; Mac still requires raw equality. A selected compiled closure needed lexical capture resolution for `files2`/`store2`; its declarations, initializer ASTs and references are verified before the entire selected body is compared. Eight line-ending guards and nine capture guards passed. The final smoke consumes the exact already-passed static proof, rehashes retained resources and runs three frozen Git source files from an isolated temporary tree; it repeats neither extraction nor successful static work.

The initial private upload failed because its restricted environment omitted standard Windows OS/identity variables. An 80,426-byte harmless SSH control succeeded with the corrected allowlist. Read-only reconciliation proved the private directory absent before one explicitly admitted retry; that upload and the single Docker build succeeded. The first browser controller then encountered Docker 27.5.1's empty published-port map on an internal bridge. Exact owned cleanup passed. A tested controller repair keeps the internal network, removes host publication and confines the SSH forward to the verified container endpoint. It was not claimed as successful browser acceptance: the next admission stopped before starting when it detected the changed production image.

## Why publication is held

At 09:38 UTC on October 20, GitHub latest and both public feeds still named 0.4.0, but the running website image had changed from `sha256:b3be41ef45f30a7cd6fa35babcbc1e17d29b937b5c7652705ced0bb8b2f54679` to `sha256:a70d46e9fa00195b221e68a0a194cf4399ee92ae8cd4ead97891fc7713f6a767`.

A uniquely labelled, read-only diagnostic container of that exact image was created with no network or mounts and was never started. Only explicit source paths were copied for hashes; no account data or environment values were read. All 321 existing inspected files match concurrent main commit `97383097d13e5c9bb969801623e6ccd9ed3b356f`, titled “Origin 0.5.0: Launchpad, Docs and milestones, Ship, Brand kit, Pulse.” Eighteen existing files differ from both the 0.4.0 baseline and this candidate. This establishes a source fingerprint within the inspected paths, not complete image-build provenance. The exact owned diagnostic container was removed.

The main checkout also had uncommitted Pulse and project-context/test work. It was only read. The [handoff](evidence/origin-release-hold-049/concurrent-handoff.md) and [source comparison](evidence/origin-release-hold-049/concurrent-source.json) retain the evidence. Blindly changing the old publication baseline would overwrite real concurrent changes; the release guards were not weakened to do so.

The private-budget access defect remains present in the inspected 0.5.0 source at `backend/convex/budgets.ts:160–161`: workspace membership goes directly to private-agent budget lookup without the project membership gate. The existing `1697edd4a` patch and regression test are ready for integration. This retains the earlier P2 classification and is a source finding, not a production query test. The candidate's hosted monthly-cap fix is absent together with the entire hosting module; no reachable hosted bypass is invented for 0.5.0. Ordinary shared-run budget checks/accounting remain there.

The explicit hold disables all further 0.4.2 delivery. No backend key, export or deploy, public website promotion, feed/alias switch, GitHub draft/assets or release publication occurred. Existing invitation-mail configuration, the user's live servers/Convex process and concurrent source remain untouched. The verified private image `sha256:af52ccde9fb6a84e6b915ebc6d95634ff8038202e1e2ce8ca51f8d235376c396`, prepared packages and failed-attempt evidence are retained. No rollback image or historical public download was pruned.

The next release needs one owner: finish/freeze the concurrent source, integrate these fixes while preserving 0.5.0 work, and select one version/source for final validation and publication. Rebuilding or publishing the superseded candidate while another task continues deploying is not a supported recovery.

## Upstream opportunities and limits

The [upstream reconciliation](evidence/origin-candidate-047/upstream-reconciliation.md) evaluated 36 merged PRs through the October 20 review checkpoint. Five adaptations are already present: OpenRouter free-model setup (#3097), bounded SSE replay (#3127), native log payload markers/redaction (#3129), single bus serialization/redaction (#3130) and idle-thread cache reload (#3132). They are not missing-feature suggestions.

HTML attachment previews (#3090), specialist templates (#3095) and loopback HTTP MCP (#3124) remain candidates for a separate Origin-specific adoption review. Recheck them against the frozen 0.5.0 integration before implementation. Keep one adaptation per commit with project access, lease/owner, approval, cancellation and context-isolation coverage. Do not wholesale-merge upstream cloud subscriptions or authority policy.

Useful product ideas to reassess after that integration are a teammate-host availability/ownership badge, a project-to-specialist thread map and a spend view distinguishing monthly project caps from daily computer limits. These are proposals, not claims that 0.5.0 lacks them. Physical Mac installation, signing/notarization and actual updater journeys, real subscription fallback/reset accuracy, provider invoice accounting and recipient email deliverability retain their separate acceptance limits. macOS notarization was skipped in the recorded workflow.
