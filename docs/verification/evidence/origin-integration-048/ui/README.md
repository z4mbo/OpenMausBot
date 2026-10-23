# Origin 0.4.1 integration UI evidence

This archive records root-operated CUA inspection of actual merged components with synthetic query/status data. The archiving agent did not operate the browser. It also retains focused merge, monthly-budget, and Canvas regression evidence. It does not establish provider execution, native app operation, persistence, production delivery, or successful outbound actions.

## Source and fixture boundaries

| Run | Clean source | Source bindings | Purpose |
| --- | --- | --- | --- |
| root1 | `6d1c772d121d557e9742e71da8102f453d9e336f` | 46 | Initial merged feature inspection and monthly-budget overflow before capture |
| root2 | `86b9326afd81d277117ec953b7a9b70caed07d07` | 47 | Budget, Canvas positioning/scrolling fixes and theme/viewport checks |

Each run retains its original `source.json` and `fixture.json`. `source-match.json` verifies all 47 root2 raw file hashes against the working tree at archive time, when HEAD was exactly root2's source. Root owns any later docs-only source-equivalence qualification.

The copied fixture files are byte-preserved snapshots from the original ignored `ui-preview` directory; their imports retain those original paths. They are evidence, not an independently runnable application. `copied-files.json` maps archive paths to original paths and hashes. `manifest.json` binds every archive payload except itself.

The preparation receipt and derivation describe an earlier 46-binding, 14-payload preparation. Root later added Toolbar as binding 47 and bounded live HTTP method/path logging. Their old launcher hashes/counts must not be treated as current: this archive records the actual launcher, binding-list and adapter bytes separately. No historical root1 launcher-byte equivalence is asserted beyond its retained run/source manifests and root's reported fixture operation.

## Focused checks

| Evidence | Before | After | Qualification |
| --- | --- | --- | --- |
| `checks/merge` | 109 passed, 8 fixture failures in 13 files | 117 passed in 13 files | SequencePanel received a lead-shaped test mock. Query mapping and required fixture fields were repaired. The source supplement records root's later required no-op `onSequence` callback; no identical-byte rerun claim is made. |
| `checks/budget` | 3 new interaction tests failed | 53 passed in 3 files | Compact monthly status, admin editor, permission restriction, dismissal and focus return; happy-dom does not establish CSS geometry. |
| `checks/canvas` | New wheel test failed; 7 skipped | 8 passed | Before, a toolbar wheel event was prevented. After, toolbar scrolling is left to the browser without panning the Canvas. The earlier 7-test green log predates that regression. |

The corresponding focused lint/type logs and receipts are retained. Empty successful logs have the empty-file SHA-256; exit-status statements come from the originating receipts/root report, not from empty bytes alone. No new checks or captures were run while creating this archive. The later root-owned final global check is outside this archive.

Fix commits: budget `d03d8ddf8c78443f74d5c6ef07936b27d0651a26`, Canvas layout `ccb65fbab1dbfc5261b9bc6ae9b234448157a3d9`, Canvas wheel `86b9326afd81d277117ec953b7a9b70caed07d07`.

## Root's browser observations

At 375px, the before budget message consumed 262px, pushing Model to x355, Computer to x393 and More to x431. After, the Wallet is 28px plus its border (30px total), all header controls end at or before x355, and document width is 375px. Root opened the synthetic `$20 of $20 this month` status and Raise budget editor, then cancelled and confirmed focus returned. The dialog was 320px wide at x8/right328/bottom312.5. Dark/light mobile and a desktop header are captured; wide desktop retains the full budget status.

The Usage panel displayed synthetic session 32%, weekly 61%, reset information and context 20k/100k. These values came from the fixture GET response, not a real provider account.

Root reported Canvas Layers at x-99 after focusing Design before the layout fix. After, Layers bounds were x13/right45 and Design x330/right362; both button centres hit their own controls, and root actually closed both panels. Horizontal toolbar scrolling moved 0 → 116 → 0 while the camera remained `translate(24 206.25) scale(0.340625)`. The light 375px viewer capture exposes Move/Hand and the panel toggles. The Canvas before measurement is root's reported CUA observation; no separately matched Canvas-before image is fabricated here.

Other finite root1 checks: Campaign detail and a filled New campaign form cancelled; Pipeline Table → Aria → existing sequence and reply scrolling; Canvas Pages and Publish form inspected without publishing; Org monthly budget draft of 175 cancelled; Heartbeat Off inspected; Call action selection changed locally from three to two without Create; backup ordering and disabled shared-source editing inspected then cancelled; desktop Campaign inspected. These do not establish saved state or functioning outbound integrations.

## Captures

`runs/root1` contains 13 images: backup ordering, Call actions, Campaign detail/form/desktop, Canvas Pages/Publish/Publish form, header before, Heartbeat, hosting source, Org budget and Pipeline sequence. `runs/root2` contains seven images: budget editor, Canvas panels/viewer, header after in dark mobile/light mobile/desktop, and Usage/context. All 20 image hashes are in the manifest.

All cloud writes and nonlocal/provider/recipient/public-page operations were blocked by the fixture. An automatic Pipeline lead `markRead` mutation was attempted and blocked; this is not a claim of zero attempted writes. The retained root2 live HTTP log is only a bounded method/path snapshot for the local synthetic status listener, not a complete browser/cloud action log. Root1 was stopped with Ctrl+C and its PID closure was verified by root, but no final root1 HTTP log is asserted. Root2 remained alive under root ownership when archived. No Save, send, publish, merge, metrics, real provider, native or production acceptance is claimed.
