# Installer credential boundary follow-up

This is an isolated, unpublished follow-up to source `697e9f0adacd7d90af9b3f190ab5c4df978b48f1` (Origin 0.2.11). The existing 69-row audit register was reviewed first and remains unchanged. The nine inspected installer/authentication modules matched that frozen source before this change.

## Proven finding

**P1, conditional on noncanonical Windows environment names:** `server/config.ts:972` removed workspace credentials only when an object's key exactly matched the uppercase allowlist. Windows reads environment names without regard to case, while the object produced by spreading `process.env` retains their original spelling.

Concrete scenario: start Origin on Windows with synthetic `omb_openai_api_key` and `box_token`. The parent reads both through `process.env.OMB_OPENAI_API_KEY` and `process.env.BOX_TOKEN`. `runOfficialInstaller` copies that environment and calls `stripWorkspaceCredentialEnv`; both lowercase entries survive. The actual system PowerShell then starts a harmless Node fixture, which observes both credentials as present. No vendor script, remote request or real credential was involved.

The fix compares every environment key in uppercase against the existing exact workspace-name list. The same child now observes both credentials as absent. Uppercase, lowercase and mixed-case variants of every listed workspace name are covered; unrelated project names such as `GITHUB_TOKEN` and `MY_BOX_TOKEN` remain available. This extends the workspace-credential boundary; the already-recorded operator/control-plane credential fixes are not new findings here.

The permanent regressions are `server/config.test.ts:1852` and the existing actual-shell cases in `server/engine-script-install.test.ts:8`. Before the fix, three targeted regressions fail and one existing case passes. After the fix, six test files pass 302 cases, with nine existing platform skips. Server TypeScript, touched-file lint, the size guard and `git diff --check` pass. The [sanitized evidence](evidence/origin-installer-env-next.json) records the real child observations and log identities.

The older worker checkout's complete verification-document guard passes five cases and reports two failures, both exclusively in its untouched compatibility report: an old relative test citation and fake-protocol route citations. This follow-up does not repair that separate historical document. Its new report is reachable from the verification index and contributes no reported broken reference.

## Inspected boundaries and limits

| Path | Coverage and result |
| --- | --- |
| `server/engine-script-install.ts:20`, `:71`, `:94` | Frozen driver-keyed commands, own-property checks, absolute system shell and shared credential stripping. Request fields cannot replace the command. |
| `server/routes/engine-script-installs.ts:32`, `:80` | GET/POST/DELETE require owner/admin, a real loopback socket and no forwarding proxy. Sessions, service callers, client scope, invalid IDs and non-JSON mutations are refused. Actual isolated HTTP tests use a fake runner. |
| `server/index.ts:814`, `:13937`, `:14236` | Script installation is disabled for hosted/cloud/service contexts; the route is dispatched after authentication and the packaged desktop mutation capability. Static integration inspection of the published source, not a packaged-app acceptance claim. |
| `server/request-auth.ts:380` | Default-admin scope, same-origin cookie checks, revoked-session denial, service restrictions and desktop mutation capability. Synthetic authorization regressions pass. |
| `server/engine-install.ts:29`, `:65`, `server/harness/registry.ts:176`, `server/routes/instances.ts:146` | Adjacent npm installation derives a fixed package and argument list from the registered driver and uses the same credential boundary. Four supported adjacent tests pass; seven existing Windows skips remain. No npm registry was contacted. |
| `server/procs.ts:48`, `:105`, `server/control-plane-env.ts:13` | Spawn resolution, timeout/cancellation helpers and the existing case-insensitive operator-secret strip were inspected. No additional proven exploit was established. Detached descendants and vendor installer behavior are outside this proof. |

No production service, live workspace, local Convex process, user app port, provider account or real installer was used. The safe child qualification used its own disposable home and an explicit environment containing only Windows runtime fields plus synthetic fixture variables. The tests do not prove vendor integrity, a successful installation, every engine launch path, or packaged Windows/macOS behavior.
