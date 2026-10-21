# Origin

Projects, people and local AI agents in one desktop workspace.

Origin combines project management with the local agent runtime from [OpenMausBot](https://github.com/milind-soni/OpenMausBot). A workspace has a head Chief; each project has its own Chief and a team of agents. People plan the work, agents work in the repository, and a person decides when to merge.

[Website and downloads](https://origin.imbored.fun) · [Source](https://github.com/z4mbo/Origin) · [Verification guide](docs/verification/README.md)

## How it fits together

- **Workspaces and projects:** Origin accounts, invitations, project access, issues, members and agent context live in the Convex backend.
- **Local agents:** the Electron app runs a Node server and the coding engines on the machine doing the work. Model execution and provider credentials use that machine.
- **Shared conversations:** the sender runs a turn on their own machine by default. Members can explicitly choose a supported teammate model source when its owner grants access. Leases and a queue coordinate shared agents across members and computers.
- **Issues and pull requests:** Draft issues stay private to Origin. Other issues can mirror to GitHub; the project Chief reviews the pull request, and merging requires a person's approval.
- **Team tools:** project chat, mentions, notifications, calls, client-encrypted vault entries, assets, feedback and search. Studio brings together media generation, workflows, presets and the Design canvas. Publish prepares and schedules approved posts and campaigns with explicitly chosen channel accounts.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | React desktop client and shared UI controls |
| `server/` | Local HTTP server, engine drivers, approvals, tools and GitHub integration |
| `shared/` | Client/server contracts, release history and shared visual tokens |
| `electron/` | Desktop shell, preload bridge, packaged server and updater |
| `backend/convex/` | Account, membership, project, issue and shared-agent data |
| `site/` | Next.js landing, account and invitation pages |
| `docs/verification/` | Isolated fixture recipes and their evidence |
| `scripts/` | Development controls, checks, build and packaging tools |

## 0.7.5 integration candidate

This candidate combines the published 0.7.1 Studio, Publish and project navigation with shared conversations, model fallback, daily API budgets, teammate model sources and the audit fixes. It also fixes a conversation-loading race that could leave the composer locked. The [verification report](docs/verification/origin-candidate-053.md) records the reproduced bug, local recovery checks and pending delivery; a candidate version is not a published download. The current public version last observed on October 21 is [0.7.1](https://github.com/z4mbo/Origin/releases/tag/origin-v0.7.1).

The earlier [0.4.2 verification and hold](docs/verification/origin-0.4.2-verification-and-release-hold.md) remains historical evidence, with its packages unpublished. Its shared-agent identity preservation, synchronized project order, specialist thread navigation, compact Usage and project budget boundaries are carried into the newer product. The integration preserves 0.7.1's removal of Sales and the older project sections. GitHub, the website, update feeds and backend are verified separately before delivery.

Model backups are opt-in and follow up to five exact account/model choices. Only a provider-confirmed quota refusal can trigger quota fallback; unavailable Usage meters, sign-in failures and ordinary rate limits cannot. Origin automatically sends the original request again only when no reply, reasoning or tool action began and the first attempt has stopped. After partial work, switching models leaves the existing work for a person to continue. Paid API backups require their own permission.

Daily API limits apply to this computer's local spending ledger, with an optional limit for each agent and a configured daily reset time zone. Supported bounded API requests reserve funds before every provider request, including later tool rounds and helper calls. Unknown costs retain their reservation. When a cap applies, unpriced or unsupported API routes are refused; confirmed subscription turns are separate from API spending. This is not a provider invoice or an account-wide budget across several computers.

These limits cover AI model API spending. Unpriced Studio generations, paid transcription and ElevenLabs AI calls stop while an applicable cap is active. Manual Studio work checks this computer's cap; agent work also checks that agent's cap. SMS, email and social service charges are outside this model budget.

Teammate model sources are available in this candidate through explicit owner grants, disabled by default. A selected online source executes on its owner's computer with that computer's provider credentials, project folder, approval policy and applicable API budget. Only eligible confined runtimes can be shared. Sender-runs remains the default, and an unavailable or uncertain accepted request is not silently rerouted into another account. The isolated native evidence covers direct execution, local/remote quota transfers, offline-source skipping, partial-output refusal, Stop, revocation and pre-dispatch budget refusal. Repository fake providers establish these paths; real CLI/OS isolation, a third physical host, positive hosted API invoice accounting and unknown owner-crash recovery remain separate limits. See the [hosting acceptance boundary](docs/verification/origin-candidate-045.md#opt-in-teammate-model-hosting).

## Local development

Use Node.js 24 or newer and pnpm 10.33.0. From this checkout:

```powershell
pnpm install --frozen-lockfile
pnpm dev:server
# In another terminal:
pnpm dev
```

The normal app uses ports 8799 and 5199. When another developer or agent is using those servers, keep them running and use a separate worktree with an isolated fixture instead:

```powershell
node --experimental-strip-types scripts/control-omb.ts launch
```

The launcher prints a disposable server URL, temporary home and persistent log path. Pass that exact URL to every control command. Stop its foreground launcher with Ctrl+C when finished. Follow [the verification guide](docs/verification/README.md) before claiming a server or conversation workflow works; never verify mutations against a person's real workspace.

The account backend and website are separate workspace packages:

```powershell
pnpm dev:backend
pnpm dev:site
```

Configure local backend URLs using [the backend development notes](docs/origin-cloud-dev.md) and [site instructions](site/README.md). Starting `convex dev` pushes functions to its selected deployment, so check that it is the intended local development deployment first. Backend unit tests use disposable `convex-test` databases and need no running backend.

## Workspace invitations

Workspace owners and admins can create a shareable link or enter an email address in Members. The hosted Origin backend uses `https://origin.imbored.fun/join/<token>`; a self-hosted backend needs its own public HTTPS invitation website through `ORIGIN_SITE_URL` or `ORIGIN_PUBLIC_URL`. Invitation links stay bound to their issuing backend.

Email is sent centrally by the backend using a verified `INVITE_FROM_EMAIL` sender. The default provider is Resend with `RESEND_API_KEY`. To use Brevo, set `ORIGIN_INVITE_MAIL_PROVIDER=brevo` and `BREVO_API_KEY`; the sender can be `invites@your-domain.example` or `Origin <invites@your-domain.example>`. Follow Brevo's [domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC) and [transactional activation](https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP) requirements before enabling email. Configure secrets through the deployment's protected environment, never on each desktop or in chat.

A missing configuration or provider failure leaves the invitation available for manual sharing. Each attempt uses only the selected provider, without an automatic retry or fallback that could send duplicate messages. Provider acceptance does not establish inbox delivery. Each creator can issue 20 invitations per hour across workspaces.

The free Brevo account now has completed phone and email verification. After explicit activation approval, all four DNS records were published while preserving the nine existing website A records. Brevo confirms origin.imbored.fun is authenticated and Origin <invites@origin.imbored.fun> is a verified sender. The standard account API key is active until 2027-10-18 and is configured only in the Origin backend. The temporary operator copy was removed at `2026-10-18T17:05:50.379Z`, with its absence confirmed after activation. Backend email configuration was confirmed at `2026-10-18T17:05:26.745Z` for the approved Brevo provider and `Origin <invites@origin.imbored.fun>` sender. The same configured key passed account API authorization and transactional relay readiness at `2026-10-18T17:05:24.487Z`. No recipient email was sent; provider acceptance, mailbox confirmation and inbox delivery remain unverified. Manual invitation sharing remains available if an email attempt fails. See the [sanitized provider setup record](docs/verification/evidence/origin-mail-provider-031.json).

Obsolete `teams:sendInvite` and `members:sendInvite` email actions reject with a migration message. Their bare legacy invitation mutations and existing membership rows remain compatible; new email invitations use `workspaces:sendEmailInvite` and `/join/<token>`.

## Checks

```powershell
pnpm exec tsc -b
pnpm exec tsc -p tsconfig.server.json
pnpm exec vitest run src shared
pnpm test:backend
pnpm test:site
pnpm lint
pnpm check:contrast
```

Run the touched server tests and the appropriate browser fixture as well. Unit tests, synthetic browser checks, packaged desktop smoke tests and a published release prove different things; record each result and any missing coverage.

## Releases and upstream changes

The app's release history lives in `shared/origin-releases.ts`; every desktop version needs a matching entry for What's new. Keep the website, updater notes and platform artifacts aligned with that history.

The [0.2.15 delivery record](docs/verification/evidence/origin-delivery-040/final-audit-report.md) confirms publication on 2026-10-19 for [GitHub](https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.15), the website, Windows x64, Mac Apple silicon and Mac Intel downloads, and matching update feeds. Its [Usage correction](docs/verification/origin-plan-usage.md) separates unavailable subscription quotas from working model authentication, excludes API/managed accounts from personal subscription reads, and retains valid Grok billing data when its credits endpoint refuses access. The [delivery receipt](docs/verification/evidence/origin-delivery-040/delivery-receipt.json) records source, public hashes, package inspection and the isolated Windows resource smoke; Mac acceptance is static, with physical installation and real-provider checks still separate.

Previous version [0.2.14](https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.14) and its four account/server-session and shared-agent ownership notes remain preserved. Its [delivery receipt](docs/verification/evidence/origin-delivery-038/delivery-receipt.json) and [audit report](docs/verification/evidence/origin-delivery-038/final-audit-report.md) retain the initial Windows CI timeout and successful targeted retry; its cause remains unproved. Sidebar icons stay on one row. See [selective upstream additions](docs/verification/evidence/origin-delivery-038/upstream-recommendations.md) for exported-bot import and limit-reset continuation proposals. Installed GUI, physical Mac/hardware and real-recipient email acceptance remain open. The continuing inspection and daily 06:00 Europe/Rome upstream review remain active.

Previous version [0.2.13](https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.13) remains preserved with its original versioned artifacts, eleven release notes, [delivery and acceptance limits](docs/verification/origin-delivery.md#0213-delivery), [permanent receipt](docs/verification/evidence/origin-delivery-035/delivery-receipt.json) and [audit report with fixes, screenshots and upstream recommendations](docs/verification/evidence/origin-delivery-035/final-audit-report.md).

The [real isolated-backend follow-up](docs/verification/evidence/origin-native-039/report.md) passes 14 API scenario groups and 10 browser journeys for authentication, invitations, scoped access, real subscriptions, persisted edits, sender queues, restart recovery and revocation. No new application bug was found. Its temporary services are stopped; production and the published runtime are unchanged. Full-App synchronization, installed-device and real-recipient acceptance remain separate.

The published [0.2.13 integration batch](docs/verification/origin-candidate-034.md) combines stable issue dragging, conversation-save protection, Origin branding and server updates, personal-key Live calls, one-row footer icons, bounded engine discovery and readable server controls with the held signup/logging fixes. Local acceptance passes 5,992 client/shared cases, both TypeScript checks, lint, locales and release guards. The first 0.2.13 CI found seven stale copy/catalog assertions and a case-sensitive legacy computer-descriptor regression. The [verified follow-up](docs/verification/origin-ci-followup-034.md) corrects them while preserving authority and wire checks; its six affected files pass 104 cases, with five platform skips. Final exact-source CI passed 23 jobs with one intended deployment skip; all twelve main test shards passed. Matching native builds, public payload hashes, update feeds and website are verified. The deployed backend is reused with unchanged functions and dependencies. The earlier [0.2.12 candidate](docs/verification/origin-candidate-033.md) and initial failed 0.2.13 artifacts remain held. Full-feature, installed-app, physical Mac and real-recipient email acceptance retain their stated limits.

The [0.2.10 record](docs/verification/origin-candidate-030.md) retains its source, checks and Activity correction. Candidates [0.2.8](docs/verification/origin-invitations.md) and [0.2.9](docs/verification/origin-candidate-029.md) remain unpublished and immutable; the successful 0.2.9 CI did not waive its reproduced Activity defect. Historical 0.2.7 delivery retains its original receipt.

The [0.2.11 record](docs/verification/origin-candidate-031.md) covers Draft-first boards and task defaults, empty local workspace cleanup, the account/computer layout and consistent flat controls. Its source, isolated browser results, actual downloaded Windows resource smoke and public delivery retain separate evidence. Windows packages are unsigned; Mac packages are ad hoc signed and unnotarized, with manual Mac updates and interactive platform acceptance still separate.

The **Origin desktop** GitHub workflow builds macOS Apple silicon, macOS Intel and Windows x64 artifacts without publishing. Local packaging commands are `pnpm package:mac` and `pnpm package:win` on their respective platforms. Download-host publication is a separate operation; building artifacts or opening a PR does not update installed apps. Unsigned/ad-hoc builds have platform-specific installation and updater limits documented in the workflow.

Review new merged OpenMausBot PRs for fixes and functionality that fit Origin. Compare the code first, retain attribution, add Origin-specific regression coverage, and avoid importing upstream branding, service credentials or release settings blindly. Keep each logical change in its own commit and document verification in the PR.

The [additional upstream review](docs/verification/origin-upstream-fit-034.md) records thirty more PRs, their fit and adoption requirements, alongside the previous forty-six scoped reviews. It includes useful automation, recovery, model-discovery and widget ideas, with a selective integration workflow that preserves Origin's permissions and human-approved merges.

## Contributing and licensing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Origin preserves the upstream [Apache-2.0 license](LICENSE) and [NOTICE](NOTICE); separately licensed directories retain their own terms. See [LICENSING.md](LICENSING.md).
