# Core app and onboarding inspection

The production App was mounted through `scripts/verify-origin-core.ts`, which starts an isolated fake-engine server through the verification launcher. It used disposable bots Atlas and Juniper, isolated browser storage, and no account or provider credentials. The recorded preview was `http://127.0.0.1:5174/__origin-core.html`; the server was `http://127.0.0.1:20697`.

`scripts/testing/check-origin-core.mjs` passed 56 cases with zero page errors and no document horizontal overflow: chat/sidebar navigation and all 13 available Settings sections at 375/1440 px in Midnight/Daylight. The sections were General, Appearance, Remote access, Model providers, API keys, Decision model, Local VM, Logins, Usage, Backups, People, Activity and Experimental. The mobile Settings select and desktop section navigation were both exercised. Evidence is in `evidence/origin-core/browser-checks.json` and `settings-SECTION-THEME-WIDTH.png`.

The existing mapped `scripts/verify-onboarding-ui.ts` was also run against an isolated `control-omb ui` fixture, with the repository-pinned browser driver. All seven workflow phases passed:

- A failed profile save preserves input and supports retry.
- Reduced-motion welcome reel, engine inventory failure/retry, phone skip and completion.
- Automatic selection of a connected default model and a first fake-engine message.
- All ten guided tour steps and persisted dismissal after reload.
- Settings replay and Skip queued behind a delayed Next save.
- Closing welcome replay while persistence is pending.
- Legacy-install replay, failure and retry.

The original fixture handle was `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-mH4iFT\ui.json`, server `http://127.0.0.1:21227`, preview `http://127.0.0.1:5177/__threads.html`. Screenshots and the seven-phase result log are in `evidence/origin-core/onboarding/`. Both exact foreground launchers were stopped after verification.

## Reproduce

```powershell
node --experimental-strip-types scripts/verify-origin-core.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-core.mjs http://127.0.0.1:PRINTED_PORT/__origin-core.html
```

For onboarding, follow [the mapped recipe](onboarding.md). Always use the freshly printed fixture handle. Stop each exact foreground launcher with Ctrl+C.

These checks establish renderer behavior and fake-engine onboarding persistence. They do not establish real provider login, billing, browser/VM provisioning, microphone capture, Electron-only window controls or native updater installation. Settings with sensitive/external actions were inspected without connecting real services or changing the person's settings. Populated Origin cloud pages, calls and drawing have separate fixtures and reports.
