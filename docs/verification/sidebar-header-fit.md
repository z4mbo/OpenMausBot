# Sidebar account and computer controls

## Published source boundary

Fix `c1210a4f3` is included in published 0.2.10 at `0eb372a94715527931043a1b6d8c02a50194dbb0`; the [0.2.10 delivery](origin-delivery.md#0210-delivery) and [permanent receipt](evidence/origin-delivery-030/delivery-receipt.json) bind its current binaries. The original twelve-case regression and 54-JPEG source/bridge evidence below retain their original 0.2.8/0.2.9 qualifications. Native OS popups, window controls and physical installation are not inferred from those synthetic captures.


The [retained report](evidence/origin-header-fit-029/report.json) and
[SHA-256/dimension manifest](evidence/origin-header-fit-029/manifest.json)
contain 54 unchanged JPEGs: 24 desktop before/after pairs, four mobile after-only
captures and two menu captures. The [desktop matrix](evidence/origin-header-fit-029/matrix.json)
checks macOS and Windows at 240, 272 and 320px sidebar widths with requested
Simple/Advanced parameters and light/dark themes. The frozen sources set
`ADVANCED_MODE_ONLY=true`, so these historical browser mode labels identify the
requested parameter; they all rendered Advanced. The twelve-case DOM regression
explicitly overrides the mode hook and covers both branches. All 24 settled baselines overlap; all 24 settled
after cases are disjoint, remain within the sidebar and sit below the titlebar.

The [mobile measurements](evidence/origin-header-fit-029/phone.json) use a 375px
viewport and the app's actual **320px mobile sidebar**. These four captures are
after-only. The drawer covers the synthetic debug button, so their rectangles
were read directly from the live DOM. No retained case has document horizontal
overflow; obsolete captures with stale debug-panel measurements are excluded.

The [account-menu proof](evidence/origin-header-fit-029/account-menu.json)
records Escape closing the menu and restoring its opener after the exit
animation. The [synthetic rejection proof](evidence/origin-header-fit-029/menu-error.json)
records the visible error within the 240px sidebar. Representative
[before](evidence/origin-header-fit-029/screenshots/before-mac-240-advanced-dark.jpg)
and [after](evidence/origin-header-fit-029/screenshots/after-mac-240-advanced-dark.jpg)
captures show the reported overlap and correction.

The [exact final test proof](evidence/origin-header-fit-029/test-proof.json)
uses identical test bytes: twelve failures with unchanged frozen Git modules
loaded at their original module IDs, then twelve passes on the fix. The
[source proof](evidence/origin-header-fit-029/source-proof.json) validates the
recorded baseline against Git and the captured implementation against the
current sources after CRLF-to-LF normalization. The implementation was integrated
as `c1210a4f3`; fixture footers still show their baseline package version 0.2.8.
These are source-component checks for the 0.2.9 candidate, not packaged 0.2.9
acceptance.

## Requested account and computer layout

The account now occupies the top row immediately before Search. The computer
stays below, with a full-width 40px row, 14px text and a 20px icon. At the narrowest
macOS width, the account retains its avatar and accessible name while the native
traffic-light reserve remains clear. Wider slots reveal the truncated account
name and chevron. The computer menu bridge, error handling and account actions
are preserved.

The [new report](evidence/origin-header-layout-031/report.json),
[manifest](evidence/origin-header-layout-031/manifest.json) and
[source proof](evidence/origin-header-layout-031/source-proof.json) retain 80 PNGs:
48 paired desktop cases, 16 paired 375px cases, eight long-computer-name cases,
four rail captures and four menu/error captures. The desktop matrix covers both
simulated platforms, 240/272/320px widths, both themes and both controlled mode
branches. The fixture now explicitly overrides the mode hook; every case records
matching requested and rendered mode. Production remains Advanced-only. Earlier
unpublished captures with uncontrolled Simple parameters are excluded.

All 32 after cases place the account before Search and the full-width computer
below the titlebar, with disjoint controls inside the sidebar. Computer height
and text size match the navigation peers. `controlsBelowTitlebar` is deliberately
false because the account belongs in the titlebar. The actual mobile drawer is
320px wide inside a 375px viewport. These assertions cover the header; an existing
Advanced footer spill at narrow widths is preserved in this collection and is
not hidden by the document-width checks. The later
[footer followup](sidebar-footer-fit.md) fixes it with separate evidence. Representative
[before](evidence/origin-header-layout-031/screenshots/before-win-272-advanced-dark.png)
and [after](evidence/origin-header-layout-031/screenshots/after-win-272-advanced-dark.png)
captures show the requested arrangement.

The [placement regression](evidence/origin-header-layout-031/account-placement-exact-proof.json)
uses identical test bytes against frozen `37a3b2c450e8a47e489284d6abaa232078541cad`
modules and the fix: 12 failures, then 12 passes. The focused DOM test does not
perform layout. The actual Chromium matrix establishes the geometry. All 49
related unit/DOM/size-guard checks, app/server typechecks and touched-file lint
passed. No production account or computer was accessed.

## Reduced-motion keyboard regression

With reduced motion enabled, the global `0.01ms` transition duration created
transitions for otherwise unstyled menu placement and inherited visibility.
Pressing Enter opened the account menu but the browser rejected focus while
the first row still computed as hidden. Arrow navigation therefore remained
on the trigger. The [browser trace](evidence/origin-header-layout-031/focus-probe.json)
records the failing frozen stylesheet and successful fixed stylesheet.

Fix `0762b5086247fabdfd40e68f4fffe1c75503e059` sets that duration to zero.
The [identical-test proof](evidence/origin-header-layout-031/reduced-motion-exact-proof.json)
records one normal-mode pass and one reduced-motion failure before, then two
passes after, using isolated Chromium and fake-engine servers. Enter, ArrowDown,
End, wrapping, Escape, focus return and the next Tab reaching Search all pass
without invoking an account action. Main and nested menus share the same rule.
The only animation/transition-end consumer is the native-view overlay observer;
its initial read, MutationObserver and ResizeObserver provide independent
updates. Menu exit settlement uses its own timer or reduced-motion branch.

## Reproduce

Run `node --experimental-strip-types scripts/verify-origin-header.ts`. It launches
one disposable fake-engine server and two previews on free ports. The printed
JSON identifies the URLs, owned processes and data directory. The before preview
loads frozen `37a3b2c450e8a47e489284d6abaa232078541cad` components and stylesheet;
the after preview uses the working tree. Both use a synthetic forty-character
account, controlled mode hook and a desktop bridge returning **This computer**.
Account mutations reject requests and form submissions are blocked.

Check `platform=mac|win`, `width=240|272|320`, `mode=advanced|simple` and
`theme=light|dark`. Use at least 768px viewport width for saved desktop widths,
and 375px for the actual mobile drawer. `computer=long` and `density=icons`
exercise long names and the rail. After settling, **Measure header** must show
matching requested/rendered modes, `accountBeforeSearch`,
`computerBelowTitlebar`, `computerRowFullWidth`, `computerMatchesPeerHeight`,
`controlsDisjoint` and `controlsWithinSidebar` true in the expanded after view.
`menu=failed` must show the contained inline error. Open the account menu with
Enter, navigate with arrows and dismiss with Escape; focus must return to its
trigger. Clicking the computer must increment the synthetic call counter once.

Run `pnpm exec vitest run src/components/Sidebar.origin-header.test.ts` for the
DOM regression. For the actual-browser keyboard regression, set
`OMB_HEADER_UI_E2E=1` and `OMB_HEADER_CHROME` to an installed Chrome for Testing
executable, then run
`pnpm exec vitest run scripts/testing/sidebar-keyboard.e2e.test.ts`.

The browser bridge does not exercise Electron native menus, real window controls,
account writes or packaged installation. Stop only the owned fixture launcher
with Ctrl-C when visual checks finish. Published 0.2.10 receipts remain unchanged.
