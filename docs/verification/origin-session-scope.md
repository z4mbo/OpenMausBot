# Authentication response ownership

Fix `bfa4597452a871af28caa614b0594c34fd980119` addresses three concrete session races found after the published 0.2.13 source. It is not part of that immutable release. [Evidence manifest](evidence/origin-session-scope-036/manifest.json) · [source and browser boundaries](evidence/origin-session-scope-036/source-proof.json) · [validation](evidence/origin-session-scope-036/validation.json).

This packet records the initial focused correction. Subsequent peer review found additional gaps in the actual desktop sign-in form, account changes that return to the original values, immediate backend switches and concurrent local-server handoffs. Those require separate follow-up evidence; the eight desktop and six site cases here do not establish coverage of those paths.

| Severity | Scenario → wrong result at ec28 | Correction and location at the fix |
| --- | --- | --- |
| P1 | Begin a login on backend A, switch to backend B, then resolve A's login. Its token is stored while B is selected; the actual hooks dispatch that token to B's watched and one-shot auth queries in the controlled transport. | `src/lib/origin-cloud/hooks.ts:159` captures backend/session ownership before the request and rejects a stale completion before storing its token. |
| P2 | A login/form callback waits while another tab establishes a new account. The older response overwrites the replacement session. | The desktop login and `site/components/brand.tsx:72` save callback require their captured session to remain current; stale completion offers a retry. |
| P2 | Logout for account A waits while another tab signs in as B, or the desktop switches backend. When the old request succeeds or fails, unconditional local cleanup clears the replacement session. | `src/lib/origin-cloud/client.ts:92` and `site/components/brand.tsx:76` clear only the matching current session. The desktop also checks backend ownership, including equal token text on different backends. Current-session logout still clears locally on success or network failure. |

The backend authorization protocol is unchanged. These checks prevent asynchronous client work from mutating a replacement authentication context; they do not grant access, change roles or bypass session validation.

## Regression evidence

The initial full desktop suite reproduced five failures and three passes. A strengthened cross-backend case also reached the real query-dispatch assertion and observed the first backend's synthetic token sent through the second backend's controlled client. The corrected suite passes all eight cases. The first desktop command used an unsupported `.test.tsx` filter and found no tests; that attempt is retained and excluded. Root tests use `.test.ts` and `createElement` without changing the repository test selection.

The site initially reproduced two failing sign-out cases with two passing controls. The expanded six-case suite reproduced three failures and three passes, then passed all six after correction. Related desktop checks pass 26 cases across four files; the whole site suite passes 31 across three files. Counts overlap and must not be added as unique cases. Client and site TypeScript and full repository oxlint returned exit 0. The first attempted eslint command was unavailable; it is preserved separately and is not reported as a successful lint check.

## Actual two-tab browser check

Both versions use the real `AuthPage`, real `useOriginSession`, real browser localStorage and native cross-tab storage events. The before page substitutes only the exact ec28 brand module at its original path. Convex replies, identities, navigation and download shell are synthetic. The toolbar labels these boundaries. Typography uses the same system font and is outside acceptance.

1. In tab A, establish the first fixture account and click its actual Sign out button; hold that synthetic response.
2. In tab B at the same fixture origin, save the second fixture account through the actual hook. Native storage events update tab A's account UI.
3. Resolve A's old response. Before correction, both tabs lose the replacement session. After correction, the second account and its workspace remain visible. Reloading the fixed tab preserves the second session.

| Original response settled | Actual capture |
| --- | --- |
| Before: replacement account disappears | [Before](evidence/origin-session-scope-036/browser-before.png) |
| After: replacement account remains signed in | [After](evidence/origin-session-scope-036/browser-after.png) |

The before screenshot proves its toolbar and signed-out heading/visible-field scope, not every form pixel. The initial capture lacked the fixture font fallback and remains rejected/preserved. The matched run used the corrected shared wrapper. AX snapshots retain the observed states, and the fixed reload has its own snapshot. No full typography, mobile/theme matrix or every auth-state acceptance is inferred.

Each browser launcher used the standard isolated fake-engine server. The initial and matched before launchers and the after launcher all stopped through their owned foreground handles; their PIDs, health listeners and temporary directories are confirmed absent. Only those test tabs were closed. The existing sample-data app and published website remain separate.

This closes the named client-side races, not the complete persisted two-client Batch A journey. Native Convex subscriptions, backend restart persistence, account/membership revocation and full-App private-cache eviction still need their own disposable native-backend evidence. The original port restriction requires a narrow exception before starting another native backend; no existing Convex process or production data was used here. No real invitation email or external account was created.
