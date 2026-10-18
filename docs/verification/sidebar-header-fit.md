# Sidebar account and computer controls

The [retained report](evidence/origin-header-fit-029/report.json) and
[SHA-256/dimension manifest](evidence/origin-header-fit-029/manifest.json)
contain 54 unchanged JPEGs: 24 desktop before/after pairs, four mobile after-only
captures and two menu captures. The [desktop matrix](evidence/origin-header-fit-029/matrix.json)
checks macOS and Windows at 240, 272 and 320px sidebar widths in Simple/Advanced
mode and light/dark themes. All 24 settled baselines overlap; all 24 settled
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

Run `node --experimental-strip-types scripts/verify-origin-header.ts` from the
repository. It launches one disposable fake-engine server and two renderer
previews on free ports. The printed JSON identifies both URLs, the owned
processes, the temporary data directory and the server log.

The `before` preview loads the frozen `63c38a2cf5e22166efafb7e727b562988e5b084c`
Sidebar and popover under their original module IDs. The `after` preview uses
the working tree. Both use the real account, sidebar and computer-switcher
components with a synthetic forty-character account and a desktop bridge that
returns **This computer**. `/__origin-header-fixture.json` records the source
hashes. External connections and form submissions are blocked; account mutation
hooks reject requests.

On each URL check `platform=mac` and `platform=win`, `width=240`, `272` and `320`,
and `mode=advanced` and `mode=simple`. Keep the browser at least 768px wide so
the app applies the saved desktop sidebar width. `theme=light` and `theme=dark`
select the corresponding app skin. `density=icons` checks the existing rail.

Press **Measure header** after the page settles. The visible JSON reports the
actual sidebar, titlebar and trigger rectangles. In the expanded after preview,
`controlsDisjoint`, `controlsWithinSidebar` and `controlsBelowTitlebar` must all
be true. Capture before/after screenshots. Open the account menu, navigate it
with the keyboard and dismiss it with Escape; verify focus returns to its
trigger. Click **This computer** and verify the synthetic menu-call counter
increments once.

With `menu=failed`, the synthetic computer bridge rejects the request. Verify
the inline error is visible below the identity row and `menuErrorWithinSidebar`
is true after measuring again.

The computer menu bridge is synthetic. These browser checks do not exercise an
Electron native popup, OS window controls, account writes or real cloud data.
Stop only this launcher's terminal with Ctrl-C when the browser checks finish.

The focused DOM regression is
`pnpm exec vitest run src/components/Sidebar.origin-header.test.ts`. It checks
the real Origin feature flags, signed-in trigger, titlebar separation, sizing
boundaries and Simple/Advanced controls. Browser measurements establish actual
layout; the DOM test environment does not perform layout.
