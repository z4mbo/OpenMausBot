# OpenMausBot PR #3073 fit for Origin

**Evaluate for a small future offline import slice; do not cherry-pick the full PR. Nothing adopted or shipped.** [PR #3073](https://github.com/milind-soni/OpenMausBot/pull/3073) merged at **2026-10-18T23:22:38Z**, merge **1da83432c4b952da42225d97fcc623ba754673eb** (head 6e00d1e7b24596d55baf317f2fc908bf7fac70a5). Compared with frozen Origin **ab0cd72b4c2f004c1015adca034472241569c04b**.

All **37 changed files / 3194 additions / 169 deletions** and complete patches are retained. Full merged source blobs were hashed. Origin has 17 matching paths and lacks 20; matching paths are not feature parity. Three merged blobs (ratchet, locales, store) differ from PR head; both revisions are retained. Two raw-media source reads normalized control bytes and were corrected via exact base64-decoded GitHub content/Git-blob checks; originals remain diagnostic. No behavior conclusion uses altered bytes.

## Useful capability and what Origin already has

The pure [reader/converter](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/shared/grok-import.ts#L358) maps pasted openmaus.grok/1 and grokbot-bundle/v1 into the existing package-v2 pipeline. It carries persona/instructions, reviewed skills, paused clock routines, app requirements and optional memory, with explicit omissions. Public x.ai links expose only a card; Start from description is a weaker, clearly labeled fallback. Models, computers and credential connections are not transferred by that mapper.

Origin already has [preview](https://github.com/z4mbo/Origin/blob/ab0cd72b4c2f004c1015adca034472241569c04b/src/lib/team-import.ts#L32), [file/GitHub/library imports](https://github.com/z4mbo/Origin/blob/ab0cd72b4c2f004c1015adca034472241569c04b/src/components/TeamLibraryPanel.tsx#L368) and the [file-trust additive server boundary](https://github.com/z4mbo/Origin/blob/ab0cd72b4c2f004c1015adca034472241569c04b/server/routes/teams.ts#L287). Imported personas use current model defaults; connected apps are disabled, and the [import creates a new section rather than replacing a Chief](https://github.com/z4mbo/Origin/blob/ab0cd72b4c2f004c1015adca034472241569c04b/server/package-import.ts#L246). It does not currently have the Grok adapter or Cursor session. Project-agent integration still needs Origin workspace/project links rather than an arbitrary new legacy section.

The [Settings Import page](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/src/components/ImportSettings.tsx#L7) is useful organization, but depends on setupImportApi/shared setup-import/ImportRow modules absent from this Origin source. Its other-AI-app importer is an existing upstream dependency, not implemented by the new page. Do not advertise it in Origin before porting and verifying that closure. A [shared preview extraction](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/src/components/TeamImportDetails.tsx#L16) and an unsent finishing draft can reduce duplicated UI.

The optional [Cursor path](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/server/cursor-session.ts#L226) has useful host pinning, capped responses, token-free recipe downloads, local mode 0600 storage and admin-scoped routes. However the PR author explicitly labels the API unlisted and not live-tested; source plan-refusal text and docs/free-account wording disagree. Treat eligibility and provider compatibility as unverified. No Cursor/x.ai requests were made here.

## Source-traced adoption blockers

- **S1 — Source-traced upstream await interleaving; not runtime-reproduced and not present in frozen Origin.** Start fetchTemplate with accountA; hold /oauth/token or its response body, call signOut (or complete accountB sign-in), then releaseA. renew savesA unconditionally after awaits. pollOnce also clears pending before awaiting the response body, then saves without checking ownership again. An old completion can restore/overwrite credentials after logout or replacement.
  Required: Capture an account/session revision before the first external await and validate it before every save/delete; key credentials to the intended local owner/machine and preserve same-owner refresh. Add deferred-response/body logout/login/ABA tests with no provider calls. [Source](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/server/cursor-session.ts#L185).

- **S2 — Source-traced redaction gap in the proposed adapter; not an adopted Origin defect.** An event routine is omitted and its original prompt contains a key-shaped value. grokExportToPackage redacts only the accepted document, while leftOut.original retains the omitted text. team-import puts it into warning/setup notes and GrokFinishSetup includes it in the prepared draft. Nothing is auto-sent, but the package redaction claim does not cover all preview/draft surfaces.
  Required: Redact omission originals, warnings, source metadata and setup drafts through the same secret boundary before rendering/storing/logging. Test dropped routines/oversized skills with synthetic secrets and keep memories opt-in. [Source](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/shared/grok-import.ts#L395).

- **S3 — Origin hierarchy mismatch if transplanted unchanged.** WorkspaceA Chief is the first visible chiefOfStaff, but the import belongs to projectB. setupHelper choosesA globally. The prepared source/apps/omission text would land in the wrong Chief composer. Generic addTemplate also creates an independent new section rather than an Origin project-agent link.
  Required: Choose an authorized target workspace/project and resolve its exact Chief/role from Origin ownership. Never trust imported workspace/project/Chief IDs, alter approvals or auto-grant tools. Add wrong-workspace/viewer/member negatives and rollback/link-uniqueness checks. [Source](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/src/components/GrokFinishSetup.tsx#L13).

- **S4 — Source-traced UI stale-response risk; not browser-reproduced.** Load linkA slowly, loadB or change the Origin context, then releaseA. load has no abort/revision fence and calls the latest handOver ref, so an old answer can update the current card or open a preview in the replacement context.
  Required: Fence link/server/account/workspace/project ownership before handing over or committing a preview; cancel stale effects. Cover A/B reverse completion, unmount and context-switch cases. [Source](https://github.com/milind-soni/OpenMausBot/blob/1da83432c4b952da42225d97fcc623ba754673eb/src/components/GrokImportBox.tsx#L158).

These are concrete code-path interleavings or Origin transplant mismatches, **not runtime reproductions or shipped Origin defects**. The changed upstream tests cover happy sign-out/refresh, token confinement, parsing/limits and static UI, but do not establish Origin project ownership or provider acceptance.

## Low-chaos integration order

1. **Pure offline converter + redacted preview.** Keep package wire IDs and attribution; change human product text to Origin. Redact omitted text as well as accepted fields. Test malformed/hostile exports, authority fields, limits, skills, paused/event schedules, timezone fallback, memory choice and secret-shaped input without networking.
2. **Origin target-bound Add and finishing draft.** Explicit workspace/project/role; authoritative member checks and exact Chief resolution. Preserve sender-runs model/credential ownership, current permission/approval rules and human-approved merges. Test wrong member/project, context changes, rollback/duplicate links and unsent drafts. Use shared controls/focus/contrast tokens; inspect 375/1440 light/dark, keyboard and reduced motion.
3. **Optional public card.** Retain HTTPS x.ai allowlist/21-character IDs, max 3 same-host redirects, 20-second deadline, 2 MiB streamed cap and admin scope. Install links open preview only. Use isolated fixtures for foreign URLs/redirects/oversize/timeout/private pages; manual export still works offline.
4. **Cursor and other AI apps later.** First fix S1 and establish local-owner/session-revision isolation before any secret save. Test deferred poll/body/refresh versus logout/replacement/ABA. Review the separate missing setup-import closure. Do not introduce upstream Cloud billing or an Origin subscription fiction.

## Complete changed-file disposition

| File | Upstream status / frozen Origin path | Disposition |
| --- | --- | --- |
| docs/team-sharing.md | modified; Origin path present | Adapt user docs only after shipped Origin capability; keep provider limits honest |
| electron/package-link.mjs | modified; Origin path present | Bounded link-parser candidate; no automatic import or new protocol ownership |
| electron/package-link.node-test.mjs | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| scripts/testing/file-size-ratchet.test.ts | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| server/cursor-session.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| server/cursor-session.ts | added; Origin path absent | Defer external session implementation pendingS1/account isolation/provider evidence |
| server/fixtures/grok-share-page-anonymous.html | added; Origin path absent | Public HTML parser fixture only; untrusted data, never execute |
| server/fixtures/grok-share-page.html | added; Origin path absent | Public HTML parser fixture only; untrusted data, never execute |
| server/request-auth.test.ts | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| server/routes/team-library-grok.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| server/routes/teams.ts | modified; Origin path present | Optional allowlisted card fetch; retain admin scope and Origin target authority |
| server/team-library.test.ts | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| server/team-library.ts | modified; Origin path present | Optional allowlisted card fetch; retain admin scope and Origin target authority |
| shared/grok-import.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| shared/grok-import.ts | added; Origin path absent | Priority selective pure-adapter candidate afterS2 redaction |
| src/components/GrokBotMark.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/GrokBotMark.tsx | added; Origin path absent | Provider-brand asset/reference; preserve legal attribution, do not globally rename vendors |
| src/components/GrokFinishSetup.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/GrokFinishSetup.tsx | added; Origin path absent | Adapt only with exact Origin Chief resolution and redacted unsent draft |
| src/components/GrokImportBox.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/GrokImportBox.tsx | added; Origin path absent | Adapt shared UI with Origin ownership/async fences and shared style tokens |
| src/components/GrokImportFlow.tsx | added; Origin path absent | Adapt shared UI with Origin ownership/async fences and shared style tokens |
| src/components/ImportSettings.test.ts | added; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/ImportSettings.tsx | added; Origin path absent | Dependency-aware UI candidate; Origin lacks referenced setup-import/onboarding modules |
| src/components/ProviderIcons.tsx | modified; Origin path present | Provider-brand asset/reference; preserve legal attribution, do not globally rename vendors |
| src/components/SettingsModal.groups.test.ts | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/SettingsModal.simple.test.ts | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/SettingsModal.tsx | modified; Origin path present | Adapt only the exact Import tab/localization wiring after capability exists |
| src/components/TeamImportDetails.tsx | added; Origin path absent | Existing-preview extraction/adapter; preserve backups/teams behavior and targeted permissions |
| src/components/TeamLibraryPanel.tsx | modified; Origin path present | Existing-preview extraction/adapter; preserve backups/teams behavior and targeted permissions |
| src/components/onboarding/beats/ImportBeat.test.ts | modified; Origin path absent | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/components/onboarding/beats/ImportBeat.tsx | modified; Origin path absent | Dependency-aware UI candidate; Origin lacks referenced setup-import/onboarding modules |
| src/lib/team-import.test.ts | modified; Origin path present | Static test coverage/reference; adapt relevant regressions, not a claim of Origin execution |
| src/lib/team-import.ts | modified; Origin path present | Existing-preview extraction/adapter; preserve backups/teams behavior and targeted permissions |
| src/lib/template-add.ts | added; Origin path absent | Reuse idea only; project-agent linking must use Origin ownership |
| src/locales/en.json | modified; Origin path present | Adapt only the exact Import tab/localization wiring after capability exists |
| src/state/store.tsx | modified; Origin path present | Adapt only the exact Import tab/localization wiring after capability exists |

## Evidence and limits

Raw detail/files/diff, 37 merged source copies, per-file patches, selected Origin blobs, path-presence proof and static test inventory are private evidence alongside this report. The raw PR response hash is **5a8546582a17d39e943b50af0c8c482202a60f616d1a2c901645705728b3016d**; files response **2d23c5f02ddaab1cf942f686d0bcffb2200755897850ade86069e697970060ca**; full PR diff **57542e6cee35ed9c305a8b8982dc848765de9bc1b0be38ea442ddfc79701554c**. The final evidence manifest supplies every retained file hash.

Static inventory includes 15 changed test files and 145 descriptive blocks across their complete contents, including pre-existing tests. These are not new-case or pass counts. The author's reported 41 files/371 tests were not rerun here. No upstream application code or tests were imported/executed, and no root/tracked source edits, CI action, provider-account/OAuth test, commit/push or deployment occurred. The current 0.2.14 source and delivery remain unchanged.
