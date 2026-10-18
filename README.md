# Origin

Projects, people and local AI agents in one desktop workspace.

Origin combines project management with the local agent runtime from [OpenMausBot](https://github.com/milind-soni/OpenMausBot). A workspace has a head Chief; each project has its own Chief and a team of agents. People plan the work, agents work in the repository, and a person decides when to merge.

[Website and downloads](https://origin.imbored.fun) · [Source](https://github.com/z4mbo/Origin) · [Verification guide](docs/verification/README.md)

## How it fits together

- **Workspaces and projects:** Origin accounts, invitations, project access, issues, members and agent context live in the Convex backend.
- **Local agents:** the Electron app runs a Node server and the coding engines on the machine doing the work. Model execution and provider credentials use that machine.
- **Shared conversations:** the sender runs a turn on their own machine. Leases and a queue coordinate shared agents across members and computers.
- **Issues and pull requests:** Draft issues stay private to Origin. Other issues can mirror to GitHub; the project Chief reviews the pull request, and merging requires a person's approval.
- **Team tools:** project chat, mentions, notifications, calls, drawing, client-encrypted vault entries, assets, feedback and search.

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

Version [0.2.13](https://github.com/z4mbo/Origin/releases/tag/origin-v0.2.13) is published for [Windows x64](https://origin.imbored.fun/downloads/Origin-Setup.exe), [Mac Apple silicon](https://origin.imbored.fun/downloads/Origin-Mac-AppleSilicon.dmg) and [Mac Intel](https://origin.imbored.fun/downloads/Origin-Mac-Intel.dmg). The [website](https://origin.imbored.fun) and [What's new](https://origin.imbored.fun/whats-new) match its eleven current release notes. See the [verified delivery and acceptance limits](docs/verification/origin-delivery.md#0213-delivery), [permanent receipt](docs/verification/evidence/origin-delivery-035/delivery-receipt.json) and [audit report with fixes, screenshots and upstream recommendations](docs/verification/evidence/origin-delivery-035/final-audit-report.md).

The published [0.2.13 integration batch](docs/verification/origin-candidate-034.md) combines stable issue dragging, conversation-save protection, Origin branding and server updates, personal-key Live calls, one-row footer icons, bounded engine discovery and readable server controls with the held signup/logging fixes. Local acceptance passes 5,992 client/shared cases, both TypeScript checks, lint, locales and release guards. The first 0.2.13 CI found seven stale copy/catalog assertions and a case-sensitive legacy computer-descriptor regression. The [verified follow-up](docs/verification/origin-ci-followup-034.md) corrects them while preserving authority and wire checks; its six affected files pass 104 cases, with five platform skips. Final exact-source CI passed 23 jobs with one intended deployment skip; all twelve main test shards passed. Matching native builds, public payload hashes, update feeds and website are verified. The deployed backend is reused with unchanged functions and dependencies. The earlier [0.2.12 candidate](docs/verification/origin-candidate-033.md) and initial failed 0.2.13 artifacts remain held. Full-feature, installed-app, physical Mac and real-recipient email acceptance retain their stated limits.

The [0.2.10 record](docs/verification/origin-candidate-030.md) retains its source, checks and Activity correction. Candidates [0.2.8](docs/verification/origin-invitations.md) and [0.2.9](docs/verification/origin-candidate-029.md) remain unpublished and immutable; the successful 0.2.9 CI did not waive its reproduced Activity defect. Historical 0.2.7 delivery retains its original receipt.

The [0.2.11 record](docs/verification/origin-candidate-031.md) covers Draft-first boards and task defaults, empty local workspace cleanup, the account/computer layout and consistent flat controls. Its source, isolated browser results, actual downloaded Windows resource smoke and public delivery retain separate evidence. Windows packages are unsigned; Mac packages are ad hoc signed and unnotarized, with manual Mac updates and interactive platform acceptance still separate.

The **Origin desktop** GitHub workflow builds macOS Apple silicon, macOS Intel and Windows x64 artifacts without publishing. Local packaging commands are `pnpm package:mac` and `pnpm package:win` on their respective platforms. Download-host publication is a separate operation; building artifacts or opening a PR does not update installed apps. Unsigned/ad-hoc builds have platform-specific installation and updater limits documented in the workflow.

Review new merged OpenMausBot PRs for fixes and functionality that fit Origin. Compare the code first, retain attribution, add Origin-specific regression coverage, and avoid importing upstream branding, service credentials or release settings blindly. Keep each logical change in its own commit and document verification in the PR.

The [additional upstream review](docs/verification/origin-upstream-fit-034.md) records thirty more PRs, their fit and adoption requirements, alongside the previous forty-six scoped reviews. It includes useful automation, recovery, model-discovery and widget ideas, with a selective integration workflow that preserves Origin's permissions and human-approved merges.

## Contributing and licensing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Origin preserves the upstream [Apache-2.0 license](LICENSE) and [NOTICE](NOTICE); separately licensed directories retain their own terms. See [LICENSING.md](LICENSING.md).
