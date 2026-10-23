# Finite 0.4 integration review and visible branding corrections

Reviewed the locally available `origin-v0.4.0` source at `1a5ce4e975af376e43c32a75110756bfb80105eb` against proposed candidate source `5aafbf02ab2ded075d2c75955419f35a45cce99a` and the root-owned in-progress merge. This is a finite source review, not a full security audit or current release qualification. Root owns conflict resolution, final source freeze, complete checks and publication. No conflicting file was edited by this lane.

## Auth, fixtures and hosted execution

No new security or compatibility regression was proven in the reviewed paths:

- `server/request-auth.ts` now distinguishes browser fetch metadata/WebSocket origins from Node clients. The local-browser exception requires explicit development configuration, TypeScript source, owner trust and a non-desktop process. It is rejected for bundled/packaged/service operation. The existing invalid-session precedence and cookie same-origin checks remain.
- `server/dev-server.ts` opts source development into that exception. `scripts/control-omb.ts` explicitly opts isolated UI fixtures in unless the caller requests `OMB_DEV_TRUST_LOCAL_BROWSER=0`. The same merged file retains the fake-only model-host profile, private fixture-token and synthetic account setup needed by shared-hosting verification. Node-based fixture API calls are not misclassified as browsers by a Sec-Fetch-Mode header alone.
- `server/cli.ts` now prints a localhost sign-in link for the caller's own computer; `server/cli-pairing.ts` preserves its one-time pairing code and phone link behavior. No Origin invitation URL is derived from these local machine-pairing links.
- `electron/server-session.mjs` moves the desktop owner header into the single default-session hook and covers HTTP and WebSocket requests. Non-default viewer sessions receive their separate local-server blocker. The private utility-process owner-token handoff is preserved. This review does not establish behavior of redirect header retention in a real Chromium instance.
- The Origin hosted sidecar retains private Ask-mode tasks, exact provider/thread event matching, isolated surface selection, before-dispatch admission, and local cleanup. `server/hosted-turn-policy.ts` retains the default-deny internal allowlist limited to options cards and tool results. The central internal-capability gate in `server/index.ts` still applies that allowlist to hosted threads before internal tool dispatch; it prevents `coordinate-bots` and newly added private/integration tools from being reached by those guests. The Cloud-only delegation ancestry helper therefore does not itself enable a hosted requester to delegate an unconstrained turn.
- Browser egress resolves addresses at the SOCKS gate and connects only using checked results, blocks metadata/own listeners, retains explicit self-hosted allowlists, and reports refusals. The listener-owner implementation intentionally grants bot-process ownership only on Linux; tests and fixtures that need other loopback destinations must opt into their own explicit fake/local allowance. Configured attached personal Chrome remains outside the launched-browser proxy path; this review does not claim that every browser attachment authorization path has been exercised.

The pre-existing documented service-loopback allowance still carries the open risk described beside `SERVICE_ALLOW`: local bot shells can use the allowed Slack/service routes. The new browser distinction does not claim to isolate arbitrary local Node/shell clients. No broad relaxation or change to that policy was made here.

## Confirmed visible branding fixes

| Scenario | Before | After | Files |
| --- | --- | --- | --- |
| Printing Android and browser/phone pairing help | Instructions named the OpenMausBot app | Instructions name the Origin app | `server/cli-pairing.ts`, existing CLI link/QR tests |
| A real SOCKS browser request is refused for an own service | Page-health notice says OpenMausBot's own service | Notice says Origin's own service | `server/browser/egress/policy.ts`, existing registry refusal test |
| Opening the companion control page, including its newly added forbidden-token fallback | Page title/main/fallback headings say OpenMausBot Companion | All say Origin Companion | `companion/src/control.ts`, existing real HTTP control-page test |

The bounded scan covered 163 existing source paths changed between 0.3.0 and 0.4.0 and inspected added visible strings in the relevant diff. It did not attempt an unrestricted rewrite. Protocol schemes, MCP identifiers, environment/data compatibility names, token headers, fixture markers, external provider URLs and license attribution were retained.

## Evidence

- `red.log`: four actual expectation failures before the source corrections (both CLI branches, real SOCKS refusal notice and real companion HTTP page); 62 other tests deselected.
- `green.log`: **112 passed, 4 existing platform skips across 4 files**: `server/cli.test.ts`, `server/browser/egress/registry.test.ts`, `server/browser/egress/policy.test.ts`, `companion/test/control.test.ts`.
- `lint.log`: focused six-file oxlint with `--deny-warnings`, exit 0 and no diagnostics. `git diff --check` also passed for those files.
- The tests use synthetic state, ephemeral local ports and controlled fake services. No owner app data, protected 3210/3211/5199/8799 listener, real provider, external account or production mutation was used.

No stage, commit, push, version edit, global TypeScript check, full acceptance-suite rerun, native artifact audit or publication was performed by this lane. The auth/hosted/egress review above is static. Branding evidence covers returned help/HTTP text and real local refusal behavior; no screenshot, installed Electron or physical Mac acceptance is claimed.
