# Sidebar footer in one row

The expanded sidebar now places every footer icon on one line, including the
optional Files and update indicators. Equal grid columns share the available
width; the tools participate in that same grid. The icon rail keeps its existing
vertical layout. The fix is `27ab9b4266a0628790d591c94665147409889779`.

The [report](evidence/origin-footer-single-row-034/report.json) and
[manifest](evidence/origin-footer-single-row-034/manifest.json) retain sixteen
actual Chromium captures. They compare frozen baseline
`bca64e0a72e5d3fd412695d9aa8d47d1913e6a0d` with integration source
`ece107dd7b441115f2d4b334e286befac4ae6ec5`, binding the Sidebar, SidebarFooterNav,
UpdateIndicator and stylesheet bytes for each side.

The finite matrix covers 240px and 272px desktop sidebars and a 375px mobile
viewport with its 320px comfortable drawer, in light and dark themes. Two
additional paired cases supply synthetic ready-Files and downloading-update
bridges at 240px and 375px. It uses the Windows bridge and comfortable density;
the prior 128-case platform/density containment matrix was not repeated.

All eight after cases have one row, contained and disjoint targets, and no
horizontal document overflow. The smallest target is 25.125px wide, above the
24px check. Tab order follows the visible icon order and Apps changes its selected
state in every after case. No page errors or non-GET submissions occurred. These
checks do not install an update, read cloud files, prove a packaged app, or
exercise the full Apps panel.

Six baseline cases use two rows. The wider mobile drawer already fits the normal
six icons in one row, so those two cases are controls. An initial harness attempt
incorrectly required two rows in that control; its failed log is retained and
qualified. The corrected final sixteen-case run completed with unchanged product
source. The fixture server, both preview ports and disposable data directory were
confirmed absent after cleanup.

The [capture source](evidence/origin-footer-single-row-034/capture-source.txt)
records the exact final browser check. To repeat it from this checkout, copy that
text into `.omb-scratch/prove-footer-single-row.ts` and run it with Node 24 using
`--experimental-strip-types`. Its Chrome path must identify an installed Chrome
for Testing executable. It launches only a standard isolated verification server
and its own previews; the user's app and production data are not accessed.

| Case | Before | After |
| --- | --- | --- |
| 240px, dark | [Two rows](evidence/origin-footer-single-row-034/before-240-dark.png) | [One row](evidence/origin-footer-single-row-034/after-240-dark.png) |
| 272px, light | [Two rows](evidence/origin-footer-single-row-034/before-272-light.png) | [One row](evidence/origin-footer-single-row-034/after-272-light.png) |
| 240px, eight controls | [Two rows](evidence/origin-footer-single-row-034/before-240-dark-optional.png) | [One row](evidence/origin-footer-single-row-034/after-240-dark-optional.png) |
| 375px mobile, eight controls | [Two rows](evidence/origin-footer-single-row-034/before-375-light-optional.png) | [One row](evidence/origin-footer-single-row-034/after-375-light-optional.png) |
