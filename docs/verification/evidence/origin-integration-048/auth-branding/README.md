# Auth/egress interoperability review and Origin branding

This archive records a finite static review of the locally available 0.4.0 source and three visible branding corrections made during the root-owned integration. It qualifies **four targeted test files only**, with 112 passing tests and four existing platform skips. It is not full-suite, installed desktop, physical Mac, browser screenshot, real-provider or production acceptance.

- [REVIEW.md](REVIEW.md): reviewed auth/dev-session, browser egress, CLI and hosted-sidecar boundaries; proven visible scenarios; compatibility identifiers retained.
- [red.log](red.log): four expectation failures before the source string corrections (two pairing branches, actual local SOCKS refusal notice, returned companion control page).
- [green.log](green.log): four complete targeted files passed after correction.
- [lint.log](lint.log): focused six-file oxlint, exit 0 with no diagnostics. A separate focused git diff check passed.
- [source-receipt.json](source-receipt.json): original evidence and six source file fingerprints captured before the integration commit. It is not an immutable release receipt.
- [manifest.json](manifest.json): archive hashes and original ignored input hashes. Checkout paths in logs are sanitized; no credentials or owner app data were used.

The green command used portable Node 24.21.0 with its directory prepended to this command's PATH:

```powershell
node node_modules/vitest/vitest.mjs run server/cli.test.ts server/browser/egress/registry.test.ts server/browser/egress/policy.test.ts companion/test/control.test.ts --reporter=dot
```

The red run selected the existing CLI, refusal-notice and control-page cases using the pattern `gives an Android|gives everyone else|turns a session|serves the page itself` before changing the production strings. These tests use synthetic state, ephemeral local listeners and controlled fake services. Protected ports 3210/3211/5199/8799 were not used as listeners; 8799 appears as a refused test destination.

The visible changes rename pairing instructions to Origin, blocked own-service notices to Origin, and the companion title/main/forbidden headings to Origin Companion. Legacy schemes, MCP names, environment/data compatibility fields, transport token headers, fixture markers, external provider URLs and legal attribution are retained. The source review found no new auth/hosted-confinement regression in its finite scope; it does not clear all security properties. The pre-existing service-loopback open risk is explicitly retained in the review.

No source staging/commit, version edit, global TypeScript run, native audit, workflow dispatch or external delivery action was performed by this lane. Root owns the final integrated source, complete test gates, commits and publication.
