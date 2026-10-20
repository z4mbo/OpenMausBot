# Origin 0.3.2 correction candidate

Prepared on 2026-10-20. This continues the combined [0.3.1 candidate](origin-candidate-046.md), which remains unpublished. Its immutable tag points to `3e6f5c3b563efad735d2b4773347174f7492655e`; the sole README-link validation commit is `8fa1c8ce2f4eb5a76faade6f2541819a7f8cfd3f`. Native run 39375586128 succeeded for Windows x64 and both Mac architectures, but native packaging is not a substitute for the full server CI or actual feature-body inspection.

## Why publication is held

CI 39375851729, attempt 1, completed with failure: all eight Linux/Windows Vitest shards and the aggregate failed while the other checks passed or were intentionally skipped. The four Linux shards report 43 failed tests across ten server test files. These are assertion and isolated-fixture failures, not job timeouts. They include consultation notifications, thread coordination, validation diagnostics, fixture startup, managed desktop cleanup and replacement VM turns. Windows additionally exposed a deterministic early-SSE notification-navigation race. The failed run is retained; no retry or assertion relaxation supplies a success claim.

Actual 375 px feature-body inspection separately reproduced unreadable Broadcast connection notices, overlapping Pipeline search controls, Canvas panels covering the toggles used to close them, and outgoing actions becoming available before channel connections are confirmed. The first Pipeline preview did not initialize the real session store, so its original enabled email button represented unknown connection status rather than a confirmed disconnected provider. The corrected isolated adapter makes that distinction explicit without using real accounts or sending a request.

The finite correction batch addresses those confirmed UI and server defects, retains the earlier model continuity and integration-safety changes, and records genuine before/after browser evidence. The new canonical release has eleven notes and omits unpublished 0.3.1 from the user-facing history. All delivery operators for 0.3.1 remain unadmitted. No 0.3.1 release asset, backend key/export/deployment, private website build, public feed or site promotion has occurred.

Before freezing the replacement, complete the targeted regressions, merged UI checks, required client/shared run, TypeScript, lint and release/documentation guards. The next immutable source must include its release notes and direct verification-index links before its CI/native runs. Backend compatibility and earlier tests may be reused only with an explicit unchanged-source proof; changed behavior receives fresh verification. Publishing still requires green replacement CI, backend/site and native workflows, actual package auditing, a fresh storage-inclusive backend backup when deploying, private website acceptance and independent public URL/hash verification.

## Confirmed corrections

| Severity | Scenario and correction | Fix commit |
| --- | --- | --- |
| P2 | At 375 px, Broadcast's connection text shrank to a word-stacked column, Pipeline's search overlapped its next action, and Canvas's compact panels covered their own closing toggles. Responsive layouts preserve usable width and reserve space for the Canvas toolbar. | `73bd07518` |
| P2 | A filled Broadcast post enabled publishing with disconnected channels. Pipeline enabled non-note outreach while connection status was unknown. Both now require confirmed connections; drafts, approvals and notes retain their separate behavior. | `8a2575614` |
| P2 | Strict model-setting validation lost the actionable field/effort/unknown-field diagnostics consumed by the HTTP client. Keep strict parsing and live-catalog checks while restoring those errors. Six new checker regressions fail before and pass after; three real HTTP cases pass. | `c045a7bdd` |
| P2 | An explicitly fresh or pre-marker legacy delegated job could be mistaken for its parent's canonical child, moving later work into the wrong context. Preserve explicit-new identity while maintaining parent-to-child continuity. | `c4e278347` |
| P2 | An SSE frame arriving during a React navigation transition could restore the previous selected thread before a notification's read acknowledgement. Capture pending navigation identity synchronously and acknowledge the exact displayed thread. | `a148f39f4` |
| P2 | Every coordinated child generated a delegation-start notice, including consultations and quiet background work. Restrict the new notice to user-requested Chief work, preserving questions and exact-child deduplication. | `82d7617a8` |

The approval-clock and replacement-turn fixtures still hooked modules before their extraction; managed cleanup's fake omitted the hosted cancellation method used by the actual path. Commit `657e6b84e` restores those fixture seams without changing timeouts. Commit `ca04aa512` adapts the synthetic Codex command parser and requires system denial of guest shell requests, preserving stronger confinement. These are verification corrections, not new production failure claims. Full VM checks pass 44 cases; full Cloud checks pass 39 cases locally with one retained Windows file-symlink privilege failure (`EPERM`). The unchanged symlink-security assertion passed in the earlier Windows CI and remains required in replacement CI.

The corrected mobile screens were inspected again in the actual browser. Broadcast's notice has 309 px of text width; Pipeline's 295 px search and action row no longer overlap; both Canvas toggle centers hit their own buttons and actually close their panels. Document width remains 375 px. All previews use synthetic records, and provider calls, recipient outreach, publishing and backend mutations remain blocked.

The enabled Canvas Ask prompt does not grant write authority to viewers. Local tools recheck the current project role, Convex independently denies viewer writes, shared-thread sends require write access and hosted requests cannot reach the owner's Origin tools. Four focused existing authority checks pass. This is a scoped source/synthetic review, not a real provider or production-data test.

Real provider execution, physical Mac/installed desktop updater behavior and real recipient outreach remain separate acceptance limits. No production data is used for tests.

## Review evidence

The [correction evidence archive](evidence/origin-candidate-047/README.md) retains twelve browser captures, the before/after source and fixture bindings, red/green regressions, the sanitized eight-job failed-CI summary and the evaluated upstream reconciliation. Its per-file manifest preserves exact bytes and hashes. The screenshots are selected synthetic feature states, not a claim that every feature or external integration has passed production acceptance.
