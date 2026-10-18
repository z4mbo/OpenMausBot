# Origin release delivery

## 0.2.10 delivery

Origin **0.2.10** is published from frozen source `0eb372a94715527931043a1b6d8c02a50194dbb0` (`origin-v0.2.10`). [CI 39131925881, attempt 1](https://github.com/z4mbo/Origin/actions/runs/39131925881/attempts/1) and [native 39131922063](https://github.com/z4mbo/Origin/actions/runs/39131922063) succeeded on that source. The public GitHub release, all 13 payloads, two metadata files and three aliases, backend, five bounded migrations and matching website are verified. The deployment key was revoked at `2026-10-18T14:16:39.3562237Z` and its file is absent. [Delivery receipt](evidence/origin-delivery-030/delivery-receipt.json) (SHA-256 `247e4a0dfc19c473b7eea3093bf759ee9777f327850dd5fe44ca6753d110c297`) and [evidence report](evidence/origin-delivery-030/report.json) (SHA-256 `f2f13eafb07b0f1a1b92458daa16c76d31c64d1277edc562f43788b315af7af6`) retain the actual results.

The pre-freeze local checkpoint passed 5,960 client/shared cases across 561 files, 515 touched server/shared cases with five existing skips, 175 backend cases, 14 site cases and 121 guard/release/deployment cases. The unchanged final Activity regression failed one/passed six before correction and passed all seven afterward. The real-App source fixture shows automatic receipt refresh after a visible-composer turn; its 0.2.9 footer, fake provider and controlled HMR remain explicitly qualified. The actual [in-app What’s New gallery](evidence/origin-app-whats-new-030/manifest.json) contains four new captures with 16 article and 128 note-title/body comparisons against the frozen canonical source; component/keyboard evidence does not establish native updater acceptance.

Manifest SHA-256: `cbf75496f263d9b4608c4ea8b70963c3e5ae175600c805831423aca17e9ce1f9`; checksums: `c3384c776cba5781d9c7ec76076e8435bc2eaa3ce6b1d5b80719441b9ea4293e`. Site image: `sha256:4dfdb35d3736cae71bd5a1498b8901e3328480966a72f5cbb0d465cb5272fe7b`; context identity: `a6618c614b3a802368f7a97b2df9b35768a6ffb27a933979ed40a685186154e4`. The fresh storage-inclusive backup SHA-256 is `e7da76d6ba2eb0261f0b0ff7d7fc5d0ad3e6ed6b203be00b799afcff0e2ae176`. The authenticated target remains `wry-fly-446` (Convex `dev`) at its existing pinned cloud URL; no target switch is implied. Only aggregate migration checkpoints are retained.

| Migration stream | Done | Pages | Admitted |
| --- | --- | --- | --- |
| users | true | 1 | 3 |
| projects | true | 1 | 0 |
| workspaceAgents | true | 1 | 0 |
| designAssets | true | 1 | 5 |
| drawingFiles | true | 1 | 1 |

Public browser verification at `2026-10-18T14:19:51.023Z`, after key revocation, passed all four routes with five current notes, three platform links and zero account submissions. [Public landing](evidence/origin-delivery-030/public/landing.jpg) is separate from the sixteen private compiled-image cases. The canonical history has four release articles and 32 titles. All 32 full notes matched the canonical source in the live DOM. The public signup route displayed its invite-only notice; account authentication was not exercised.

The user-approved free Brevo account was created. The required organization address has been submitted; onboarding remains in progress. Brevo requires the user to complete phone verification before API-key creation and sending. Domain authentication remains pending; no provider key has been created; transactional sending is not activated. Hosted invitation email is not configured; public invitation links remain available for manual sharing. No real recipient email has been sent. Provider acceptance does not establish inbox delivery.

Windows packages are unsigned. Mac packages are ad hoc signed and unnotarized with manual updates; interactive macOS installation, signed-updater, real-provider/hardware and cross-machine/TURN acceptance remain separate. Provider acceptance does not establish inbox delivery. The continuing review remains scheduled for 06:00 Europe/Rome.

## Historical 0.2.7 delivery

Origin 0.2.7 delivery is complete. This record distinguishes published artifacts, deployed services and isolated verification. The review PR stays open; no product task PR was merged.

Origin **0.2.7** is published from frozen source `dbdac25fcd014d231e694aa8665d326b235af616` (`origin-v0.2.7`), with successful exact-source CI and matching Windows/Mac packages, public download/feed verification, backend deployment, all five bounded storage migration streams and the website rollout. The temporary deployment key is revoked and its local file is absent. Earlier candidates 0.2.2–0.2.6 were never published; their failed or withdrawn CI/build evidence remains historical. [CI recovery](origin-ci-recovery.md) preserves the Sidebar guard correction and unexplained first-attempt network reset; [UI evidence](origin-ui-followup.md) retains its original before/after source identities.

## Release verification and receipts

For 0.2.7, all 5,888 client/shared tests across 557 files pass in 374.06 seconds. Client and server TypeScript, full lint, 132 backend tests, 36 guard/release/documentation tests and the 18-entry release validator also pass locally. The production rollout helpers pass 20 mocked safety gates and an independent read-only review; those checks do not establish a deployment. The exact-source CI/native and public receipts below complete release delivery; physical and signed-updater acceptance remains separate.

Native cancellation fix `131878667` retains interruption ownership through asynchronous native dispatch and settlement, then clears resources before the next lane work. Controlled synthetic Windows worker pressure proves the old query can start after its early abort/interrupt; genuine pre-fix regressions fail four assertions, including actual HTTP replacement settlement. The corrected engine/lane/HTTP-route suite passes **51 tests across three files** in 10.98 seconds, with server TypeScript, focused lint and whitespace checks passing. Replacement/disconnect cancellation and the last committed card/table are asserted. The original 15-second test timeout remains unchanged; no retries, skips or relaxed assertions supply this result. Earlier pressure runs with an undeclared fixture variable are invalid and excluded. [Sanitized report](evidence/origin-native-cancellation/report.txt), [valid red](evidence/origin-native-cancellation/valid-red.log), [final green](evidence/origin-native-cancellation/final-green.log).

The [UI followup](origin-ui-followup.md) records exact source identities, before/after captures, shared focus ownership (`62fe9d9a3`), reusable below-placement submenu support (`70eb5fecd`), Files initial-state recovery (`576bbb2c6`) and readable filled-control states (`7052c78c2`). The below-placement issue was a reusable configuration defect; current shipped below callers have flat entries, so no shipped Help route is claimed blocked. Its manifest covers 360 PNGs with separately qualified matched and after-only evidence. These fixtures do not substitute for full-app or packaged acceptance.

Electron fixture fix `01685a95a` corrects all nine original Windows failures with native fixture paths, a synthetic home and deterministic read denial. The subsequent local full run records **783 pass, 15 existing skips and four environment failures**. Both AppImage cases then pass with Git's existing `mv` added only to the child PATH; two symlink cases still fail locally with `EPERM`. The full Electron suite is not claimed locally green. [Exact evidence and remaining limits](origin-ui-followup.md#windows-fixture-correction-and-remaining-limits).

At the 0.2.4 checkpoint, integrated touched-server, release, architecture and documentation checks passed 42 files and 1,352 tests, with 19 existing platform skips. Client/server TypeScript and full lint passed. Independent review confirmed the preserved durable-import, request-attribution, authority-filtering and renderer-export invariants. These are checkpoint results. An initial 0.2.6 full-client run exposed a test-harness regression corrected in `5542cccfd`; the corrected final run passed all 5,888 tests across 557 files in 344.97 seconds. Source 0.2.6 still failed the separate file-size guard. Final 0.2.7 CI/native outcomes are recorded below.

The retained P1 correction in `9c1510a03` closes live browser views when their bot becomes invisible to the viewer, even when the browser and member sessions remain valid. The old real permission predicate fails two regressions; the production `BrowserLive` class with synthetic transport also receives a second private frame before the fix. The corrected focused access/browser suite passes 114 tests with 12 existing Windows/OS skips; server TypeScript and size/legacy guards pass. The standard isolated browser route fixture exercises startup, doctor, seed, authentication/CSRF checks and missing-engine 503 handling. It does not establish successful live-stream revocation through a real browser HTTP connection.

The [native two-peer call follow-up](origin-calls.md#native-two-peer-follow-up) passes five scenarios using production `MemberCall`/`MemberCallHost`, actual HTTP member routes and SQLite in two independent Chromium contexts. It proves real local audio/video RTP, remote audio playback, signaling/data channels, replacement/reconnection and cleanup. The evidence records source `9e1b40440`; the call implementation is unchanged from `eb981de95`. Identities and devices are synthetic, ICE servers are empty and external HTTP/WebSockets are blocked. Hardware, TURN/internet traversal, Electron prompts and production authentication remain separate gates.

An earlier Windows renderer run passed 13 tests, with one native one-shot CLI bootstrap failure and one existing POSIX-only skip. The failed team-share case then passed unchanged. All five supported browser-evidence cases passed, and a separate focused persistent-MCP comparison passed two tests. Passive observation reproduced a native CLI daemon exit/restart during cold start, independently of the corrected fixture socket location. Corrected 0.2.5 CI subsequently passed all 15 renderer tests. This records both results without treating the earlier verification-tool limitation as a production persistent-MCP defect or claiming provider acceptance.

The historical 0.2.4 Linux shard-1 CI failed before provider-key saving because its generated `gated-acp.ts` fixture was `0644` but directly executed on POSIX. Test-only correction `8027fe057` supplies mode `0755` in `server/opencode-provider-keys.e2e.test.ts`; both Windows cases pass. An independent WSL kernel check with a synthetic interpreter proved `EACCES` at the old mode and exit 0 at the new mode; Linux Node was not run locally. Corrected 0.2.5 CI `39080943442` passed both real Linux provider-key cases. Those unrelated Windows failures prevented publication of 0.2.5; that candidate remains withdrawn. No production CLI bug is claimed from this executable-mode fixture failure.

Exact guarded cleanup of some synthetic temporary directories was rejected by automatic approval review as “blocked by policy.” Their owned processes are stopped; the rejected deletion was not retried through another mechanism. In addition to the earlier feature-report paths, the stopped `openmausbot-verify-data-J3amUQ` fixture and seven renderer partial fixtures remain; the latter's exact paths are in the local cleanup evidence. The intentionally live user previews are separate from those retained directories.

Automatic approval review also rejected Ctrl-C for earlier preview sessions `49711` and `26316` under `AskForApprovalNever`. Those previews remain running on ports 5173/5174; no alternative stop mechanism was attempted. The intentional user previews on 5175/5176 are separate. The main checkout's services on 5199/8799 and local Convex on 3210 remain untouched.

### Published 0.2.7 receipts

The [public GitHub release](https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.7) is release ID `416342023`. [CI 39112787205, attempt 2](https://github.com/z4mbo/Origin/actions/runs/39112787205/attempts/2) and [native run 39112820614](https://github.com/z4mbo/Origin/actions/runs/39112820614) both succeeded at `dbdac25fcd014d231e694aa8665d326b235af616`. The first CI attempt had one Windows shard-3 `fetch failed` / `read ECONNRESET` failure; its cause remains unproven. Two unchanged local 32-case comms runs passed, including exact CI Node 24.21.0 / Undici 7.29.1, before one bounded diagnostic rerun of only that failed job. A later pass does not identify the reset's cause or erase the first failure.

All 15 release assets (13 payloads plus manifest/checksums) match their frozen sizes and SHA-256 values. Public verification covers all 13 payloads, both metadata files and three download aliases, with 18 canonical changelog entries. The [public manifest](https://origin.imbored.fun/downloads/release-manifest-0.2.7.json) is 2,244 bytes, SHA-256 `d8cac6d5589b01a1f2605c8e92cdbf0a421b483a88a8819675071525c8654eab`; [SHA256SUMS](https://origin.imbored.fun/downloads/SHA256SUMS-0.2.7.txt) is 1,180 bytes, SHA-256 `55053a4478e7e90931a8e473522c15c375dab3fd700a3fee189023f2ccd0a3bb`. Payloads total 1,947,881,460 bytes; the full 15-file release totals 1,947,884,884 bytes. The Windows portable ZIP retains its distinct `windows-x64` name.

The [public release-history page](https://origin.imbored.fun/whats-new) is verified at 0.2.7. The deployed website image is `sha256:5d59beb1676c192b4368d731be1b1be1e53407ff0168ae16385cb4568f79ccca`, bound to the same frozen source and its pinned context identity `3bf37c09f24f1d68e94c8548f3df68096e697a57a305196bb17abf9f0acd0afb`. [Permanent delivery receipt](evidence/origin-delivery-027/delivery-receipt.json) (SHA-256 `bd544f7418085c4ff2317fe08b689603344bc952fe7d27adf8a12cf2bae061e0`) and [browser/evidence report](evidence/origin-delivery-027/report.json) (SHA-256 `58fe67ce2139a031073b229f96ef9e131dce1c9ab5154e631f1fe97a0156e3e1`) preserve actual verification outcomes separately from the 32 private compiled-image browser cases.

Backend deployment used a fresh storage-inclusive backup with SHA-256 `39c5e0eb8f453d812a62b806e3111f8a97409d3655259bd8fa3c5704aa3fdc02`. All five bounded migration streams completed; only aggregate checkpoints are recorded here. The deployment key was revoked and the local credential file removed. No backup contents, row data or migration cursors are included.

The existing public backend is Convex deployment `wry-fly-446`, classified `dev`, at [its pinned cloud URL](https://wry-fly-446.eu-west-1.convex.cloud); this release did not switch targets. An initial attempt rejected a valid temporary key before backup because the private adapter incorrectly assumed a production-prefixed target. That key was revoked and its file removed. The corrected guard authenticates the child CLI and requires the exact deployment name, type and URL; its latest verification at `2026-10-18T10:12:43.504Z` follows the fresh backup and precedes key revocation.

A second attempt authenticated the correct target but stopped before backup when Node 24.19.0 on Windows exited with the native `UV_HANDLE_CLOSING` assertion (exit 3221226505). Its temporary key was revoked and its credential file removed. Subsequent private deployment operations use direct portable Node 24.21.0 and the reviewed frozen-derived adapter; the product source remains the frozen checkpoint above.

A third attempt completed a full backup and successfully deployed that backend. It then stopped before migrations or site promotion when the source preflight detected Convex-generated output changes: two storage-module type imports/maps in `backend/convex/_generated/api.d.ts`. The generated patch was preserved privately and only the five generated outputs were restored to their exact frozen contents, returning the backend source diff to zero. That temporary key was also revoked and its file removed. This stop does not erase the successful backend deployment; the separately verified completion and cleanup receipts above govern the final release status.

The frozen generated API declarations still omit those two storage modules. Regenerating and reviewing those type declarations remains a separate source followup; it is not an additional Convex runtime deployment or a migration/site acceptance claim.

| Migration stream | Done | Pages | Admitted |
| --- | --- | --- | --- |
| users | true | 1 | 3 |
| projects | true | 1 | 0 |
| workspaceAgents | true | 1 | 0 |
| designAssets | true | 1 | 5 |
| drawingFiles | true | 1 | 1 |

The final resume retained the already deployed backend and completed a fresh backup, the five migration streams and the pinned website promotion. The first startup request returned HTTP 502 while the new site started; independent subsequent checks verified HTTP 200 for all four public routes, and public Cua verification recorded all 18 canonical notes, three platform download links and zero account submissions. Final temporary-key revocation is recorded at `2026-10-18T10:12:49.4334082Z`, with the credential file absent. The temporary private site container and tunnel were stopped.

The applied development-server scratch denial passes all 46 tracked tests. Separate synthetic-only checks return 403 on previews 5173, 5175 and the restarted owned 5176; the retained old pages preview on 5174 still returns 200 for the harmless canary under its old policy. Approval review rejected its stop and no bypass was attempted. No actual credential was fetched over HTTP; credentials and raw token logs remain outside all repository roots.

Windows packages are unsigned. Mac packages are ad hoc signed and unnotarized; Mac updates require a manual download. Native packaging/smoke results do not establish interactive macOS installation or signed-updater acceptance.

## Withdrawn 0.2.5 build and CI evidence

- Native source: `43c7fd9ae4316647a2d7705745b32812635c56cb`, tag `origin-v0.2.5`. [Native run `39080480998`](https://github.com/z4mbo/Origin/actions/runs/39080480998) and all 15 private draft assets were verified before withdrawal. Those binaries precede the native cancellation and UI fixes and cannot cover 0.2.6.
- Corrected test-head [CI `39080943442`](https://github.com/z4mbo/Origin/actions/runs/39080943442), source `cfbb5c097a8e29c4adc6ba8ad6e2a19612885410`, **completed with failure**. Its only difference from the native source was the renderer model-label readiness test; the frozen production-tree equivalence did not make a failing CI green.
- All four Ubuntu shards and Windows shards 3/4 succeeded. Windows shard 1's Vitest tests passed, then nine Electron tests failed; Windows shard 2 failed the real Data-route cancellation case. All eight existing flaky-test reports said no listed flaky test needed a retry; the Electron command was outside that retry mechanism. The renderer job passed all 15 tests. The aggregate CI failed and broker deployment was skipped.
- The private website image was `sha256:8869546d28207777160cfd6b79b2822d89250bce280cfe24755caf3d6d20522d`, from website source `9e1b40440`. Two private compiled-image runs passed 16 browser cases each, including that version's canonical changelog. WebSockets were intercepted, external HTTP blocked and no account form submitted; its private container/tunnel were stopped. This historical image does not verify 0.2.6 release copy.

No 0.2.5 artifact, feed, GitHub release or website image was published. No backend or storage migration was deployed. Private draft/staging checks are not public delivery. The separate synthetic user previews remain available.

## Unshipped 0.2.4 build evidence

- Desktop source: `eb981de95de93df2195095e0a1ea8c2722b4c28a`, tag `origin-v0.2.4`.
- [Native build run](https://github.com/z4mbo/Origin/actions/runs/39078472243) succeeded for Windows x64, macOS arm64 and macOS x64, including packaged checks and feed validation.
- Both feeds and the complete 13-payload assembly were verified, including all 14 canonical notes for that version, byte sizes and SHA-512 values. The manifest records 1,947,854,892 payload bytes and keeps the Windows portable ZIP separate from the Mac Intel ZIP.
- The private website image was `sha256:28eab45dea7a9250e12921017df6a529eefa7682c5f5103a249ffffba2e374e1`, from website source `5818efadf`, with two passing private 16-case browser runs.

No 0.2.4 artifact, feed, GitHub release or website image was published. The later browser-view permission fix changed compiled server code and required the subsequently withdrawn 0.2.5 binaries; current 0.2.7 acceptance uses its own exact-source CI and native builds.

## Unshipped 0.2.3 build evidence

- Desktop source: `67e7a7934f2b762a6c20886ea675f7c57d4f2184`, annotated tag `origin-v0.2.3`.
- [Native build run](https://github.com/z4mbo/Origin/actions/runs/39074949599): Windows x64, macOS arm64 and macOS x64 succeeded, including packaged smoke checks and feed validation.
- Both downloaded update feeds independently passed version, all 13 canonical changelog entries, byte size and SHA-512 validation.
- The private server staging copy passed every entry of `SHA256SUMS-0.2.3.txt`: 13 payload files, 1,947,810,914 bytes. The manifest and checksum file accompany them.
- Mac Intel and Windows portable builds originally both name their ZIP `Origin-0.2.3-x64.zip`. Distribution preserves the Mac update target and gives the byte-identical Windows copy the name `Origin-0.2.3-windows-x64.zip`.
- Windows packages are unsigned. Mac packages are ad hoc signed and not notarized; Mac updates require a manual download. These builds do not establish interactive macOS installation or signed-updater acceptance.

That candidate's private website image was `sha256:4510c3ccf3598946de922215ffb7f7f9951ddb2ce23760346026fdc33c55d48e`, from website source `c397371e1`. It differs from the desktop tag only in website copy and a workflow comment. Two private compiled-image browser runs passed 16 cases each; current website evidence is recorded separately in [the website report](origin-site.md).

## Relay credential incident and containment

During read-only deployment inspection, a Docker command-field inspection exposed the existing TURN static credential in tool output. Its value is deliberately absent from this report. The credential was treated as disclosed and rotated at `2026-10-17T22:43:55Z`.

The relay now reads its replacement from a read-only file owned by UID/GID 3478 with mode `0400`; its command no longer contains the credential or `-n`. The configured Origin service consumes the matching `ORIGIN_TURN_SECRET` from its protected operator environment file and was recreated on its unchanged previous image. Verification confirmed both services running, relay restart count zero, the mounted file readable by the relay user, no configuration-read error, and matching server/relay configuration. The public landing still returned HTTP 200. No account, chat or call mutation was used to test this production change.

The current desktop TURN issuer is `server/origin-members.ts`, using `ORIGIN_TURN_HOST` and `ORIGIN_TURN_SECRET`; no Convex TURN setting is invented or modified. Real cross-machine call/relay acceptance remains separate. Existing relay-backed calls may require reconnection after credential rotation.

Relay operator configuration lives in `/root/origin/deploy`, outside the tracked site build context. The site rollout preserves that directory and the previous image/context. Downloads are staged and checked before same-filesystem atomic file promotion; only the Origin service is targeted by the website compose update.

## Remaining acceptance limits

The 0.2.7 release operations and temporary-key revocation are complete as recorded above. The earlier one-shot browser CLI bootstrap observation remains recorded. Local persistent-MCP, fixture and two-peer results do not establish production-provider, physical microphone/camera or phone, cross-machine WebRTC/TURN, signed-updater or interactive macOS acceptance. Full-App/native picker, archive async browser branches, custom project Confirm portal and broader UI coverage retain the limits in the linked feature reports. Existing synthetic-directory cleanup policy blocks remain recorded; delivery does not remove those limits.
