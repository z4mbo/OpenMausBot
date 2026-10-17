# Origin 0.2.4 delivery

Delivery is in progress. This record distinguishes published artifacts, deployed services and isolated verification. The review PR stays open; no product task PR was merged.

The current candidate is 0.2.4. The 0.2.3 binaries and private website image below were verified but never published; a subsequent malformed-URL credential privacy fix and final source extractions require matching new desktop builds. No 0.2.3 promotion script is eligible for execution.

## Current candidate verification

The 0.2.4 website image is `sha256:28eab45dea7a9250e12921017df6a529eefa7682c5f5103a249ffffba2e374e1`, built from website source `5818efadf`. Two private compiled-image runs pass 16 browser cases each, including all 14 current changelog entries in the release-history screen. All WebSockets are intercepted and external HTTP is blocked; no account form is submitted. The private container and tunnel are stopped. The separate synthetic app previews remain available to the user.

The integrated touched-server, release, architecture and documentation checks pass 42 files and 1,352 tests, with 19 existing platform skips. Client/server TypeScript and full lint pass. Independent review confirms the preserved durable-import, request-attribution, authority-filtering and renderer-export invariants. Native packaging and new CI conclusions remain pending.

The Windows renderer run passes 13 tests, with one native one-shot CLI bootstrap failure and one existing POSIX-only skip. The failed team-share case then passes unchanged. All five supported browser-evidence cases pass, and a separate focused persistent-MCP comparison passes two tests. Passive observation reproduces a native CLI daemon exit/restart during cold start, independently of the corrected fixture socket location. This remains an unresolved verification-tool limitation; it does not establish a failure of the production persistent-MCP path. No retries, skipped assertions, native pin changes or production workarounds hide that result.

Exact guarded cleanup of some synthetic temporary directories was rejected by automatic approval review as “blocked by policy.” Their owned processes are stopped; the rejected deletion was not retried through another mechanism. In addition to the earlier feature-report paths, the stopped `openmausbot-verify-data-J3amUQ` fixture and seven renderer partial fixtures remain; the latter's exact paths are in the local cleanup evidence. The intentionally live user previews are separate from those retained directories.

## Unshipped 0.2.3 build evidence

- Desktop source: `67e7a7934f2b762a6c20886ea675f7c57d4f2184`, annotated tag `origin-v0.2.3`.
- [Native build run](https://github.com/z4mbo/Origin/actions/runs/39074949599): Windows x64, macOS arm64 and macOS x64 succeeded, including packaged smoke checks and feed validation.
- Both downloaded update feeds independently passed version, all 13 canonical changelog entries, byte size and SHA-512 validation.
- The private server staging copy passed every entry of `SHA256SUMS-0.2.3.txt`: 13 payload files, 1,947,810,914 bytes. The manifest and checksum file accompany them.
- Mac Intel and Windows portable builds originally both name their ZIP `Origin-0.2.3-x64.zip`. Distribution preserves the Mac update target and gives the byte-identical Windows copy the name `Origin-0.2.3-windows-x64.zip`.
- Windows packages are unsigned. Mac packages are ad hoc signed and not notarized; Mac updates require a manual download. These builds do not establish interactive macOS installation or signed-updater acceptance.

The final website image is `sha256:4510c3ccf3598946de922215ffb7f7f9951ddb2ce23760346026fdc33c55d48e`, from website source `c397371e1`. It differs from the desktop tag only in website copy and a workflow comment. Two private compiled-image browser runs passed 16 cases each; see [website evidence](origin-site.md).

## Relay credential incident and containment

During read-only deployment inspection, a Docker command-field inspection exposed the existing TURN static credential in tool output. Its value is deliberately absent from this report. The credential was treated as disclosed and rotated at `2026-10-17T22:43:55Z`.

The relay now reads its replacement from a read-only file owned by UID/GID 3478 with mode `0400`; its command no longer contains the credential or `-n`. The configured Origin service consumes the matching `ORIGIN_TURN_SECRET` from its protected operator environment file and was recreated on its unchanged previous image. Verification confirmed both services running, relay restart count zero, the mounted file readable by the relay user, no configuration-read error, and matching server/relay configuration. The public landing still returned HTTP 200. No account, chat or call mutation was used to test this production change.

The current desktop TURN issuer is `server/origin-members.ts`, using `ORIGIN_TURN_HOST` and `ORIGIN_TURN_SECRET`; no Convex TURN setting is invented or modified. Real cross-machine call/relay acceptance remains separate. Existing relay-backed calls may require reconnection after credential rotation.

Relay operator configuration lives in `/root/origin/deploy`, outside the tracked site build context. The site rollout preserves that directory and the previous image/context. Downloads are staged and checked before same-filesystem atomic file promotion; only the Origin service is targeted by the website compose update.

## Pending acceptance

Public download/feed and GitHub release publication, backend deployment with a fresh storage-inclusive backup, all five bounded storage migration streams, final website rollout and public metadata verification remain pending. The temporary deployment token must be revoked after those operations. Renderer CI recipes are being reconciled with Origin navigation; publication remains held until their verification is resolved.
