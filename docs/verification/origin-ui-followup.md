# Origin UI followup evidence

Recorded 2026-10-18 from isolated synthetic fixtures. This supplements the original audit; it does not establish acceptance of every screen or the packaged app. [Evidence manifest](evidence/origin-ui-followup/manifest.json) lists the 360 actual captured PNGs and their SHA-256 hashes. No new browser/test run was performed while consolidating these records.

## Source identities

| Evidence | Recorded source and qualification |
| --- | --- |
| Modal, Files and contrast before | `cfbb5c097a8e29c4adc6ba8ad6e2a19612885410`; relevant production UI unchanged from native 0.2.5 baseline `43c7fd9ae4316647a2d7705745b32812635c56cb`. |
| Matched modal final | Exactly `62fe9d9a3c5dd55c391a60853ce3692bd568d2f0`; 20 cases, 88 final PNGs paired with 88 baseline PNGs. |
| Profile/popover | Captured on the final implementation before below-submenu commit `70eb5fecd0a372b9072a730eac63b980a562d49d`; launcher HEAD was `62fe9d9a3`. This is an explicit pre-commit capture qualification. |
| Files recovery | Captured on the final recovery implementation before commit `576bbb2c6e24fb4f5357b536c4990eb85fcf4a2a`; launcher HEAD was `70eb5fecd`. |
| Contrast after | Tested working-tree patch SHA-256 `b7dddf80c5d8a605535ad530c52b6e17af7eee14cdf7ee011cf029c4c6548e4f`, bound to `00688b0cd9501880c7c5846103ade9dc001382a5`; integrated unchanged as `7052c78c2`. |
| Windows test fixtures | `01685a95a72573a8009478fb79e1763a3c2f25e3`; test-only correction. |

[Modal/menu/Files commit trees and file blobs](evidence/origin-ui-followup/followup-evidence.json), the seven sanitized `*-provenance.json` files, and [contrast commit binding](evidence/origin-ui-followup/contrast/commit-binding.json) preserve the distinction between launcher HEAD and tested implementation. Capture provenance is not a claim that these screens were rerun on the final integrated HEAD. Absolute local user/data/log paths were removed or replaced; dependency trees, credentials and app state were not copied.

## Modal keyboard ownership

The production About, Phone, Archived agents and Files dialogs were mounted with synthetic parent/store/CloudFilesBridge state. Midnight/Atelier, 375×812 and 1280×900, produce 20 matched cases: four per surface/state below. Native Chromium Tab, Shift+Tab and Escape were used. [Compact matched results](evidence/origin-ui-followup/modal/results.json) retain focus, nesting and measured geometry.

| Surface / scenario | Before | Final |
| --- | --- | --- |
| About | Forward Tab leaves after Close; reverse Tab reaches background; Escape focuses body. | Both Tab directions stay inside; Escape closes and restores the per-open fixture opener. |
| Phone, one synthetic connect destination | Forward Tab leaves after Close; reverse Tab reaches background; no opener restoration. | Both directions stay inside; Escape restores opener. Two complete 132px QR SVGs remain visible in the scrollable 375px card. |
| Archived agents, two synthetic rows | Forward Tab leaves after eight presses; reverse Tab leaves immediately; no opener restoration. | Focus stays inside in both directions; Escape restores opener. Nested confirmation focuses Cancel, retains keyboard ownership and consumes only its own Escape. |
| Files private-folder refusal | Tab leaves after OK; reverse Tab reaches a background Files control. | Both directions stay inside; Escape restores a viable Files return target. |
| Files suggestions, two eligible / one disabled | Forward Tab leaves after two presses; reverse Tab reaches background. | Both directions stay inside; Escape restores a viable Files return target. |

Before forward escapes first reached the body/browser boundary; these fixture captures must not be described as a particular background Search control. All 20 measured dialog/document geometries are exactly unchanged, with no horizontal overflow. Focus correction preserved existing shadows, radii and card classes. This is no broad visual-polish claim.

Implementation references at the consolidated source: [shared lifetime](../../src/hooks/use-modal-dialog.ts#L73), [About](../../src/components/AboutDialog.tsx#L19), [Phone](../../src/components/PhoneAppDialog.tsx#L25), [Archive lock/navigation handoff](../../src/components/ArchivedBotsPanel.tsx#L79), [Files portal](../../src/components/FilesView.tsx#L238), [Confirm ownership and body portal](../../src/components/ConfirmDialog.tsx#L33), [CenteredDialog exit lifetime](../../src/components/CenteredDialog.tsx#L26). Tests cover `src/hooks/use-modal-dialog.test.ts:99` (removed/inert opener fallbacks and navigation), `src/components/ModalFocus.test.ts:56` (mixed portalled confirmation), `src/components/ArchivedBotsPanel.focus.test.ts:40` (pending archive restore/error), and `src/components/ModalFocus.test.ts:80` (Phone handoff).

The [profile results](evidence/origin-ui-followup/profile/results.json) add 16 production profile/popover/dialog combinations: About/Phone × light/dark × above/below × signed-in/unsigned synthetic props at 375px under a translated narrow parent. Each contains focus and returns to the durable profile trigger. Separate controlled-clock motion proof retains the dialog/focus at 119ms, closes at 120ms, keeps forward/reverse exit focus inside, gives inner Confirm its Escape, and dismisses immediately with reduced motion. Those profile/motion images are **after-only**, not matched before/after geometry evidence. An additional 40 normal/reduced-motion component cases are recorded in the source evidence summary; the matched gallery deliberately uses the correctly captioned final 20-case capture.

Below-placement submenu omission was a reusable configuration defect: the submenu render/position/pointer-containment path was incomplete. [Positioning](../../src/components/SidebarPopoverMenu.tsx#L237) and [shared submenu rendering](../../src/components/SidebarPopoverMenu.tsx#L355) now handle it. Current shipped below callers—[ChatHeaderMenu](../../src/components/ChatHeaderMenu.tsx#L86), [HighLevelCard](../../src/components/HighLevelCard.tsx#L204), [PluginsPanel](../../src/components/PluginsPanel.tsx#L688)—have flat items. This is **not a shipped Help-route blocker**. Durable About/Phone profile return refs are [wired here](../../src/components/SidebarProfileMenu.tsx#L441).

## Files initial-state recovery

Exact failure: initial preload `files.state()` rejects and `onState` never pushes another value. Before, production FilesView renders only the Files heading: zero alerts, status elements or buttons. The injected rejection models the renderer/IPC boundary; it does not prove a normal packaged getter fails. Real bridge endpoints are [preload files:state](../../electron/preload.cjs#L293) and [main handler](../../electron/cloud-sync-main.mjs#L30).

The [before record](evidence/origin-ui-followup/files-load-before/results.json) and [red expectation](evidence/origin-ui-followup/files-recovery-red.log) show the blank page and missing alert. Final [four browser cases](evidence/origin-ui-followup/files-load-after/results.json), 375/1440 light/dark, each show generic error/Retry, a pending retry skeleton, then loaded synthetic data: exactly two state reads and no overflow/errors/external attempts. Only 375-dark rejection has an exact matching before capture; other themes/sizes and loading/recovered images are after-only scenario sequences.

[State ownership/retry](../../src/lib/cloud-files.ts#L11) bounds unanswered requests at [10 seconds](../../src/lib/cloud-files.ts#L36), preserves newer pushed state, rejects stale bridge replies/setters and retains loaded data on refresh failure. [Files rendering](../../src/components/FilesView.tsx#L106) supplies the error/Retry or shared skeleton. `src/lib/cloud-files.test.ts:28` (Tests) exercise rejection, silent timeout, late replies, push ownership, bridge changes and unmount cleanup. The [focused green run](evidence/origin-ui-followup/files-recovery-green.log) passes 32 tests across three files. The combined UI run passes [153 tests across 19 files](evidence/origin-ui-followup/ui-focused-green.log), with client/server TypeScript and touched lint/whitespace checks recorded in the source summary.

## Filled primary/danger controls

The correction preserves all nine skin hues and control typography/geometry. Root/Midnight paired fill ink becomes `#070707`; enabled semantic filled hover/active retain their valid fill/ink rather than applying brightness/opacity. A thin inset outline supplies pointer hover/press feedback while existing keyboard focus stays intact. Generic `.ui-button` hover/active excludes primary controls. Decorative accents and alpha danger-icon recipes are preservation probes, not broad selector targets.

Source: [shared ink](../../shared/origin-theme.css#L11), [Midnight/root tokens](../../src/styles.css#L203), [bounded enabled selectors](../../src/styles.css#L1964), [actual returned ink selection](../../src/lib/color-contrast.ts#L38), [brand](../../src/lib/brand.ts#L44), [project/chief accent vars](../../src/lib/user-bubble-tone.ts#L255). The dynamic helper retains a passing tinted ink or white and falls back to pure black when both miss 4.5; it does not override every project hue with Midnight ink.

| Pair | Before base / hover | After base / hover / focus / press |
| --- | ---: | ---: |
| Midnight primary | 3.650 / 3.222 | 5.519 throughout |
| Midnight danger | 3.098 / 2.961 | 6.503 throughout |
| Atelier primary | 5.050 / 4.324 | 5.050 throughout |
| Graphite primary | 4.774 / 4.097 | 4.774 throughout |
| Project gray `#777777` | 4.478 / 3.843 | 4.689 throughout |
| Brand gray `#777777` | 4.217 / 4.875 | 4.689 throughout |

[Before summary](evidence/origin-ui-followup/contrast/before-summary.json): 27 root contexts / 1,026 samples, plus 12 custom contexts / 72 samples. [After summary](evidence/origin-ui-followup/contrast/after-summary.json): 36 contexts / 2,436 recorded states, 432 separately recorded disabled states, plus 12 custom contexts / 144 states and 104 original after PNGs. Every asserted enabled normal-text sample reaches 4.5 and every asserted icon sample 3.0; disabled states are recorded, not asserted as enabled acceptance. Zero page errors, external requests or geometry failures. The after matrix adds fallback and inverted Daylight/Meadow bubbles, so totals differ deliberately.

All nine skins run at 375/1280 sRGB; desktop P3 media is emulated. Production ConfirmDialogCard, ComposerSendButton, WidgetButton, exported primary classes and explicitly labelled source-derived recipes are used. Native hover, keyboard focus, keyboard Space and pointer press are measured. Bright project `#C8FF00` retains tinted ink at 15.723; dark `#123456` retains white at 12.717; project and brand gray use black. The two actual hover control crops match browser sRGB composition exactly. [351 preserved baseline probes](evidence/origin-ui-followup/contrast/preservation-check.json) retain base fills/fonts and danger body ink (Midnight 4.885; nine-skin minimum 4.703).

The retained gallery contains 77 matched contrast **scenarios**, including both actual control crops. Expanded after fixtures add probes, so full-page captures are not pixel-identical geometry comparisons. Canvas/filter/alpha ratios are sRGB projections. Actual opaque unfiltered computed P3 luminance is separately calculated (Midnight primary/danger 5.497/6.422); there is no physical P3 hardware acceptance claim. Static token checking parses hex. Helper red/green tests cover actual returned ink, all 256 grays and 4,096 RGB fills with both preferred dark inks; 174 focused tests, both TypeScript projects, lint and the strict nine-skin × 52-pair checker plus inverted bubbles pass.

## Windows fixture correction and remaining limits

`01685a95a` changes only `electron/cloud-sync-main.node-test.mjs`, `electron/cloud-sync.node-test.mjs` and `electron/cloud-sync-scan.node-test.mjs`: synthetic home/native paths and exact injected nested-directory `EACCES`, restored in `finally`. It preserves production privacy guards and platform coverage. All nine retained CI failures reproduce before and [pass after, zero skips](evidence/origin-ui-followup/windows-nine-green.log). The three-file result is 14 pass/one unchanged local symlink privilege failure. [Detailed sanitized record](evidence/origin-ui-followup/windows-fixture-report.md).

The [full Electron run](evidence/origin-ui-followup/windows-full-suite-summary.log) contains **802 tests: 783 pass, 15 existing skips, four local environment failures**. Two AppImage tests initially could not find `mv`; both subsequently [pass 2/2](evidence/origin-ui-followup/windows-appimage-child-path-green.log) with existing Git `usr/bin` added only to the child PATH. Two unchanged symlink tests remain blocked by local Windows privilege (`EPERM`). The full suite is not claimed locally green; machine PATH, test skips and symlink privileges were not changed.

All successful fixture runs report zero browser errors/external attempts. [Modal/menu/Files cleanup](evidence/origin-ui-followup/followup-cleanup-check.json) and [contrast cleanup](evidence/origin-ui-followup/contrast/cleanup-check.json) record owned processes/listeners closed and temporary data removed. Fixtures used separate synthetic state and guarded loopback origins, leaving user previews, main services, accounts and Convex untouched.

Still pending: complete main App and packaged Electron acceptance, real native folder-picker/IPC focus, the full SimpleBotPanel iOS/Android opener route, browser execution of archive async restore/delete/error/navigation, and custom project accent propagation through the actual body-portalled ConfirmDialog (direct fixture Card inheritance is not that proof). DOM contracts cover several of these behaviors but do not replace native/full-route checks. Heavy modal shadows/radii and broader screen coverage remain open; the matched focus work deliberately preserved geometry and styling.
