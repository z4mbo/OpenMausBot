# Provider usage and model authentication

The Usage panel's subscription check does not establish whether a model can run. At baseline `b3a1516046de073855d647ec83891d79c60c431d`, four independent paths incorrectly said to sign in again: a missing saved usage token, a locally expired token, a credential-reader failure, and HTTP 401/403 from a quota endpoint. The panel displayed each result as a red account error.

The configured fleet also always includes Claude API. Its `claudeAgent` driver was sufficient to enumerate it as a personal subscription, even though its model uses an API key. Managed connections and the separately stored ChatGPT-plan connection could similarly consult an unrelated personal credential file. Grok's successful billing response was discarded when its separate credits request returned 401/403.

| Severity | Concrete scenario | Correction |
| --- | --- | --- |
| P2 | A Claude API connection has a working key but no subscription OAuth file. Opening Settings → Usage shows `Sign in again in Claude`. | `server/plan-usage.ts` filters API-key, disabled, managed, custom Claude routing and separately authenticated ChatGPT-plan connections before reading personal subscription credentials. API activity remains in History. |
| P2 | A model CLI refreshes its own authentication, uses another supported credential store, or has no access to its provider's quota endpoint. The quota reader sees missing/expired/unreadable credentials or a usage-only HTTP refusal and labels model sign-in broken. | Missing, expired, unreadable and refused quota access have distinct usage-only messages. The actual model authentication path is unchanged. `src/components/PlanUsage.tsx` uses neutral text and explains that unavailable quota does not establish failed model access. |
| P2 | Grok credits returns 403 while billing returns a valid 40%-used monthly allowance. Usage discards both responses and demands sign-in. | A successful billing response remains available; the monthly allowance is 60% left and unreported weekly/5-hour windows stay unknown. |

Fix commit: `2f98369ea8746d661ee1e5a56870000121989dd7`.

The server regression baseline produced eight failures with fourteen existing passes. The final server suite passes 26 cases. The presentation regression baseline fails two of three cases; the corrected component passes all three. The focused configuration, quota, presentation, release-CI and release-note run passes 293 cases with two platform skips. Both client/server TypeScript checks and touched-file lint pass. Full client/shared acceptance passes all 6,047 cases in 570 files. After the version bump, all 54 release-CI/release-note guards pass again.

## Browser evidence

The [retained evidence](evidence/origin-plan-usage-040/manifest.json) contains paired baseline/fixed screenshots, synthetic API results and a browser record. All six scenarios use the actual `planAccountsFromInstances`, `fetchPlanUsage` and `PlanUsage` component. Baseline mode freezes the two named modules from `b3a1516`, retaining current imports; it does not recreate the entire historical application.

| Screen/state | Before | After |
| --- | --- | --- |
| Missing quota credentials, dark desktop | [Before](evidence/origin-plan-usage-040/before-dark.png) | [After](evidence/origin-plan-usage-040/after-dark.png) |
| Missing quota credentials, light 375 px | [Before](evidence/origin-plan-usage-040/before-missing-light-375.png) | [After](evidence/origin-plan-usage-040/after-missing-light-375.png) |
| Grok billing fallback, dark desktop | [Before](evidence/origin-plan-usage-040/before-grok-fallback-dark-1280.png) | [After](evidence/origin-plan-usage-040/after-grok-fallback-dark-1280.png) |

The fixed browser journeys also cover expired credentials, unreadable credentials, forbidden quota access and healthy quotas. No tested viewport overflows horizontally at 375 or 1280 px. Refresh preserves the successful Grok fallback. The fixture records no browser warnings/errors in the observed fixed tab. Unknown quotas have no invented allowance; the healthy Codex account remains available beside failures.

Reproduce with a fresh isolated fixture:

```powershell
node --experimental-strip-types scripts/verify-plan-usage.ts --before-ref=b3a1516046de073855d647ec83891d79c60c431d
node --experimental-strip-types scripts/verify-plan-usage.ts
```

Each launcher prints its own preview and proof URL. Add `?scenario=missing&theme=dark`; supported scenarios are `missing`, `expired`, `read-error`, `forbidden`, `healthy` and `grok-fallback`. Use the printed free ports. The launchers use disposable fake-engine servers and dependency-injected synthetic quota responses. They do not read owner credentials, access a keychain, contact model providers or mutate production data. The protected main checkout and its services are untouched.

## Acceptance boundary

This fixes proven false diagnoses, wrong-account quota reads and discarded Grok billing data. It does not prove the user's live provider quotas are readable. The quota reader remains read-only: it does not refresh or overwrite a CLI's tokens. A CLI can renew its own session for model turns while its separately read saved usage token is expired. Provider availability, a full App journey and installed Windows/Mac interaction remain separate acceptance checks. The 0.2.15 package and shared changelog are a candidate until delivery evidence confirms publication.
