# Testing

Fast checks do not need a production connection:

```sh
npx tsc --noEmit
npx vitest run
node scripts/test-plugin-package.mjs
npx tsx scripts/test-document-sync.ts
npx tsx scripts/test-chat-composer.ts
npx tsx scripts/test-github-sync.ts
npx tsx scripts/test-call-signaling.ts
npx tsx scripts/test-dropped-content.ts
npx tsx scripts/test-file-drop.ts
npx tsx scripts/test-asset-uploads.ts
npm run build
```

The Convex unit suite uses in-memory synthetic data. It covers project membership, viewer restrictions, invitation links, removal/revocation, inactive projects and legacy states, inline comment references, mentions, attachments, collaborative checklists, preserved drawing data, MCP idempotency and GitHub closure ordering. It never connects to a live deployment.

Integration tests use a separate local Convex backend at `http://127.0.0.1:3210`, its HTTP endpoint at port 3211, and a local Origin server. They intentionally refuse non-localhost service URLs. Never copy production data into the fixtures.

`scripts/test-workspace.mjs` creates synthetic users, a workspace, projects, and `/tmp/origin-qa-session.json`. This temporary file contains test credentials; do not publish it. Set `TEST_CONVEX_URL` and `TEST_ORIGIN_URL` for your isolated environment before running the fixture.

Some integration suites read `/tmp/origin-integration-qa.env`. Supply the local Convex URLs, local Origin URL, test data directory, and a test-only `ORIGIN_INTEGRATION_SECRET` matching the isolated backend. Do not reuse a production secret. `scripts/test-features.mjs` covers collaborative documents, search, milestones, releases, public-feedback boundaries, and viewer/workspace authorization.

`scripts/test-github-lifecycle.mjs` covers real backend approval permissions, closure/reopen ordering, stale events, counters, and linked-issue badges. `scripts/test-project-fixes.mjs` also needs the isolated Origin server at port 3002; it covers local issue attachments, workspace isolation, viewer permissions, call-session renewal, and rejection of late signaling from previous sessions.

`node scripts/test-mcp-workflow.mjs` exercises the actual local MCP HTTP endpoint, OAuth with PKCE, scoped member listing, inbox, issue creation/completion/deletion, idempotent retries, and token revocation. It creates and deletes only a synthetic issue in the local fixture.

`node scripts/test-mcp-security.mjs` uses the official MCP SDK against that same isolated environment. It invokes all 11 tools, including project creation/update and both inbox views, and tests read-only discovery, forbidden writes, cross-workspace isolation, invalid assignees, duplicate requests, OAuth denial, invalid PKCE/resource/redirect, single-use codes, refresh rotation/replay, untrusted origins and revocation. It leaves only a synthetic empty project in the local fixture and revokes its test grants. It does not use paid model APIs or production credentials.

`node scripts/test-plugin-package.mjs` checks portable manifests, parity with the existing Codex compatibility files, all three starter prompts, workflow safeguards and an explicit archive-file allowlist. Inspect all new files before extending that allowlist. Archive creation and private plugin creation are not proof of public publication or a completed ChatGPT conversation. Test the installed plugin in each intended client before submitting it to the public directory.

Browser QA should include fresh signup, desktop/mobile layouts, project feedback, chat mentions and attachments, and image previews in issues. Test a two-client call with simultaneous joining, screen sharing, camera toggling, and a full page refresh followed by rejoining while the other client stays connected. Also check GitHub issue closure sync and MCP authorization/revocation. Use synthetic media for automated call checks, then test physical devices across separate networks before claiming broad network coverage. A successful build is not a substitute for these checks.
