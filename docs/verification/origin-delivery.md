# Origin 0.2.7 delivery

Delivery is in progress. This record distinguishes published artifacts, deployed services and isolated verification. The review PR stays open; no product task PR was merged.

The active candidate is **0.2.7, with its source checkpoint named `origin-v0.2.7`**, pending corrected source CI and matching native builds. Version 0.2.6 remains unshipped: native packaging passed, but Linux and Windows shard 1 rejected the same Sidebar source-size violation. The correction preserves the durable focus handoff and extracts its feedback portal rather than increasing the budget. Earlier candidates 0.2.2–0.2.6 were never published; public remains **0.2.1**. No new backend, website or storage migration has been published. [CI recovery](origin-ci-recovery.md) records the exact failure and correction; [UI evidence](origin-ui-followup.md) preserves the existing before/after captures.

## Current candidate verification

For 0.2.7, all 5,888 client/shared tests across 557 files pass in 374.06 seconds. Client and server TypeScript, full lint, 132 backend tests, 36 guard/release/documentation tests and the 18-entry release validator also pass locally. The production rollout helpers pass 20 mocked safety gates and an independent read-only review; those checks do not establish a deployment. Fresh source CI, packaged native checks and public delivery remain required.

Native cancellation fix `131878667` retains interruption ownership through asynchronous native dispatch and settlement, then clears resources before the next lane work. Controlled synthetic Windows worker pressure proves the old query can start after its early abort/interrupt; genuine pre-fix regressions fail four assertions, including actual HTTP replacement settlement. The corrected engine/lane/HTTP-route suite passes **51 tests across three files** in 10.98 seconds, with server TypeScript, focused lint and whitespace checks passing. Replacement/disconnect cancellation and the last committed card/table are asserted. The original 15-second test timeout remains unchanged; no retries, skips or relaxed assertions supply this result. Earlier pressure runs with an undeclared fixture variable are invalid and excluded. [Sanitized report](evidence/origin-native-cancellation/report.txt), [valid red](evidence/origin-native-cancellation/valid-red.log), [final green](evidence/origin-native-cancellation/final-green.log).

The [UI followup](origin-ui-followup.md) records exact source identities, before/after captures, shared focus ownership (`62fe9d9a3`), reusable below-placement submenu support (`70eb5fecd`), Files initial-state recovery (`576bbb2c6`) and readable filled-control states (`7052c78c2`). The below-placement issue was a reusable configuration defect; current shipped below callers have flat entries, so no shipped Help route is claimed blocked. Its manifest covers 360 PNGs with separately qualified matched and after-only evidence. These fixtures do not substitute for full-app or packaged acceptance.

Electron fixture fix `01685a95a` corrects all nine original Windows failures with native fixture paths, a synthetic home and deterministic read denial. The subsequent local full run records **783 pass, 15 existing skips and four environment failures**. Both AppImage cases then pass with Git's existing `mv` added only to the child PATH; two symlink cases still fail locally with `EPERM`. The full Electron suite is not claimed locally green. [Exact evidence and remaining limits](origin-ui-followup.md#windows-fixture-correction-and-remaining-limits).

At the 0.2.4 checkpoint, integrated touched-server, release, architecture and documentation checks passed 42 files and 1,352 tests, with 19 existing platform skips. Client/server TypeScript and full lint passed. Independent review confirmed the preserved durable-import, request-attribution, authority-filtering and renderer-export invariants. These are checkpoint results. An initial 0.2.6 full-client run exposed a test-harness regression corrected in `5542cccfd`; the corrected final run passed all 5,888 tests across 557 files in 344.97 seconds. Source 0.2.6 still failed the separate file-size guard. Fresh 0.2.7 final CI/native conclusions remain pending.

The retained P1 correction in `9c1510a03` closes live browser views when their bot becomes invisible to the viewer, even when the browser and member sessions remain valid. The old real permission predicate fails two regressions; the production `BrowserLive` class with synthetic transport also receives a second private frame before the fix. The corrected focused access/browser suite passes 114 tests with 12 existing Windows/OS skips; server TypeScript and size/legacy guards pass. The standard isolated browser route fixture exercises startup, doctor, seed, authentication/CSRF checks and missing-engine 503 handling. It does not establish successful live-stream revocation through a real browser HTTP connection.

The [native two-peer call follow-up](origin-calls.md#native-two-peer-follow-up) passes five scenarios using production `MemberCall`/`MemberCallHost`, actual HTTP member routes and SQLite in two independent Chromium contexts. It proves real local audio/video RTP, remote audio playback, signaling/data channels, replacement/reconnection and cleanup. The evidence records source `9e1b40440`; the call implementation is unchanged from `eb981de95`. Identities and devices are synthetic, ICE servers are empty and external HTTP/WebSockets are blocked. Hardware, TURN/internet traversal, Electron prompts and production authentication remain separate gates.

An earlier Windows renderer run passed 13 tests, with one native one-shot CLI bootstrap failure and one existing POSIX-only skip. The failed team-share case then passed unchanged. All five supported browser-evidence cases passed, and a separate focused persistent-MCP comparison passed two tests. Passive observation reproduced a native CLI daemon exit/restart during cold start, independently of the corrected fixture socket location. Corrected 0.2.5 CI subsequently passed all 15 renderer tests. This records both results without treating the earlier verification-tool limitation as a production persistent-MCP defect or claiming provider acceptance.

The historical 0.2.4 Linux shard-1 CI failed before provider-key saving because its generated `gated-acp.ts` fixture was `0644` but directly executed on POSIX. Test-only correction `8027fe057` supplies mode `0755` in `server/opencode-provider-keys.e2e.test.ts`; both Windows cases pass. An independent WSL kernel check with a synthetic interpreter proved `EACCES` at the old mode and exit 0 at the new mode; Linux Node was not run locally. Corrected 0.2.5 CI `39080943442` passed both real Linux provider-key cases. Its unrelated Windows failures still prevent release. No production CLI bug is claimed from this executable-mode fixture failure.

Exact guarded cleanup of some synthetic temporary directories was rejected by automatic approval review as “blocked by policy.” Their owned processes are stopped; the rejected deletion was not retried through another mechanism. In addition to the earlier feature-report paths, the stopped `openmausbot-verify-data-J3amUQ` fixture and seven renderer partial fixtures remain; the latter's exact paths are in the local cleanup evidence. The intentionally live user previews are separate from those retained directories.

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

No 0.2.4 artifact, feed, GitHub release or website image was published. The later browser-view permission fix changed compiled server code and required the subsequently withdrawn 0.2.5 binaries; current acceptance requires fresh 0.2.6 builds.

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

## Pending acceptance

The **UNFROZEN 0.2.6** source must complete its final client checks, fresh successful CI and matching native packaging before publication. Public download/feed and GitHub release publication, backend deployment with a fresh storage-inclusive backup, all five bounded storage migration streams, final website rollout and public metadata verification remain pending. The temporary deployment token must be revoked after those operations. The earlier one-shot CLI bootstrap observation remains recorded; local persistent-MCP, fixture and two-peer results do not establish production/provider, hardware, cross-machine/TURN, signed-updater or macOS interactive acceptance.
