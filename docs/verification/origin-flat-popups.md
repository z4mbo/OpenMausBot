# Shared popup and sidebar menu surfaces

This unpublished worker follow-up follows [the first flat-dialog pass](origin-flat-dialogs.md). It covers Settings, Apps, Triggers, Voice setup and the shared SidebarPopoverMenu sheet. The released 0.2.10 source, release receipts and earlier galleries are unchanged. This is a bounded surface pass; the wider UI inventory remains open.

The four popup shells now use the existing `ui-panel` contract: opaque panel colour, the shared 12px panel radius, a hairline border and no outer shadow. The former shared glass blur/elevation and nested card-tint override are removed. Trigger cards and the Settings rail use solid core card/app tokens. The menu and submenu share that panel contract with the menu palette. Frame safe areas, scrolling, dismissal, selection markers and menu positioning are preserved. Existing tests that required the retired decorative glass recipe were removed; functional frame, reflow, focus and component tests remain.

## Separate keyboard defect

**P2 — Triggers, collapsed Advanced options.** At baseline `3597772b024d7fe0a08791cdc4280cb6022606d8`, `src/components/TriggersPanel.tsx:78–108` filtered tab stops by rectangle count. Actual Chromium returned one rectangle for each of four buttons inside a closed `<details>`, although `checkVisibility()` returned false. Native Tab from the visible Advanced options summary therefore left the dialog for `BODY`; the handler incorrectly expected the hidden Delete button to be the last tab stop.

The separate fix `bcfd3bfd7` uses visibility for the focus list. The new focused regression produced **2 failures / 1 pass before**, then **3 passes**; the existing Triggers tests also pass (**13 total across two files**). Its Happy DOM fixture models the independently observed visibility/geometry split. Native Tab acceptance is recorded separately: the exact fixed-but-unstyled source and the final styled source both contain forward/reverse navigation, Escape and opener restoration in light/dark desktop/mobile contexts. No trigger, credential or permission action changed.

## Actual browser evidence

[The manifest](evidence/origin-flat-popups-032/manifest.json) hashes **57 original PNGs** and their supporting source/results/fixture files. There are 24 completed cases per matrix: six screen states × two themes × two viewport sizes, plus four submenu screenshots per matrix and one retained native focus-failure screenshot. The baseline loads exact Git blobs at the original module IDs; after captures bind recorded working-source bytes. [Source and cleanup proof](evidence/origin-flat-popups-032/source-proof.json) and [focus evidence](evidence/origin-flat-popups-032/focus-regression.json) preserve those boundaries.

| Surface | Before | After |
| --- | --- | --- |
| Settings, light desktop | [PNG](evidence/origin-flat-popups-032/before/settings-desktop-light.png) | [PNG](evidence/origin-flat-popups-032/after/settings-desktop-light.png) |
| Apps, dark desktop | [PNG](evidence/origin-flat-popups-032/before/apps-desktop-dark.png) | [PNG](evidence/origin-flat-popups-032/after/apps-desktop-dark.png) |
| Triggers, dark mobile | [PNG](evidence/origin-flat-popups-032/before/triggers-mobile-dark.png) | [PNG](evidence/origin-flat-popups-032/after/triggers-mobile-dark.png) |
| Voice setup, light mobile | [PNG](evidence/origin-flat-popups-032/before/voice-mobile-light.png) | [PNG](evidence/origin-flat-popups-032/after/voice-mobile-light.png) |
| Anchored menu, dark desktop | [PNG](evidence/origin-flat-popups-032/before/menu-anchored-desktop-dark.png) | [PNG](evidence/origin-flat-popups-032/after/menu-anchored-desktop-dark.png) |
| Submenu, light mobile | [PNG](evidence/origin-flat-popups-032/before/menu-anchored-submenu-mobile-light.png) | [PNG](evidence/origin-flat-popups-032/after/menu-anchored-submenu-mobile-light.png) |
| Inline menu, light desktop | [PNG](evidence/origin-flat-popups-032/before/menu-inline-desktop-light.png) | [PNG](evidence/origin-flat-popups-032/after/menu-inline-desktop-light.png) |

The remaining corresponding theme/size PNGs are in the same gallery. Desktop is 1280×900; mobile is 375×812. Both matrices use normal motion. Reduced-motion menu focus has a separate implementation owner and requires integrated acceptance; this pass does not change its global CSS. Each final panel stays inside the viewport with no horizontal document/panel overflow, has `box-shadow: none`, uses a 12px radius and has no backdrop filter. Keyboard navigation, disabled-row skipping, nested submenu Escape and anchored Tab dismissal pass. No page exception, unexpected request or external request occurred in either accepted matrix.

The launcher follows the documented `control-omb` isolation workflow, runs `doctor --url` against its own synthetic server and mounts the production components with the shared preview utility. Catalog, voices, profiles and config responses are synthetic; browser-intercepted config saves never reach a provider or user deployment. All owned launchers, backends and temporary fixture data are verified absent afterward; both canonical server/preview port pairs refuse connections. Main ports 5199, 8799 and 3210 and the root browser tabs were untouched.

Rejected fixture attempts remain private and excluded from the accepted matrices. They include a Vite dependency-generation mismatch in the virtual entry, missing fixture dependency/config/API setup, a duplicate-label locator and the actual pre-fix keyboard failure. Earlier headless hardware-composited captures sometimes omitted pixels despite correct DOM geometry; an isolated software-rendered replay verified the controls and unchanged layout, and canonical captures use Chromium `--disable-gpu`. The fixture retains explicit dependency prebundling so its React imports share one generation. Screenshots have not been edited or composited.

## Reproduce and limits

Copy `fixture/preview.tsx`, `fixture/run.ts` and `fixture/check.mjs` from the gallery into `.omb-scratch/flat-popups-032/` in this worker. With the repository and `site/` dependencies installed, use Node 24.21.0:

```powershell
node --experimental-strip-types .omb-scratch/flat-popups-032/run.ts before before-replay
node --experimental-strip-types .omb-scratch/flat-popups-032/run.ts after after-replay
```

Use fresh output names. `before` selects the pinned focus-fix commit and keeps its original heavy styling; `after` selects the current working production files. Each invocation owns and closes its fixture. No live provider, account, GitHub, native picker, actual call, packaged app or complete full-App workflow was exercised.

The focused component/frame tests, both TypeScript projects, touched-file lint and strict nine-skin contrast checks pass. Their exact counts and log hashes are in [verification.json](evidence/origin-flat-popups-032/verification.json). Full client/shared, backend and packaging checks were not rerun for this worker increment.

At 375px, the populated Triggers row's two names are cramped on both baseline and after source; the retained screenshots show this existing row-layout problem. Other dialogs, sidebar menus/toasts and onboarding decorative halos from the wider shadow inventory remain separate work. This report does not claim whole-app UI acceptance or publication.
