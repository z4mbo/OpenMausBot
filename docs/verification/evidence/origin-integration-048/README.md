# Origin 0.4.1 integration evidence

This finite batch combines published 0.4.0 with the independently verified shared-thread, model fallback, hosted-provider, daily-budget and access corrections. The [candidate report](../../origin-candidate-048.md) lists concrete scenarios, severity, fix commits, release gates, upstream reconciliation and proposed next features. The final source is the commit containing this archive; no self-referential source hash is invented.

- [Global local checks and observed 0.4.0 baseline](global/README.md): 609 client/shared files and 6,275 tests; eight successful check groups with exact source qualification.
- [Backend access/accounting and dual-parent schema proof](backend/README.md): 293 full backend passes, 37 final focused passes and 45 call/Pipeline/host passes; candidate 75-table schema preserves both parents.
- [Auth, companion, egress and visible branding](auth-branding/README.md): bounded static security review and 112 passes with four existing platform skips.
- [Actual UI inspection](ui/README.md): 20 captures, source bindings, responsive measurements and focused regression proof. Synthetic query data and blocked writes are explicit.
- [Previous CI failures and delegation correction](ci/README.md): failed old workflow is retained as failed; canonical and explicit-fresh work receive separate real fixture coverage.
- [Fixture lifecycle and bind isolation](ci-lifecycle/README.md): deterministic active-work refusal, authoritative idle, bounded collision handling, exact server TypeScript and platform limits.

The root manifest binds every retained payload except itself. Nested manifests retain their original producer boundaries; the root manifest also binds their README files and manifests. Production data was not used for tests. Download, native package, deployment, physical Mac, live provider, recipient email and persisted-account acceptance remain separate gates, and are not implied by a local green check.
