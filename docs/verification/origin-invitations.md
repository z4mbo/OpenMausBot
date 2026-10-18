# Public invitations and central email

The invitation fixes address the desktop localhost link reported by the user and the website's lost join confirmation. Candidate 0.2.8 is frozen at `63c38a2cf5e22166efafb7e727b562988e5b084c` and remains unpublished; its draft and private builds are not a shipped release. Candidate 0.2.9 carries the invitation fixes forward and adds the optional mail transport described below. The completed public 0.2.7 release remains recorded separately in [the delivery record](origin-delivery.md).

## Reproduced defects

| Severity | Source at correction | Scenario and wrong result | Logical fix |
| --- | --- | --- | --- |
| P2 | `server/origin-invites.ts:95`, `src/lib/origin-members.ts:95` | With the official backend selected, a loopback desktop with no configured public app URL creates and copies a localhost join link. Another computer cannot use it. | `560eaa1cd`, `c24064a1c`: derive a separate invitation website from the issuing backend; the hosted backend uses origin.imbored.fun. Preserve the existing feedback address behavior. |
| P2 | `backend/convex/workspaces.ts:189`, `backend/convex/lib/invitationMail.ts:9` | Email uses a desktop-local key; the old backend fallback can emit localhost, a missing sender still attempts delivery, and provider rejection/network failure has inconsistent reporting. | `560eaa1cd`: central backend sender/key, one persisted invitation, bounded request and sanitized accepted/not_configured/failed result. A failed email keeps the same manual-share link. |
| P1, conditional on mail credentials | `backend/convex/workspaces.ts:102` | After 19 invitations, two concurrent email actions for the same creator in different workspaces both reserve and send. | `560eaa1cd`: an indexed transactional reservation admits one action at the 20-per-hour creator limit, before provider work. The quota spans workspaces and resets as invitations leave the rolling window. |
| P1, conditional on mail credentials | `backend/convex/teams.ts:165`, `backend/convex/members.ts:140` | Obsolete public email actions accept a client-selected origin and interpolate unescaped HTML, providing an alternate mail path when the central key is enabled. | `d0abdffc5`: retire those email entry points with a migration error before row or provider work. Bare legacy invitation mutations, existing rows, roles and acceptance remain unchanged. |
| P2 | `site/components/auth-page.tsx:30` | Accepting an email-bound invitation revokes its preview; reactive null replaces pending or successful membership with “Invitation unavailable.” Pending completion can also appear under a changed account/invite. | `bd1193a81`: scope acceptance state above the unavailable branch to the invitation/session/account and guard duplicate clicks. |

## Verification

Run the fixture from the isolated worktree, in separate foreground terminals:

```powershell
node --experimental-strip-types scripts/verify-origin-invites.ts --before
node --experimental-strip-types scripts/verify-origin-invites.ts
```

Each launcher uses `scripts/control-omb.ts` to start its own fake-engine server and mounts two loopback Vite pages. Use the exact printed member and acceptance URLs. The member screen exercises the actual component and HTTP route with fake Convex and mail transports. The acceptance screen exercises the actual AuthPage/card CSS with a synthetic session, reactive preview and controlled mutation. Navigation/download shells are synthetic. No real account, Convex mutation or email provider is contacted.

The before mode loads four exact source blobs from `683f3e5e9ef0a53d86723fc0aa2403ab831993b7`: UI source is unchanged under its original module IDs; the Node route changes import resolution only. Source hashes and route calls are retained in [the source proof](evidence/origin-invites-028/source-and-route-proof.json). In the acceptance screen, click Join workspace, Invalidate preview, then Resolve acceptance or Reject acceptance. Stop only these owned foreground launchers with Ctrl+C after retaining evidence.

At the frozen 0.2.8 checkpoint, the real pending-copy DOM test fails against the old source and passes after the fix. Backend baseline checks fail 12 of 14 assertions, including new contract expectations and an absent-timeout case; this is not 12 distinct bugs. The two legacy-action regressions fail against the old actions. All 148 backend cases across 19 files and 63 server/public-page/shared-address cases pass. Actual AuthPage tests reproduce seven failures across the final 11 cases; the fixed site passes all 14 cases including its existing CSP tests. The focused desktop integration covers 39 cases across four files. Client/server/backend/site types and touched lint pass.

The 0.2.8 complete client/shared run passes 5,945 tests across 560 files in 374.43 seconds. The eight guard, release, deployment and private-file suites pass 128 cases. Browser evidence separately covers public/localhost URLs, truthful email states, custom-backend refusal and join invalidation at 375/1440 pixels in light/dark themes. Synthetic browser behavior does not establish real provider delivery, production membership persistence or packaged acceptance.

| Screen | Matched before | Matched after |
| --- | --- | --- |
| Desktop Members, 1440 dark | [Localhost link](evidence/origin-invites-028/members-before-1440-dark.jpg) | [Public link](evidence/origin-invites-028/members-after-1440-dark.jpg) |
| Mobile Members, 375 light, provider failure | [Misleading setup notice](evidence/origin-invites-028/email-failed-before-375-light.jpg) | [Failure with shareable public link](evidence/origin-invites-028/email-failed-375-light.jpg) |
| Website join, 375 light | [Lost confirmation](evidence/origin-invites-028/acceptance-before-375-light.jpg) | [Successful join retained](evidence/origin-invites-028/acceptance-after-375-light.jpg) |

The synthetic website shell supplies the existing compiled Next Inter Latin font through one fixed asset route; its hash and availability are in the source proof. AuthPage and its card CSS remain the actual before/after implementations. The shell labels its fake session, transport, navigation and download behavior. The [browser proof](evidence/origin-invites-028/browser-proof.json), [unit proof](evidence/origin-invites-028/unit-proof.json) and [manifest](evidence/origin-invites-028/manifest.json) retain the verification boundaries and file hashes.

## Configuration and remaining limits

The backend defaults to Resend, using `RESEND_API_KEY` and a verified `INVITE_FROM_EMAIL` sender. The names-only public-deployment check at `2026-10-18T10:46:40.988Z` found both absent; it read no credential values. No usable invitation-mail configuration has been activated during this follow-up, and no real recipient email has been sent. Provider acceptance means HTTP acceptance, not inbox delivery.

### Optional Brevo transport for 0.2.9

Commit `fc00c55f3283576e3b8e0bd58106ddd0ce6b247a` adds explicit backend-only `ORIGIN_INVITE_MAIL_PROVIDER=brevo` selection with `BREVO_API_KEY`. An unset provider keeps the Resend default. Unknown providers and missing selected-provider credentials report `not_configured`; they do not select another transport. `INVITE_FROM_EMAIL` accepts a bare address or `Origin <address>` for Brevo. Malformed addresses, multiple senders and embedded control characters are refused before a provider request. The shared environment sanitizer removes `BREVO_API_KEY` case-insensitively from inherited engine and installer environments.

The existing `workspaces:sendEmailInvite` action and wire results are unchanged. Authorization, project/role checks and the indexed creator quota still precede the single persisted invitation. Only the selected provider receives one plaintext request with a 15-second abort signal. Rejections, network errors and timeouts return sanitized `failed` status, preserving the same manual-share link. There is no automatic retry or fallback after an uncertain provider outcome. The request matches Brevo's [transactional email API](https://developers.brevo.com/docs/send-a-transactional-email).

The initial expanded invitation suite reproduced 21 failures with 17 passes against the Resend-only implementation. The final suite adds authorization/rate-limit variants and passes all 41 cases, including Brevo HTTP acceptance, sender validation, both-provider authorization/quota behavior and no fallback after failure. This is feature/regression coverage, not a count of 21 separate production bugs. The original environment checks reproduced three failures; the corrected config/actual-installer suite passes 217 cases with two existing skips. The complete fake-Claude suite passes 203 cases with three existing skips. Focused isolated CLI-probe/engine checks pass six cases; their other 202 cases were filtered out. Backend/server types and full lint pass in the isolated implementation worktree. After inclusion in the root candidate, its complete backend run also passes 175 cases across 19 files. [Sanitized mail verification](evidence/origin-invite-mail-029.json) retains the source mapping, test counts and log hashes.

Provider account registration and any required account agreements remain pending user approval. No provider signup, API-key creation, DNS mutation, mail activation or real invitation delivery has been performed. Before activation, Brevo requires [domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC) and may require [transactional-platform activation](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP). The optional code and mocked tests do not establish provider approval, inbox delivery or deployed Convex behavior.

The creator quota is an abuse bound, not global signup-abuse protection or mailbox verification. Existing signup authenticates an account and checks the invited email string plus the bearer token; it does not independently verify ownership of the mailbox. Custom backends must configure their own public HTTPS invitation site and cannot send their tokens to the hosted Origin website.

The browser tool's virtual clipboard returned empty despite visible Copied feedback. Browser captures establish displayed link values and feedback; the unit regression establishes the exact argument passed to the shared copy helper. Native clipboard contents remain unverified.

The old and new full-page/raw-device capture attempts painted incorrectly and are excluded. Retained mobile screenshots use the supported browser viewport and ordinary viewport captures. Website images omit its reserved 10-pixel vertical scrollbar, so the 375/1440 viewport captures contain 365/1430 pixels of page content; the DOM checks retain the viewport width and prove no horizontal overflow. Content below the viewport is outside those images. Existing cleanup approval rejections remain recorded; no alternative deletion or process termination bypass was attempted.
