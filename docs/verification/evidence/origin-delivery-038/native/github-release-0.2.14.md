# Origin 0.2.14: Safer accounts and shared-agent ownership

2026-10-19

## Sign-in stays with your account

A delayed sign-in or sign-out cannot replace a newer account, including when another window signs in and signs out before the old request finishes.

## Sessions stay on their server

Changing servers clears the previous session before connecting to the new server. Different addresses for the same server keep you signed in.

## Checked account connections

Concurrent connection changes preserve the verified active account. Sign-in reports a failed connection to the local app so you can retry.

## Shared agents confirm ownership

Shared work stops when Origin cannot renew its ownership. Queued and resumed work confirms ownership before starting, and changing accounts stops the previous local run.

Desktop source: [origin-v0.2.14](https://github.com/z4mbo/Origin/tree/origin-v0.2.14) (`ab0cd72b4c2f004c1015adca034472241569c04b`). [Native build and packaged smoke checks](https://github.com/z4mbo/Origin/actions/runs/39182331813) completed successfully for Windows x64, Mac Apple Silicon and Mac Intel.

Windows packages are unsigned. Mac packages are ad hoc signed and are not notarized; Mac updates require a fresh manual download. If macOS blocks an app you choose to trust, use **System Settings → Privacy & Security → Open Anyway**, following [Apple's opening instructions](https://support.apple.com/en-us/102445). These build checks do not establish interactive installation or signed-updater acceptance.

The Windows portable archive is `Origin-0.2.14-windows-x64.zip`; `Origin-0.2.14-x64.zip` is the Mac Intel update archive. `SHA256SUMS-0.2.14.txt` covers all 13 installers, archives, blockmaps and updater feeds. The release manifest records the exact source, native run, sizes and hashes.

See the [audit report](https://github.com/z4mbo/Origin/blob/ab0cd72b4c2f004c1015adca034472241569c04b/docs/verification/origin-audit.md) and [review PR](https://github.com/z4mbo/Origin/pull/1) for verification and remaining limits.
