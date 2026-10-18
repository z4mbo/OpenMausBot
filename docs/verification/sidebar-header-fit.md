# Sidebar account and computer controls

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
