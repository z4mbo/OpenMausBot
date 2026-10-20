# Finite merged UI preview 048 — prepared, not launched

This uses actual current components with the repository's documented `mountPreview` method and `origin-pages-cloud.ts` synthetic query store. Chief budget/heartbeat/call-note inputs are derived from `origin-chief-ops-preview.tsx`. Campaign, Pipeline and published-page shapes follow the corresponding 0.4 fixtures and shared contracts. Core Usage, model hosting, fallback ordering and PR chat use the earlier reviewed component preview under a fresh route. No generic backend or new product feature is introduced.

Only root launches and drives CUA. The source must first be committed and clean; the launcher refuses any other HEAD or unresolved index. Default invocation prints a plan and opens no listeners. Root launch:

```powershell
& 'C:\Users\aless\Documents\Origin-bugfix\.omb-scratch\runtimes\node-v24.21.0-win-x64\node.exe' .omb-scratch/integration-048/ui-preview/launch.mjs --expected-head FULL_FINAL_COMMIT --run-id root1
```

One owned process creates a GET-only synthetic status listener and a Vite listener using atomic free loopback ports. Neither is a product app server. Protected 3210/3211/5199/8799 are refused. It prints the actual preview URL, PID, API port and source manifest SHA. Root retains its PTY session and stops only that process when finished. Existing preview PID48432/50063 is untouched. Reusing a run directory is refused; it retains source identity, fixture identity and bounded HTTP call names after closing.

The launcher binds the exact clean Git source plus 46 named component/contract/fixture raw hashes. It does not inventory thousands of unrelated files. Each browser receipt must include that source and the fixture-file hashes; preparation hashes are not capture-time acceptance.

## Six finite cases

Replace BASE with the printed `http://127.0.0.1:PORT/__origin048.html`. Inspect at 375 px with one representative desktop check. Use both themes where the same layout changed; avoid a full audit repeat.

| Case | URL suffix and selected actions |
| --- | --- |
| Campaigns | `?screen=broadcast&theme=light`: select Campaigns; open Spring launch and inspect metrics/timeline/content; return and open New campaign. Fill Name and Goal to inspect slug/help/layout, then cancel. Do not save, change campaign status, fetch metrics or ask the Chief. |
| Pipeline | `?screen=pipeline&theme=light`: verify readable search, switch Table, inspect score/next actions, open Aria Example and the existing sequence/reply. `&sequence=none` shows the sequence builder instead. Inspect inputs and cancel; do not send, start/pause/stop a sequence, clear replies or save. All provider channel flags are false. `&channels=unknown` tests the separate unconfirmed-status UI. |
| Canvas pages | `?screen=canvas&theme=dark`: open Pages, inspect the synthetic page/metrics and capture-off warning, then close. Open Layers, select Waitlist, open Design and inspect PublishSection. Select Linked button and Waitlist form to inspect PageInspector fields. Toggle both compact panels closed. `&pages=empty` shows unpublished frame form. Do not publish/unpublish, follow external page links, upload or ask the Chief. Any local Canvas edits stay in the fixture's own unsynced outbox; no persistence is claimed. |
| Monthly budgets | `?screen=org&theme=light`: inspect workspace/project/agent budgets, open an available budget editor, edit its local draft and cancel. `&role=member` shows nonadmin controls. Do not save or raise a limit. |
| Chief follow-up cards | `?screen=heartbeat&theme=light`: inspect enabled settings without saving. `?screen=call-actions&theme=light`: toggle the local checkboxes and inspect selected action count; do not create/dismiss issues. These mount the actual cards, not a live call or routine. |
| Existing core combined header | `?screen=core-chat&theme=dark`: inspect monthly budget pill alongside Usage; open quota/reset/context details, close, and inspect synthetic PR card without merging. `&width=wide` and `&width=full` retain existing width presets. `?screen=core-agent&theme=light` checks ranked backups; move then cancel. `?screen=core-hosting&theme=light` checks source owner/device UI without enabling or sharing. |

Use `state=loading` or `state=empty` only for a specific relevant surface. They are synthetic query states, not backend failures. Role defaults to owner; `role=viewer` exercises actual component read-only presentation without granting authority.

## Boundaries

- `cloudMutation`/`cloudAction` always reject before network; their names are recorded, with no success simulation. HTTP accepts only the explicit synthetic GET status responses. Browser fetch rejects writes and nonlocal origins, and CSP prevents external images/media/frames. External anchors/window-open are blocked.
- No real Origin session, credential, provider, recipient, backend or production public-page route is configured. The Pipeline adapter supplies only synthetic channel status and rejects send/refresh without reading or writing the real session store.
- Foundation query seeding and local reducers are reversible fixture state. No mutation button is acceptance of saving, publishing, outreach, collaboration, spending, provider execution or native behavior.
- This has only passed preparation/syntax/default-plan checks. Root's actual browser findings/screenshots establish the finite UI results. Earlier candidate047 screenshots remain historical and do not prove this merged source.
