# Draft defaults

New Origin issues start in semantic Draft unless the person chooses another
column. A renamed column with `isDraft: true` remains Draft; a column explicitly
flagged `isDraft: false` does not become private because its title says Draft.
Every board presents semantic Draft before other open columns. Existing task
destinations and explicit lane/status selections are retained.

## Proven failures

The frozen baseline is `0757f71888d2c5aaf41bd877724949a63d815aa2`.

| Path | Scenario and previous result | Result after correction |
| --- | --- | --- |
| `server/origin-cloud.ts`, `origin_create_issue` | A repository project has Todo/In progress but no Draft. Creating an issue without `column` selects Todo and invokes the GitHub mirror. | Repair the board through `ensureDefaultColumns`, read its Draft, and omit `columnId` so the backend resolves the default. A failed repair stops creation; explicit unknown columns still reject. Draft never invokes the mirror. |
| `NewIssueComposer.tsx` | A nonempty legacy board has no Draft. The generic composer selects Todo and never requests board repair. | Request the backend repair, offer semantic Draft, and omit an unspecified destination. A missing status cannot submit into Todo. |
| `FeedbackPage.tsx`, conversion | Todo precedes Draft in an existing board. Converting feedback chooses `columns[0]` and passes Todo as though the person chose it. | Select semantic Draft regardless of old order and omit the default destination; an explicit selection is retained. With no Draft yet, show Draft and let the backend create it. |
| `IssuesPage.tsx` | An existing board has Todo order 0 and a renamed Draft order 20. Todo is displayed first. Generic New issue passes its inferred fallback ID. | Use shared Draft-first ordering. Generic New issue omits a destination; the lane-specific buttons retain their explicit destinations. |
| `server/origin-mcp.ts`, `create_issue` | The connector schema requires `columnId` and rejects a default creation request. | Make it optional and forward omission unchanged. The description explains the person must explicitly choose a non-Draft column. |

The project/agent prompt and call-summary fallback also state this default.
Column matching helpers were extracted from `origin-cloud.ts` to keep its size
ratchet decreasing; matching by exact ID or normalized title is preserved.

## Creation-path inventory

| Entry point | Destination handling |
| --- | --- |
| Sidebar, command palette, workspace inbox/global New issue | `openNewIssue` → `OriginSidebarExtras` → shared composer; no column is supplied. |
| Project toolbar / C shortcut | Shared composer with no column; Draft is resolved by the backend. |
| Project lane header/footer + / status menu | The selected lane/status is an explicit choice and remains supplied. |
| Feedback conversion | Shared semantic Draft selection with optional explicit override. |
| Project Chief / agent issue tool | Unspecified creation repairs missing Draft before submitting with no column; explicit valid titles/IDs remain supplied. |
| Remote Origin MCP connector | Optional `columnId` forwards to the backend's default boundary. |
| Call action items | Agent work uses the same Origin issue tools; fallback instructions say Draft unless the person chooses otherwise. |
| Generic client `tasks.create` facade | Forwards caller arguments unchanged; backend owns omission semantics. |
| Project creation / onboarding | Backend seeds workflow columns; there is no independent client issue insertion. |
| GitHub / legacy import | Existing external/history tasks have explicit mapped columns; this change does not reinterpret or relocate them. |
| Local `Store.createTask`, routines, rooms | These create conversation threads, not Origin cloud board issues, and have no workflow column. |

## Verification

Run the three regression files with the normal Vitest configuration. With the
same final test bytes, the retained frozen-source loader reports **11 failures
and 51 passes** against the baseline; current source reports **62 passes**.
The additional issue editor, repository privacy, shared column, call summary,
GitHub route and file-size checks pass **134 tests across nine files**. Client
and server typechecks and touched-file lint are recorded separately.

Use the documented isolated fake-engine fixture:

```powershell
node --experimental-strip-types scripts/verify-origin-draft.ts
```

The launcher prints separate before/after URLs and freezes their source at
launch, including the new shared comparator. No production Convex process or
data is used. The cloud facade uses synthetic in-memory rows; its Draft repair
emulates the agreed backend contract. Backend mutation/migration acceptance
belongs to the separate backend verification.

[Evidence](evidence/origin-draft-defaults-031/report.json) contains **32 actual
Chromium screenshots**: before/after × 375/1280 px × light/dark × reordered board,
renamed Draft board, missing-Draft composer and feedback conversion. Document
overflow is absent in these fixtures. The board's own horizontal lane scrolling
is intentional on mobile. The missing-Draft composer can retain Todo's scroll
anchor behind its modal after repair; its selected destination is Draft.

[Form submissions](evidence/origin-draft-defaults-031/browser-flows.json) cover
**20 real-browser flows**: both widths, normal/reduced motion, default composer,
explicit lane, keyboard-selected status, default feedback and explicit feedback.
They assert the actual mutation arguments and preserve explicit Todo choices.
There are no page errors or external requests. These are renderer/fake-server
checks, not packaged Windows/macOS or production acceptance.

The initial local comparator matrix was repeated after adopting the shared
comparator. Every paired screenshot SHA-256 remained identical. The intermediate
metadata is retained explicitly; only the fresh final matrix identifies final
source hashes. One earlier private flow script used an incorrect assignee option
name and timed out; the corrected accessible-name selector completed all 20
cases. That failed harness attempt is not passing application evidence.

## Release ordering

Published 0.2.10 backend validators require `columnId`; these new clients omit
it for Draft. Exposing new clients before the widened backend would cause create
failures. Deploy and verify the backward-compatible optional-column backend and
bounded Draft repair before publishing the new clients/site. The new acceptance
and delivery state must record that ordering. Prior clients' explicit column
calls remain valid. No push, production mutation or release was performed by
this client/server inspection.
