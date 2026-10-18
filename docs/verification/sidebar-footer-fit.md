# Sidebar footer containment and keyboard access

This page preserves the 0.2.11 containment work and its original two-row design.
The current requested layout uses [one footer row](sidebar-footer-single-row.md),
with separate before/after evidence; the historical collection below is unchanged.

The P2 defect is a concrete layout overflow: six 46px footer controls and their
groups require more space than a 240px or 272px expanded sidebar provides.
The Store button paints outside the sidebar; in a compact mobile drawer it can
also leave the 375px viewport. A document-width check alone did not detect the
footer crossing its own sidebar boundary.

The fix wraps the footer controls and gives the tools a full row below 286px
available width. The six normal controls form two rows of three at narrow widths,
and retain their original single row when they fit. Inline tool buttons remove
their rail-specific automatic margins so both rows share the same column centers.
Targets remain 46px; Files, update status, tools, Active Threads, New or share and
Apps remain reachable. Simple mode has its two actual controls without an empty
Tools row. The icon rail retains its existing layout.

The [final report](evidence/origin-footer-fit-031/report.json),
[manifest](evidence/origin-footer-fit-031/manifest.json) and
[source proof](evidence/origin-footer-fit-031/source-proof.json) bind 144 unedited
browser screenshot clips and their source hashes. The main matrix has 128 paired
cases: simulated macOS/Windows, comfortable/compact density, 240/272/320px desktop
sidebar widths or 375px mobile viewport, controlled Advanced/Simple branches,
and light/dark themes. All 20 baseline spill cases are retained; all 64 after
cases contain every footer button with disjoint rectangles. Equal-length rows
also have matching column centers within 0.1px. Mobile comfortable and compact
drawers are actually 320px and 272px wide respectively.

Sixteen additional paired cases install synthetic ready-Files and downloading
updater bridges. All eight after cases contain all eight controls. Narrow 4+4
rows align their column centers; wider unequal-length rows remain contained.
Tab order matches DOM order and clicking Apps sets its selected state. These
checks do not execute an update, read cloud files or prove the full Apps panel.

The [regression proof](evidence/origin-footer-fit-031/regression-proof.json)
uses identical actual-Chromium test bytes: both normal and reduced-motion cases
fail the 240px containment assertion against frozen
`0ca15f38b8916e5cb1b7dc9c63222a3228f5fc0e` modules, then both pass on the fix.
Each passing case also checks 16 density/width/mode combinations, row alignment,
unchanged action labels and account-menu keyboard behavior. Each independent
layout case uses a fresh owned browser target and checks route identity. Earlier
attempts that reused a target timed out in the browser driver; they are not
passing evidence. Navigation readiness is bounded at 20 seconds and keyboard
settlement remains bounded at five seconds.

The 55 related unit/DOM/size-guard checks, app/server typechecks and touched-file
lint passed. The only writes were to isolated synthetic fixture data. The browser
matrix recorded no page errors or non-GET submissions. Text logs are normalized
to LF with one final newline; the manifest preserves their raw captured hashes
when formatting changed.

The first, contained-but-misaligned iteration is retained byte-for-byte in the
[intermediate collection](evidence/origin-footer-fit-031-intermediate/report.json).
Its checks established containment, not final column alignment. The older
[header gallery](evidence/origin-header-layout-031/report.json) still shows the
pre-existing spill, and published 0.2.10 receipts are unchanged. A root Cua clip
that returned the top of the window instead of the footer is excluded from both
collections.

For a matched visible fixture, run
`node --experimental-strip-types scripts/verify-origin-footer.ts`. Its output
identifies the before/after URLs, owned server and temporary data. Query parameters
are `platform=mac|win`, `width=240|272|320`, `density=comfortable|compact`,
`mode=advanced|simple` and `theme=light|dark`. Use a 375px viewport for the mobile
drawer. The controlled mode hook is synthetic; production remains Advanced-only.
Stop only this launcher's terminal with Ctrl-C after checking.

For the automated actual-browser checks, set `OMB_HEADER_UI_E2E=1` and
`OMB_HEADER_CHROME` to an installed Chrome for Testing executable, then run
`pnpm exec vitest run scripts/testing/sidebar-keyboard.e2e.test.ts`. Setting
`OMB_HEADER_UI_BASELINE=0ca15f38b8916e5cb1b7dc9c63222a3228f5fc0e` loads unchanged
Git modules at their original module IDs for the failing comparison without
rewriting working files. Native macOS/Windows installation and live updater
execution remain separate acceptance work.
