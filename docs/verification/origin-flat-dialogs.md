# Flat dialog surfaces and pending confirmation focus

This is an unreleased follow-up in the isolated `codex/flat-dialogs-031` worker, based on `37a3b2c450e8a47e489284d6abaa232078541cad`. The published 0.2.10 source, tag and delivery receipts remain unchanged. The About captures retain their 0.2.10 version label; they establish component behavior and appearance, not a new packaged release.

## Pending confirmation defect

| Severity | Source and concrete scenario | Correction |
| --- | --- | --- |
| P2 | `src/components/ConfirmDialog.tsx:47`: an operation is pending, both buttons are disabled and the alertdialog has focus. Escape correctly keeps it open. Clicking the backdrop nevertheless performs Chromium's pointer-focus default, moving focus outside the still-busy modal. | `ff23c56115161faa3465f7e1905306de634f1215` prevents the backdrop pointer default before invoking the existing guarded dismissal. It does not change pending state, operation dispatch or authorization. |

The new component regression fails one case with five existing cases passing before correction. The three focused focus suites pass all 24 cases afterward. Genuine headless Chromium checks reproduce focus leaving in all four theme/viewport combinations before correction, then retain it in all four after correction. Additional checks cover one submit, disabled pending controls, refused Escape/backdrop dismissal, resolving and cancelling, opener restoration, and nested confirmations consuming only their own Escape. [Regression evidence](evidence/origin-flat-dialogs-031/focus-regression.json), [before backdrop](evidence/origin-flat-dialogs-031/before/confirm-pending-mobile-dark-backdrop.png), [corrected before styling](evidence/origin-flat-dialogs-031/focus-after/confirm-pending-mobile-dark-backdrop.png).

## Shared appearance

About, confirmation cards, Files refusal/suggestion dialogs and the Files folder menu used separate large-shadow recipes. Their ordinary controls also differed from the core action scale. `src/styles.css:865` now supplies one flat `ui-panel` surface using the existing panel radius, panel/ink colors and hairline tokens. These surfaces use the shared 12px panel radius and no box shadow. About and confirmation actions use the existing core `ui-button` styles; confirmation tones keep the existing semantic accent/danger ink and pending behavior.

This is a bounded migration of three components. Phone, archived-agent and other dialog/menu surfaces retain their separate follow-up requirements. No broad whole-app style acceptance is claimed.

| Surface | Before, 375 light | After, 375 light | Before, 1280 dark | After, 1280 dark |
| --- | --- | --- | --- | --- |
| About | [Before](evidence/origin-flat-dialogs-031/before/about-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/about-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/about-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/about-desktop-dark.png) |
| Neutral confirmation | [Before](evidence/origin-flat-dialogs-031/before/confirm-neutral-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/confirm-neutral-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/confirm-neutral-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/confirm-neutral-desktop-dark.png) |
| Destructive confirmation | [Before](evidence/origin-flat-dialogs-031/before/confirm-danger-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/confirm-danger-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/confirm-danger-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/confirm-danger-desktop-dark.png) |
| Pending confirmation | [Before](evidence/origin-flat-dialogs-031/before/confirm-pending-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/confirm-pending-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/confirm-pending-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/confirm-pending-desktop-dark.png) |
| Files refusal | [Before](evidence/origin-flat-dialogs-031/before/files-refusal-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/files-refusal-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/files-refusal-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/files-refusal-desktop-dark.png) |
| Files suggestions | [Before](evidence/origin-flat-dialogs-031/before/files-suggest-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/files-suggest-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/files-suggest-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/files-suggest-desktop-dark.png) |
| Files folder menu | [Before](evidence/origin-flat-dialogs-031/before/files-menu-mobile-light.png) | [After](evidence/origin-flat-dialogs-031/after/files-menu-mobile-light.png) | [Before](evidence/origin-flat-dialogs-031/before/files-menu-desktop-dark.png) | [After](evidence/origin-flat-dialogs-031/after/files-menu-desktop-dark.png) |

The [manifest](evidence/origin-flat-dialogs-031/manifest.json), SHA-256 `9eada38c6fda3e32fbb61a6ccd1d0c4358c1af4ed5976607d94f21280cd2b276`, hashes 79 payloads including 68 unchanged PNGs. It does not hash itself. The gallery contains every changed surface at 375×812 and 1280×900 in Midnight/Atelier, with four additional focused backdrop captures. [Source proof](evidence/origin-flat-dialogs-031/source-proof.json) binds frozen before modules and actual working after bytes. The before launcher loads exact Git blobs at their original module IDs; the unchanged shared theme is separately checked with CRLF-to-LF normalization. It does not rewrite component imports or screenshot pixels.

## Verification and reproduction

The [before matrix](evidence/origin-flat-dialogs-031/before/results.json) passes 28 source-qualified cases while recording the existing pending-focus defect. The [after matrix](evidence/origin-flat-dialogs-031/after/results.json) passes 32 cases: 28 corresponding surface checks plus four submit/nested-focus checks. All 28 styled surface contexts compute no shadow and a 12px radius, stay within the viewport and have no horizontal document/panel overflow. Keyboard traversal, dismissal and pending-state checks pass. Both matrices have zero page exceptions and external requests.

Existing focused suites pass 51 tests across five files: `ModalFocus`, `CenteredDialog`, `use-modal-dialog`, `FilesView` and `ArchivedBotsPanel.focus`. Application and server TypeScript, touched/fixture lint, twelve documentation/size/shared-control guard cases and the strict nine-skin contrast checker pass. The latter checks 52 pairs per skin plus the existing inverted-bubble checks. The full client/shared suite and native packaging were not rerun for this worker increment. [Verification summary](evidence/origin-flat-dialogs-031/verification.json).

To reproduce from an isolated worktree with dependencies and the pinned Playwright Chromium already installed, copy the three retained files from [the fixture directory](evidence/origin-flat-dialogs-031/fixture/) to `.omb-scratch/flat-dialogs-031/`, preserving their names. Use Node 24.21.0 and fresh output labels:

```powershell
node --experimental-strip-types .omb-scratch/flat-dialogs-031/run.ts before before-recheck
node --experimental-strip-types .omb-scratch/flat-dialogs-031/run.ts after after-recheck
pnpm.cmd exec vitest run src/components/ModalFocus.test.ts src/components/CenteredDialog.test.ts src/hooks/use-modal-dialog.test.ts src/components/FilesView.test.ts src/components/ArchivedBotsPanel.focus.test.ts
```

The launcher uses the documented `control-omb` fixture, runs Doctor against its exact URL and gives Vite an owned free loopback port and isolated cache. The browser is a separate headless process with external requests blocked. Store, folder bridge and operations are synthetic; no real files, account, provider or production data is exercised. Root's browser tabs, viewport and working tree are untouched.

All seven owned launchers/backends are absent and their synthetic data directories were removed by the standard fixture close path. The four canonical before/after listener ports were subsequently measured closed. Main ports 5199/8799 and local Convex 3210 were never used. The first private JSX-loader failure and the partial run which discovered the focus defect remain excluded private attempts, not completed matrices or screenshots of a working application.

This does not establish packaged Electron, native folder-picker/IPC, authenticated cross-machine or actual body-portalled custom project-accent acceptance. The wider dialog/menu surface inventory remains a separate follow-up.
