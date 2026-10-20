# Origin 0.3.1 integration candidate

Prepared on 2026-10-20. This candidate combines the model continuity work frozen at `fb7b838aab70c1308023e5df27209641fff5e9c1` with concurrent feature branch `84b0ccedb30615f2fa0a1c9c0d3fd18da0f730d3`. Neither parent was overwritten. PR 3 targets `origin-integration`; PR 2 and all app task pull requests remain unmerged by this workflow.

## Publication drift and hold

A fresh GitHub observation found [Origin 0.3.0](https://github.com/z4mbo/Origin/releases/tag/origin-v0.3.0) published at `2026-10-20T04:28:39Z`, tag source `924d587c03767fb0b6d5d899872f69b00a6f03e7`. At the same observation, the website's Windows update feed still named 0.2.15 and the running website image was `sha256:91b6d2d7ade9b89ac21a95e76b4870c5ee246ad204f8f1acf21112278d0e51ef`. These are different delivery surfaces; GitHub publication alone does not update the website or backend.

The older 0.2.16 native workflow `39372926025`, attempt 1, was cancelled. All prepared 045 artifact/site/backend operators remain held before production mutations. No 0.2.16 draft, upload, backend export/deploy, website image build or download promotion occurred. A new release must be newer than the current public baseline and qualify the combined source. The immutable 0.2.16 tag is retained rather than moved to another tree.

## Integration boundaries

The combined source retains Studio, Broadcast, Pipeline, Canvas, Org, integrations, standups and PR cards, alongside all seven [model continuity notes](origin-0.2.16-release-notes.md) and the additional integration-safety correction in the [eight canonical 0.3.1 notes](origin-0.3.1-release-notes.md). Canonical What's new now lists 0.3.1 followed by the published 0.3.0 history. The earlier 0.2.16 fixture evidence is preserved as historical evidence, never relabelled as combined-source acceptance.

Backend schema comparison compiles both parent schemas and the combined schema. All tables, field validators and indexes from each parent remain represented; the combined schema has 68 tables. Generated API imports preserve both model-host and new feature modules. Backend TypeScript and all 265 backend tests across 30 files passed after resolving the schema conflict. No local backend push or production data operation was used for this comparison.

UI conflict resolution preserves the accepted Compact/Medium/Wide values, shared conversation/composer alignment, compact Usage, teammate source controls, new integration settings, project tabs and PR cards. It preserves shared project ordering and independent specialist chat navigation. The focused UI suites passed 143 checks. Browser acceptance of this combined source is recorded separately when available.

Driver integration composes typed quota tracking with the concurrent signed-out startup handling. Quota continuation still requires a confirmed initial refusal and stopped attempt; authentication failure cannot masquerade as quota exhaustion. New classification/lifecycle regressions and focused suites qualify this combination separately from either parent's old results.

The fresh-folder delegation option and stable parent-child continuity use one allocator. Explicit fresh delegations can inherit the requested project folder without changing the canonical standing child or its context. Pipeline call summaries use the same prepared API budget as live call summaries rather than a separate unbudgeted provider call.

## Verification and delivery boundary

The combined client/shared run passed 6,238 tests across 602 files. Both TypeScript targets passed; all five driver suites passed 696 tests with four platform skips. A separate actual isolated quota/hosting composite passed 62 tests. The final security leaf checks passed 86 tests, transcription/budget checks passed 38, and root integration/route/release/documentation guards passed 57. These suites overlap and are not added together. Full backend acceptance remains 265 tests. Site checks now run both the three Node CSP checks and 31 component tests; the concurrent package script had silently omitted those 31 component checks, which is corrected here. Locale validation passed for 12 languages and 4,736 English strings, with existing partial translations; 183 Electron modules passed syntax checks.

The [combined browser proof](evidence/origin-integration-046/ui/browser-proof.json) covers six finite UI cases: ranked backup movement/cancel, disabled sharing controls, integration settings, responsive project overflow navigation, minimal Usage/context with a PR card, and three chat/composer widths. All inspected 375 px views had document width 375. The fixture uses actual merged components with synthetic data and explicitly does not execute new feature bodies, providers, grants or merges. Source binding limits and corrected fixture startup failures remain in the receipt.

The earlier [045 local source build](evidence/origin-candidate-045/final-source-build/receipt.json), 6,124 client/shared tests and fake-provider native acceptance remain bound to their original source. They are not substituted for a new combined-source build or workflow.

## Additional proved integration defects

| Severity | Concrete scenario | Correction and regression evidence |
| --- | --- | --- |
| P1 | A provider rejects a configured credential and echoes it in its error. Pipeline persists the text to shared Convex activity; Studio and Broadcast return similar raw errors. | Scrub exact configured credentials before clipping, persistence or shared output. Five synthetic failing-before cases now pass. |
| P1 | Studio accepts a project image URL on another loopback port, or an administrative path on the backend host, and forwards the fetched bytes as inline media. | Require exact deployment/site origins and a storage resource path; reject userinfo, fragments and redirects. Two synthetic unintended owner-local fetches failed before; four focused storage/positive-image cases pass after. No protected listener was contacted. |
| P1 | A zero or positive daily cap is set, but Studio generations, paid transcription or ElevenLabs AI calls dispatch without an enforceable request-cost bound. | Refuse these unpriced paid AI requests while an applicable cap is active; recheck after delayed setup and before the paid POST. Manual Studio requests use the computer cap; exact agent callers additionally use their own cap. SMS/email/social charges remain outside the AI model budget. |
| P2 | Pipeline accepts an arbitrary body.botId, or chooses the first of several project Chiefs, so a summary/AI call can use an unrelated or uncapped agent. | Resolve the unique visible project Chief on the server, preserve exact tool caller attribution, reject ambiguous links and ignore forged body/tool agent arguments. |
| P2 | The site test command changes to Node CSP tests while two existing Vitest component files remain, so CI reports three checks and omits 31 auth/brand regressions. | Run both frameworks through test:site and retain the component configuration/dependency. Actual corrected command passes three CSP checks plus 31 component tests. |

The [security receipt](evidence/origin-integration-046/feature-security-receipt.json), retained failed logs and source hashes describe exact scopes. These are synthetic proofs, not real vendor or production-data acceptance. The source merge's fix commit and final frozen delivery SHA are recorded separately after the commit exists.

Before publication: complete fresh client/shared and touched-server/feature checks, TypeScript, lint, locale/release and route/size guards; capture the actual merged screens; freeze one clean source; run exact-source CI, backend/site and Windows/Mac packaging; review current public backend compatibility, back up before any necessary deployment; audit new package hashes; stage and verify the website, downloads and feeds. Reobserve all public baselines before mutation to avoid overwriting another delivery.

Real vendor quota behavior, positive hosted API invoice attribution, physical Mac/installed desktop updater and real outbound integration actions remain separate from synthetic fixtures and package inspection. No production-data test, real recipient outreach or automatic app task PR merge is authorized by this report.

The upstream review through `2026-10-20T04:03:12Z` remains [source-qualified](origin-upstream-review.md). Concurrent 0.3.0 contains additional upstream ports; its inclusion must be compared afresh before turning earlier deferred proposals into adoption claims.
