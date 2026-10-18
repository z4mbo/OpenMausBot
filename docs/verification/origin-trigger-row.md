# Trigger identity on narrow screens

This unpublished responsive follow-up starts from the shared popup pass, `d3362dbcbb468790dda2203ecb8950e3071dc017`. It changes only the populated Triggers row's grouping and name tooltips. Earlier popup screenshots and release evidence remain unchanged; their sources precede this change.

**P2 — unreadable identity at 375px.** At baseline `src/components/TriggersPanel.tsx:309–355`, avatar, identity, Copy link and the switch competed for a single row. In the actual 375×812 browser fixture, the trigger and bot names had only **8px / 7px** of visible width. The example names appeared as `P → P`, so a person could not visually identify the trigger they were about to copy or toggle. The real-browser readability assertion failed on unchanged source; its log is retained.

On narrow screens the avatar and identity now take a full row, followed by the existing action group. Desktop keeps its one-line arrangement. Both names remain complete in the DOM and have full-text title tooltips; long names can ellipsize. No handler, disabled state, action ordering, permission or focus mechanism changed.

[The manifest](evidence/origin-trigger-row-033/manifest.json) hashes **10 original PNGs** and supporting files. The [source proof](evidence/origin-trigger-row-033/source-proof.json) binds the frozen baseline and final working-source bytes, the observed failing assertion, completed browser cases and fixture cleanup.

| View | Before | After |
| --- | --- | --- |
| Dark mobile | [PNG](evidence/origin-trigger-row-033/before/triggers-mobile-dark.png) | [PNG](evidence/origin-trigger-row-033/after/triggers-mobile-dark.png) |
| Light mobile | [PNG](evidence/origin-trigger-row-033/before/triggers-mobile-light.png) | [PNG](evidence/origin-trigger-row-033/after/triggers-mobile-light.png) |
| Dark desktop | [PNG](evidence/origin-trigger-row-033/before/triggers-desktop-dark.png) | [PNG](evidence/origin-trigger-row-033/after/triggers-desktop-dark.png) |
| Light desktop | [PNG](evidence/origin-trigger-row-033/before/triggers-desktop-light.png) | [PNG](evidence/origin-trigger-row-033/after/triggers-desktop-light.png) |

The final mobile example names have **90px / 78px**, enough to display both in full; desktop retains those same widths. Two additional mobile cases cover long names in [dark](evidence/origin-trigger-row-033/long-names/triggers-mobile-dark.png) and [light](evidence/origin-trigger-row-033/long-names/triggers-mobile-light.png): they have **92px / 80px** and preserve the complete text and tooltips. The browser assertion compares available name width against the actual font's first six characters plus an ellipsis, rather than asserting CSS class strings.

The four baseline cases include the mobile readability defect in both themes; desktop remains readable. All four final regular cases and both final long-name cases pass readability, viewport bounds, absence of horizontal document/panel overflow, native forward/reverse Tab containment, Escape and opener restoration. Accepted runs have zero page exceptions, unexpected requests or external requests. The existing Triggers and focus suites pass **13 tests across two files**; app TypeScript and touched-source/fixture lint pass. The existing shared surface/skin contracts are unchanged.

The fixture uses `launchVerificationServer`, `doctor --url` and `mountPreview` from the documented isolation workflow. Its bot, trigger and responses are synthetic. It never invokes an actual webhook or provider. All seven owned fixture launchers/backends and temporary data are verified absent, and the six canonical loopback server/preview ports refuse connections. Main ports 5199, 8799 and 3210 and root browser tabs were untouched. No screenshots were edited. The initial copied checker attempt that still expected a heavy baseline shadow is excluded from readability evidence.

For reproduction, copy the three retained `fixture/` files into `.omb-scratch/trigger-row-033/` with repository and `site/` dependencies installed, then use fresh output names:

```powershell
node --experimental-strip-types .omb-scratch/trigger-row-033/run.ts before before-replay
node --experimental-strip-types .omb-scratch/trigger-row-033/run.ts before readability-red assert-readable
node --experimental-strip-types .omb-scratch/trigger-row-033/run.ts after after-replay assert-readable
node --experimental-strip-types .omb-scratch/trigger-row-033/run.ts after long-replay long-names
```

The explicit baseline readability command is expected to fail on the frozen source. The normal baseline command records the observed defect across both themes. These are production-component browser checks in normal-motion headless Chromium, not packaged/native, full-App or live account acceptance. Full client/shared, backend, server TypeScript and packaging were not rerun for this responsive-only increment.
