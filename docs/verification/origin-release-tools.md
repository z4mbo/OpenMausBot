# Origin development and release tools followup

## 0.2.10 operational checkpoint

The [0.2.10 delivery](origin-delivery.md#0210-delivery) and [permanent receipt](evidence/origin-delivery-030/delivery-receipt.json) record actual exact-source CI/native success, public client hashes, a fresh full backup, authenticated existing dev target, five bounded migrations, matching website and revoked temporary key. These actual results are distinct from the historical mock/subprocess and byte-equivalence checks below. The reviewed release source is `0eb372a94715527931043a1b6d8c02a50194dbb0`; earlier 0.2.7 tooling checkpoints retain their original scope.

## Historical tooling checks


[Verification index](README.md) · [Sanitized proof](evidence/origin-release-tools-027.json) · [Release delivery and cleanup limits](origin-delivery.md)

These development/operations corrections follow the immutable `origin-v0.2.7` source `dbdac25fcd014d231e694aa8665d326b235af616`. They are not included in that shipped tag and do not replace, relabel or require rebuilding its Mac/Windows artifacts. All three post-publication fix commits match the proven candidates. Actual scoped tracked runs are recorded separately from the historical private regressions.

Locations identify affected source at the frozen checkpoint. The regression counts below describe retained private candidate tests plus explicitly recorded applied tracked tests. Their scope does not establish production/hardware acceptance.

| Severity | Concrete scenario and source | Correction / fix commit | Evidence |
| --- | --- | --- | --- |
| P1 | A request to a Vite development listener retrieves a credential, raw token log or JSON from a root/nested .omb-scratch folder. `vite.config.ts:52` has no scratch deny rule. This proves local HTTP exposure, not internet or cross-origin exploitation. | Preserve Vite 7.3.6 defaults and add `**/.omb-scratch/**` at shared server.fs.deny. `8a4d86a0357a89b87fdc2afa6720a4266015b710` | 24 scratch requests return 200 before; all 46 tests pass after: 24 scratch403, 20 original default403, two ordinary200. |
| P2 | The existing public backend is type dev, but `scripts/deploy-origin.mjs:79` requires a production-prefixed deployment key. Valid exact-target authority is rejected before backup; a synthetic wrong prod type is accepted. | Pin the exact existing deployment name/type and require a nonempty opaque key portion. `61b1e69a61946a0c34dae8389816a6bb1e62f7ce` | Genuine red: three failures/13passes. Candidate:16passes, zero skips; existing five site guards retained. |
| P2 | A selected Node executable still launches `npx convex` through PATH/shims at `scripts/deploy-origin.mjs:93` and `scripts/deploy-origin.mjs:99`, allowing a different runtime. | Invoke the selected `process.execPath` with the exact installed backend Convex CLI, same cwd/arguments/order; keep the unrelated pnpm staging shim. `26373ef14ce8e1d9ed1a03793b3ab4d5e41d84a3` | Genuine red: four failures/14passes. Candidate:18passes, zero skips; exact executable/CLI/cwd/argv/order and failed-export stop proven under an unusable child PATH. |

## Evidence and packaging boundary

Actual committed-source runs pass 46 Vite HTTP tests and 18 final deployment-helper tests, with zero failures or skips. The intermediate authority commit independently passes 16 tests; those 16 cases are retained within the final 18 and are not added again to the final total. Log hashes and exact fix commits are recorded in the sanitized proof. These actual runs remain distinct from the historical red/green candidate counts below.

The Vite fixture loads the actual repository config/plugins with a separate synthetic root/env/cache, strict free loopback port, disabled publicDir and dependency discovery. It requests root/nested credential/log/JSON files through ordinary, /@fs, percent-encoded-dot and encoded /@fs paths; it also retains .env/.env.local, CRT/PEM and .git denials. Both successful and expected-red runs close their owned listener, rebind its port and remove the exact marker-verified temp root. No existing user preview, credential or account was requested.

Root applied the Vite fix as `8a4d86a0357a89b87fdc2afa6720a4266015b710` and reran the tracked test: all 46 cases pass. A separate synthetic-only existing-preview check records 403 on core5173/core5175 and the restarted owned pages5176. The retained old pages5174 still returns 200 for the harmless canary under its old policy. Its stop was rejected by approval review and no bypass was attempted. No actual credential was fetched over HTTP. This remaining listener is an explicit reason external credential/log storage remains mandatory; the fix is not claimed active in every existing process.

Two fresh sequential Vite API builds use the same frozen source/config and inherited environment, changing only unique output directories and the proposed server.fs.deny on the second build. All **580 files / 38,017,414 bytes** match exact filename, size and SHA-256; the sanitized evidence retains the full relative output manifest. Independent backend/site/Electron/server/shared/package/client inputs have zero diff. An earlier same-process verifier reached its default heap limit on build two and is excluded from this comparison.

server.fs.deny governs Vite development/createServer, including the UI fixture preview launchers. The separate `vite preview` command serves build.outDir without this gate; private files copied into dist are not covered. The exact-byte local build result does not establish native, hardware or production acceptance.

The authority/runtime tests execute real helper entry points in isolated synthetic subprocesses while intercepting every deployment child process. They prove key type/name validation and selected-process propagation, not successful real backup/deploy. Root observed a Windows Node24.19 `UV_HANDLE_CLOSING` abort; its native cause remains **unproven**. The exact process contract defect is proven independently. The runtime candidate tests themselves ran under Node24.19; no global minimum version or packaged runtime change is proposed.

## Private credential procedure and fail-closed history

Temporary deployment credentials and raw create/revoke logs belong in a protected directory outside every repository and Vite-served root. Create a uniquely named temporary key into an external private file with --save-env, record ownership without copying its value, and revoke that exact key in finally even when creation outcome is uncertain. Verify the external file and both historical scratch credential files are absent before final evidence. Keep raw token logs external; publish only sanitized target, hashes, aggregate migration completion and revocation facts. The release receipt contains no local credential path or token. This is an operator procedure; no new credential action is performed by this report.

The actual release continuation had three distinct stops: (1) an incorrect prod-prefix assumption rejected the valid existing dev target before backup; (2) correct authenticated metadata was followed by Node24.19's native abort before backup; (3) a full backup and backend deployment succeeded, then generated-output preflight stopped before migrations/site. Each temporary key was revoked and its credential file removed. The third stop preserved the generated diff privately and restored only five generated files to the frozen source. The private live adapter separately pins authenticated deployment name/type/URL and direct portable Node24.21. Final migration/site/publication status comes only from the linked delivery receipt, not these synthetic tests or earlier stops.

Earlier automatic approval review rejected cleanup of some other fixtures; the [delivery record](origin-delivery.md) preserves retained directories and preview-session limits. This followup does not authorize alternate deletion or process-stop mechanisms. The two storage-module type imports/maps omitted at the 0.2.7 checkpoint were included by `560eaa1cdb1e49f330d8c1ad91c2cbd197fa8096` before the published 0.2.10 source freeze. The [delivery record](origin-delivery.md) identifies their matching generated API blob; the original tooling receipt remains historical evidence.

## Reproduction

The scoped commands are `node node_modules/vitest/vitest.mjs run scripts/testing/vite-private-files.test.mjs` and `node node_modules/vitest/vitest.mjs run scripts/deploy-origin.test.mjs`. No real provider, deployment or credential is needed. The recorded applied runs use the commits above. Their source scope and exact candidate content were checked, including unchanged application/backend/site/Electron/server/shared/package inputs. Earlier private red/green tests and local byte equivalence remain source-qualified evidence rather than a replacement release build.
