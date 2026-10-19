# Public signup policy loading

Anonymous `/signup` visits wait for the public signup policy before offering
registration. Sign-in and a verified invitation remain available while that
separate policy query loads. An unavailable policy offers recovery after ten
seconds.

## Proven failure and correction

Baseline `697e9f0adacd7d90af9b3f190ab5c4df978b48f1` renders four registration
inputs when `signupMode` is initially `undefined`: its optional `inviteOnly`
value becomes false. When `{ inviteOnly: true }` arrives, the form disappears,
including any fields the visitor has started entering. This is a **P2 UI/UX
defect**; it does not establish an authentication bypass.

Commit `2a9628f7c13cfb628d0401f0cd3f1a464a6f9511` uses the existing accessible
loading state until the policy resolves for signup without an invitation. An
open policy shows the form, and an invite-only policy shows the existing notice.
The backend authorization path is unchanged. Static inspection of
`backend/convex/auth.ts` confirms `signupAccount` separately rejects a missing
invitation on an invite-only instance; this verification did not exercise that
mutation.

## Retained evidence

The [report](evidence/origin-signup-policy-032/report.json) records **16 actual
Chromium screenshots**: before/after × 375/1440 px × light/dark × pending and
resolved invite-only policy. Every pending baseline case has four inputs and
one form; every corrected pending case has zero inputs and an accessible
loading status. Resolved invite-only screenshots have identical before/after
hashes. No overflow, page exceptions, external requests, or authentication
action calls occurred in these captures.

| 375 px, light theme | Screenshot |
| --- | --- |
| Before: pending policy offers registration | [Before](evidence/origin-signup-policy-032/before-375-light-pending.png) |
| After: pending policy displays loading | [After](evidence/origin-signup-policy-032/after-375-light-pending.png) |
| After: invite-only policy has resolved | [Resolved](evidence/origin-signup-policy-032/after-375-light-invite-only.png) |

The [finite manifest](evidence/origin-signup-policy-032/manifest.json) binds 24
files by byte count and SHA-256, excluding itself. Original browser JSON and
screenshots are copied unchanged. Test logs are gzip copies of unchanged raw
Windows output; the report records their uncompressed hashes. [Source binding](evidence/origin-signup-policy-032/source-binding.json)
links both captures to Git blobs and exact raw source hashes, with the Windows
line-ending conversion explicit. The fix commit is an isolated worker commit;
an integration cherry-pick can have a different commit ID while retaining the
same component and regression blobs.

The browser fixture renders the actual `AuthPage` and its CSS. Session, policy,
invitation preview, authentication actions, site shell, navigation and download
shell are synthetic. It uses local system sans fonts, so these images are not
a production-font pixel comparison. The browser context requests reduced
motion; these captures did not measure computed animation behavior.

## Regression checks and limits

With final regression tests and unchanged baseline runtime, **two tests fail
and 13 pass**. After the correction, the site's **18 tests across two files**
pass. Site TypeScript checking reports no diagnostics. Independent source
review found no additional concern.

```powershell
cd site
node ../node_modules/vitest/vitest.mjs run --config vitest.config.ts
cd ..
node node_modules/typescript/bin/tsc -p site/tsconfig.json --noEmit --incremental false
```

Component tests additionally cover open signup becoming available, sign-in
during policy loading, and signup with a verified invitation during policy
loading. Those paths were not separately submitted in a real browser. No live
signup, login, invitation acceptance, email delivery, packaged desktop, or
production authentication claim follows from this fixture. The published
release, version and changelog remain unchanged by these commits.

## Unavailable policy and Retry

The initial loading correction alone could still wait indefinitely when the
policy transport never resolved. The site provider mounts a Convex client but
has no signup-policy deadline or connection recovery UI. An isolated indefinitely
pending policy remained loading, with no alert or Retry action, after **60 seconds
of virtual browser time**. This was not a live-backend outage test.

Commit `5b4aa15ea0968ba53128d40bef45466e099a96c5` bounds that wait to **10 seconds**.
The loading indicator becomes a connection alert with **Try again**. Timeout
pauses the query subscription using Convex's `skip` argument; Retry resumes it
and starts another bounded wait. An unknown policy never enables registration.
Resolution and unmount cancel the timer, and callbacks belonging to an older
flow cannot change the current flow. Sign-in and verified invitation signup do
not start this query deadline. The existing CSS is unchanged.

The separate [timeout report](evidence/origin-signup-policy-timeout-032/report.json)
retains **24 actual screenshots** across 375/1440 px and light/dark themes: eight
baseline states and sixteen corrected pending/timeout/Retry/resolved states.
The corrected browser flows resolve the retried policy after nine virtual
seconds, then advance another twenty seconds without a stale timeout. There are
no authentication action calls, external requests, page errors or horizontal
overflow. The [manifest](evidence/origin-signup-policy-timeout-032/manifest.json)
binds 32 evidence files, including unchanged raw browser JSON, source snapshots
and compressed original test logs. Earlier policy and release evidence remains
unchanged.

Five final regressions fail against the prior runtime; all **25 site tests**
pass after correction, and the site typecheck has no diagnostics. Coverage
includes early invite-only/open responses, timeout and Retry, stale callbacks,
unmount cleanup, and the sign-in/invitation exemptions. Subscription stop/resume
is checked at the mocked query-hook boundary; this fixture does not measure a
live WebSocket unsubscribe. Existing invitation-preview and session loading
states are outside this correction.
