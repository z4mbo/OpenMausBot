# Origin 0.2.5 delivery

Delivery is in progress. This record distinguishes published artifacts, deployed services and isolated verification. The review PR stays open; no product task PR was merged.

The active candidate is 0.2.5. Package/shared release history is committed at `9e1b40440`, but the final release source, tag and CI are not frozen yet. A subsequent browser-view authorization correction requires matching new desktop builds. Versions 0.2.3 and 0.2.4 were verified privately and never shipped; the public version remains 0.2.1. Their artifacts and promotion inputs are historical evidence, not eligible substitutes for 0.2.5.

## Current candidate verification

The 0.2.5 website image is `sha256:8869546d28207777160cfd6b79b2822d89250bce280cfe24755caf3d6d20522d`, built from website source `9e1b40440`. Two private compiled-image runs pass 16 browser cases each, including the current canonical changelog in the release-history screen. All WebSockets are intercepted and external HTTP is blocked; no account form is submitted. The private container and tunnel are stopped. The separate synthetic app previews remain available to the user. This is private compiled-image evidence, not a public rollout or authenticated account check.

At the 0.2.4 checkpoint, integrated touched-server, release, architecture and documentation checks passed 42 files and 1,352 tests, with 19 existing platform skips. Client/server TypeScript and full lint passed. Independent review confirmed the preserved durable-import, request-attribution, authority-filtering and renderer-export invariants. These checks remain checkpoint evidence; final 0.2.5 source, native packaging and CI conclusions remain pending.

The new P1 correction in `9c1510a03` closes live browser views when their bot becomes invisible to the viewer, even when the browser and member sessions remain valid. The old real permission predicate fails two regressions; the production `BrowserLive` class with synthetic transport also receives a second private frame before the fix. The corrected focused access/browser suite passes 114 tests with 12 existing Windows/OS skips; server TypeScript and size/legacy guards pass. The standard isolated browser route fixture exercises startup, doctor, seed, authentication/CSRF checks and missing-engine 503 handling. It does not establish successful live-stream revocation through a real browser HTTP connection.

The [native two-peer call follow-up](origin-calls.md#native-two-peer-follow-up) passes five scenarios using production `MemberCall`/`MemberCallHost`, actual HTTP member routes and SQLite in two independent Chromium contexts. It proves real local audio/video RTP, remote audio playback, signaling/data channels, replacement/reconnection and cleanup. The evidence records source `9e1b40440`; the call implementation is unchanged from `eb981de95`. Identities and devices are synthetic, ICE servers are empty and external HTTP/WebSockets are blocked. Hardware, TURN/internet traversal, Electron prompts and production authentication remain separate gates.

The Windows renderer run passes 13 tests, with one native one-shot CLI bootstrap failure and one existing POSIX-only skip. The failed team-share case then passes unchanged. All five supported browser-evidence cases pass, and a separate focused persistent-MCP comparison passes two tests. Passive observation reproduces a native CLI daemon exit/restart during cold start, independently of the corrected fixture socket location. This remains an unresolved verification-tool limitation; it does not establish a failure of the production persistent-MCP path. No retries, skipped assertions, native pin changes or production workarounds hide that result.

The historical 0.2.4 Linux shard-1 CI fails before provider-key saving because its generated `gated-acp.ts` fixture is `0644` but is directly executed on POSIX. Test-only correction `8027fe057` supplies mode `0755` in `server/opencode-provider-keys.e2e.test.ts`; both Windows cases pass. An independent WSL kernel check with a synthetic interpreter proves `EACCES` at the old mode and exit 0 at the new mode. Linux Node and the full JavaScript flow were not executed locally. The old 0.2.4 CI stays failed; the new 0.2.5 CI is the remaining verification gate. No production CLI bug is claimed from this fixture failure.

Exact guarded cleanup of some synthetic temporary directories was rejected by automatic approval review as “blocked by policy.” Their owned processes are stopped; the rejected deletion was not retried through another mechanism. In addition to the earlier feature-report paths, the stopped `openmausbot-verify-data-J3amUQ` fixture and seven renderer partial fixtures remain; the latter's exact paths are in the local cleanup evidence. The intentionally live user previews are separate from those retained directories.

## Unshipped 0.2.4 build evidence

- Desktop source: `eb981de95de93df2195095e0a1ea8c2722b4c28a`, tag `origin-v0.2.4`.
- [Native build run](https://github.com/z4mbo/Origin/actions/runs/39078472243) succeeded for Windows x64, macOS arm64 and macOS x64, including packaged checks and feed validation.
- Both feeds and the complete 13-payload assembly were verified, including all 14 canonical notes for that version, byte sizes and SHA-512 values. The manifest records 1,947,854,892 payload bytes and keeps the Windows portable ZIP separate from the Mac Intel ZIP.
- The private website image was `sha256:28eab45dea7a9250e12921017df6a529eefa7682c5f5103a249ffffba2e374e1`, from website source `5818efadf`, with two passing private 16-case browser runs.

No 0.2.4 artifact, feed, GitHub release or website image was published. The later browser-view permission fix changes compiled server code; new 0.2.5 binaries are required.

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

The final 0.2.5 source/tag, CI and native build must be frozen and verified before publication. Public download/feed and GitHub release publication, backend deployment with a fresh storage-inclusive backup, all five bounded storage migration streams, final website rollout and public metadata verification remain pending. The temporary deployment token must be revoked after those operations. The recorded Windows one-shot CLI bootstrap limitation remains open; local persistent-MCP and two-peer results do not establish production/provider, hardware, cross-machine/TURN, signed-updater or macOS interactive acceptance.
