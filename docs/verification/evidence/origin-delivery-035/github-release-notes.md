# Origin 0.2.13: Reliable boards and a clearer Origin

2026-10-18

## Reliable signup loading

Signup checks whether registration is available before showing its fields. A connection that does not respond offers Try again after ten seconds. Sign-in and verified invitations stay available.

## Safer Windows child processes

Workspace credentials stay out of installer and agent child processes even when environment names use different capitalization on Windows.

## Private provider logs

Stripe secret and restricted keys are hidden when agent protocol output is saved to logs.

## Accurate project lists

Workspace project lists refresh when a Chief's project links change, clearing stale entries from the sidebar.

## Stable issue dragging

Issue cards stay visible when you drag quickly between columns. Losing edit access or switching projects cancels the drag before it can save a move.

## Protected conversations

If saving a conversation change or deletion fails, Origin preserves its saved messages and metadata. Failed permission changes cannot grant broader access.

## Origin throughout the app

Startup, tray menus, installation and agent messages use Origin's name. Unrelated subscription offers and promotional links are removed.

## Live calls with your own key

Phone and companion Live calls use your configured Live key without requiring an upstream subscription. Missing keys still open setup, and access checks still apply.

## Compact sidebar and server controls

Footer icons stay on one line. Saved server names remain readable in narrow windows, with their actions below when needed. The computer menu opens Origin's server settings.

## Origin server updates

Self-hosted update checks find Origin releases and recognize their version tags. Docker instructions build the Origin checkout, and updates never suggest replacing Origin with the upstream npm package.

## Recoverable engine discovery

An engine that never reports its status becomes unavailable after a minute instead of keeping engine discovery pending. Other engines remain available.

Desktop source: [origin-v0.2.13](https://github.com/z4mbo/Origin/tree/origin-v0.2.13) (`1483a7d76fb092b5ef6860afc5ffb520fc4e7707`). [Native build and packaged smoke checks](https://github.com/z4mbo/Origin/actions/runs/39175524797) completed successfully for Windows x64, Mac Apple Silicon and Mac Intel.

Windows packages are unsigned. Mac packages are ad hoc signed and are not notarized; Mac updates require a fresh manual download. If macOS blocks an app you choose to trust, use **System Settings → Privacy & Security → Open Anyway**, following [Apple's opening instructions](https://support.apple.com/en-us/102445). These build checks do not establish interactive installation or signed-updater acceptance.

The Windows portable archive is `Origin-0.2.13-windows-x64.zip`; `Origin-0.2.13-x64.zip` is the Mac Intel update archive. `SHA256SUMS-0.2.13.txt` covers all 13 installers, archives, blockmaps and updater feeds. The release manifest records the exact source, native run, sizes and hashes.

See the [audit report](https://github.com/z4mbo/Origin/blob/1483a7d76fb092b5ef6860afc5ffb520fc4e7707/docs/verification/origin-audit.md) and [review PR](https://github.com/z4mbo/Origin/pull/1) for verification and remaining limits.
