# Origin server connections and upstream Cloud boundaries

Local fixes: `a721061d8314a096b9daee206269396ac54d6972` and `81ddda206829aff901ce31417f539583497ec36a`, based on `87ff77be5ea79272175219d479b9a8017b4e8fcc`. These records establish isolated desktop policy and component behavior. They do not establish a published release or installed-app acceptance.

## Findings

| Severity | Scenario and real path | Correction |
| --- | --- | --- |
| P2 | Packaged Origin uses default branding. `cloudOffersAllowed` treated that as an unbranded upstream app, so This computer → Add a Cloud opened the unrelated MausBot Cloud subscription dialog. The packaged preload also exposed the upstream account and plan bridges. | `electron/main.mjs:862,916` limits that vendor account to its own packaged product. `electron/preload.cjs:6` requires its separate native capability before exposing account, plan or lending controls. Origin keeps saved servers, local environments, organization controls, backups and server-to-server copies. Its legacy Cloud link opens Servers (`main.mjs:1954`). Fix: `a721061d8`. |
| P2 | At 375 px, a saved server with Switch, Copy and Forget controls had only **5.984375 px** for its name/address, stacking characters vertically. A no-overflow check alone missed this. | `ConnectedWorkspacesSettings.tsx:80,151` gives the text a readable basis and wraps the action group. The real browser reports **265 px** on mobile and **422.984375 px** on desktop, in both themes. Fix: `81ddda206`. |

Origin does not restore an unrelated upstream account at startup. Native account requests also refuse that unsupported product path. The upstream implementation and its explicit compatibility fixtures remain intact. Saved connections, authorization and confirmation behavior are unchanged. The unused Electron Pro relay was removed alongside the separately documented phone-call correction; this report does not substitute for that call's HTTP/provider proof.

## Actual browser evidence

Run `node scripts/verify-origin-cloud-entry.mjs` from the isolated worktree. It launches its own fake-engine server and free-port Vite preview, then opens hidden disposable Electron windows using the real sandboxed preload and the real `DesktopWorkspaceSwitcher`, `CloudAddDialog` and `ConnectedWorkspacesSettings`. The fixture constructs Electron's real menu from `workspaceMenuTemplate` and selects its native callback. It simulates the packaged product identity and a synthetic upstream offer; it does not display or manually drive the OS menu popup.

Frozen baseline main/preload source produces the paid Cloud dialog. Fixed source removes that menu entry and the account/plan bridges, then opens the existing connection settings. No sign-in, checkout, server connection, switch, deletion, model or production account action is requested. There are zero vendor-account calls after the fix. All final captures pass the horizontal-overflow and readable-name geometry checks.

| Size and theme | Upstream offer before fix | Saved server before layout fix | Fixed Origin connections |
| --- | --- | --- | --- |
| 1440 dark | [Before](evidence/origin-desktop-cloud-policy/before-cloud-1440-dark.png) | [Before](evidence/origin-desktop-cloud-policy/before-server-layout-1440-dark.png) | [After](evidence/origin-desktop-cloud-policy/after-server-layout-1440-dark.png) |
| 1440 light | [Before](evidence/origin-desktop-cloud-policy/before-cloud-1440-light.png) | [Before](evidence/origin-desktop-cloud-policy/before-server-layout-1440-light.png) | [After](evidence/origin-desktop-cloud-policy/after-server-layout-1440-light.png) |
| 375 dark | [Before](evidence/origin-desktop-cloud-policy/before-cloud-375-dark.png) | [Before](evidence/origin-desktop-cloud-policy/before-server-layout-375-dark.png) | [After](evidence/origin-desktop-cloud-policy/after-server-layout-375-dark.png) |
| 375 light | [Before](evidence/origin-desktop-cloud-policy/before-cloud-375-light.png) | [Before](evidence/origin-desktop-cloud-policy/before-server-layout-375-light.png) | [After](evidence/origin-desktop-cloud-policy/after-server-layout-375-light.png) |

The [final browser report](evidence/origin-desktop-cloud-policy/final-browser-proof.json) retains eight actual captures' measurements, menu entries, bridge states and source hashes. The [earlier accepted Cloud report](evidence/origin-desktop-cloud-policy/cloud-browser-proof.json) preserves the narrow-layout baseline. The [manifest](evidence/origin-desktop-cloud-policy/manifest.json) maps all retained bytes and the [report](evidence/origin-desktop-cloud-policy/report.json) binds them to source. Sixteen denied requests were loopback Vite websocket/HMR attempts, including its port-0 fallback; no upstream account/provider request was allowed. Software rendering was used.

Preliminary fixture failures are retained in their original temporary directories: passing raw positional HTTP URLs to this Windows Electron entry exited before executing the fixture, and closing its first hidden window initially triggered the default last-window quit. The final fixture passes an owned configuration file and owns the window lifecycle. The layout regression is separate: [its actual failure](evidence/origin-desktop-cloud-policy/layout-red.log) measured the 5.984375 px label before the CSS correction.

## Checks and limits

The first six policy regressions on baseline produced [five failures and one compatibility control pass](evidence/origin-desktop-cloud-policy/policy-red.log). The final seven policy cases pass, including native Cloud-link routing, startup isolation, the missing commercial bridges, preserved connection controls and absence of the paid-plan relay. The touched desktop Node selection passed **93 tests**. Final source passed **57 Vitest tests in eight files**, app/server TypeScript, touched lint and `git diff --check`. The file-size guard passes; `electron/main.mjs` remains exactly **3518 lines**, with no increased cap.

The extra [complete Electron Node run](evidence/origin-desktop-cloud-policy/full-electron-windows.log) is **757 pass, 4 fail, 15 skip**. All four failures were reproduced independently on [frozen baseline](evidence/origin-desktop-cloud-policy/baseline-windows-limitations.log): two file-symlink cases lack Windows permission, and two Linux AppImage cases require `mv`. The initial baseline export omitted its AppImage patch helper; the retained accepted control includes that helper and reproduces the four actual host failures. These tests were not waived or described as green. Native CI on its supported hosts remains a separate gate.

Full App/OriginSync, the installed Origin executable, installer/updater/tray behavior, physical Mac, actual OS menu popup geometry and real providers remain outside this fixture's acceptance. The fixture closed its own Electron child, preview and fake-engine server; no process-name kill, live main-checkout mutation or production deployment occurred. Superseded native-033 download/resource work was stopped before execution when the user requested the complete follow-up batch.
