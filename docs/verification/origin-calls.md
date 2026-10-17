# Origin member-call verification

This fixture mounts the production `MemberCall`, `MemberCallHost` and sidebar call banner. Its HTTP endpoints use the production Origin member routes and SQLite realtime store, with synthetic account/project authorization and empty `MediaStream` capture. The fixture launches through `launchVerificationServer`; its database, home and fake engine are disposable. It does not contact Convex, use a microphone/camera, join a real call or touch the main-checkout servers.

## Reproduce

```powershell
node --experimental-strip-types scripts/verify-origin-calls.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-calls.mjs http://127.0.0.1:PRINTED_PORT/__origin-calls.html
node scripts/testing/check-origin-call-audio.mjs http://127.0.0.1:PRINTED_PORT/__origin-calls.html
npx.cmd vitest run src/components/origin-pages/CallPage.lifecycle.test.ts src/lib/member-call.test.ts src/lib/call-agent.test.ts server/origin-members.test.ts server/origin-call-session.test.ts server/origin-call-agent.test.ts
npx.cmd tsc -b
npx.cmd tsc -p tsconfig.server.json
```

Stop the exact foreground launcher with Ctrl+C. It releases pending synthetic leave requests, closes its preview/database and stops its own isolated server.

## Proven bugs

| Severity | Source | Concrete scenario and previous result | Fix |
| --- | --- | --- | --- |
| P2 | `src/components/origin-pages/CallPage.tsx`, `src/lib/member-call-session.ts` | Leave the first call while its HTTP leave response is delayed; start a second call before that response completes. The first handler calls global `endMemberCall()` and drops the second call. The regression test failed with `expected undefined to be 'fixture-team:second'`. | Ending and publishing a call require its config nonce. Starting a replacement clears the previous published state. A late old handler or effect cleanup cannot overwrite the new call. |
| P2 | `server/origin-realtime-store.ts`, `server/origin-members.ts`, `CallPage.tsx` | Join as one person on machine A, then join the same room on B. A's old heartbeat overwrites B's media flags; A's old leave removes B's participant and signals. A's signal GET/ACK can consume B's signaling. A heartbeat after presence expiry also creates a new participant with no matching media negotiation. The HTTP regression returned 200 for a stale update before the fix; expired-presence store tests failed because no error was thrown. | Every join receives a UUID session ID. Heartbeats, leave, signaling reads/acknowledgements/sends validate that ID. Signals also target the recipient's UUID. Expired or replaced calls return 409; the obsolete renderer stops and offers an explicit rejoin. A late join response cleans up using its own returned session ID. |
| P2 | `src/components/origin-pages/CallPage.tsx`, `MemberCallEngine`/`CallAudio` | A remote audio element's `play()` rejects with `NotAllowedError`. `CallAudio` creates a retry button, but `MemberCallEngine` puts that button under `div.hidden`, so the user cannot see or click it. The new host test failed because the retry had a `.hidden` ancestor. | Only the nonvisual audio element is hidden. Retry controls use a visible, stacked menu surface above the dock, and disappear after the synthetic replay succeeds. |

The existing `joinedAt` timestamps remain for participant ordering and SDP metadata. UUIDs distinguish leave/rejoin operations even within one millisecond. Requests without a session ID receive 409 rather than mutating an unidentified call; older clients must rejoin using the updated app. Unknown participant actions return 400 and cannot implicitly join.

## Browser evidence

`docs/verification/evidence/origin-calls/browser-checks.json` records four cases: Midnight and Atelier at 1280×900 and 375×812. All passed with zero page errors and no page-level horizontal overflow. The checker exercises the lobby, join, people panel, shared device selects, reaction menu, raised hand, delayed old leave and replacement by another device. Screenshots wait for the component's opening animation to finish.

| State | Evidence filename pattern |
| --- | --- |
| Lobby and active call | `lobby-{desktop,mobile}-{dark,light}.png`, `joined-*.png` |
| People/device controls | `people-*.png`, `devices-*.png` |
| Replacement immediately before completing the old leave | `replacement-before-old-leave-*.png` |
| Replacement after completing the old leave | `replacement-after-old-leave-*.png` |
| Obsolete machine after a newer server join | `replaced-on-another-device-*.png` |
| Blocked audio before/after making its retry visible | `autoplay-before-*.png`, `autoplay-after-*.png` |

The replacement before/after screenshots describe the actions in the fixed workflow; their pre-fix failure evidence is the failing regression run above. The autoplay screenshots capture the production host before and after the hidden-wrapper fix. `autoplay-before.json` records four invisible retries; `autoplay-after.json` records four visible retries and successful click dismissal, with zero page errors. The autoplay fixture supplies a synthetic WebRTC track and rejects the media API until the retry click; it does not require hardware or real browser audio playback.

Recorded fixture on 2026-10-17: isolated server `http://127.0.0.1:20727`, preview `http://127.0.0.1:5175/__origin-calls.html`, PID 21748, temporary directory `C:\Users\aless\AppData\Local\Temp\openmausbot-verify-data-sInlp5`. Persistent log: `C:\Users\aless\AppData\Local\Temp\openmausbot-verification-evidence\server-1792272753408-2368.log`.

The six targeted Vitest files passed 53 tests. Both TypeScript commands exited 0. Oxlint passed for the touched files with warnings denied.

The recorded launcher was stopped with Ctrl+C. Its child PID no longer existed and neither fixture port was listening. The synthetic temporary directory remained; automatic approval review rejected its verified exact-path removal with `blocked by policy`, so no alternate deletion was attempted. The persistent evidence log remains available.

## Verification limits and drawing inspection

The fixture proves local session lifecycle and production route/store behavior with synthetic authorization. It does not prove real peer audio/video, ICE/TURN across machines, screen capture, real agent transcription/speech, Electron device permissions or authenticated production project navigation. Peer SDP negotiation remains covered by the focused fake-connection tests.

Drawing sources inspected: `src/components/OriginDraw.tsx`, `src/components/origin-pages/DrawingCanvas.tsx`, `backend/convex/draw.ts`. The backend checks canvas/project/workspace membership and edit permissions for scene and image mutations. No Convex process was used or changed.

Two drawing follow-ups remain unimplemented in this call batch:

- `DrawingCanvas` removes an in-flight save batch from `pending` before awaiting the mutation. On navigation, cleanup sends only the remaining pending elements. If the in-flight request then fails, its catch puts the batch back into an unmounted component's ref, where no interval retries it. Browser `beforeunload` protection does not cover in-app navigation. This needs a durable scene save queue or an application navigation guard, plus failure-after-navigation coverage.
- Image downloads have no abort/liveness check. Switching canvases during a delayed image fetch can call `addFiles` on the old canvas object and update the old component's state. A production Excalidraw fixture with delayed synthetic storage responses should cover cancellation and failed-image recovery before accepting that workflow.

The main checkout was inspected read-only. Its member-call edits remove only unused `currentMemberCall`/`selectCallFocus` helpers and related tests; they do not resolve either proven lifecycle issue. Those deletions were not copied into this change.
