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

The **Origin desktop** GitHub workflow builds macOS Apple silicon, macOS Intel and Windows x64 artifacts without publishing. Local packaging commands are `pnpm package:mac` and `pnpm package:win` on their respective platforms. Download-host publication is a separate operation; building artifacts or opening a PR does not update installed apps. Unsigned/ad-hoc builds have platform-specific installation and updater limits documented in the workflow.

Review new merged OpenMausBot PRs for fixes and functionality that fit Origin. Compare the code first, retain attribution, add Origin-specific regression coverage, and avoid importing upstream branding, service credentials or release settings blindly. Keep each logical change in its own commit and document verification in the PR.

## Contributing and licensing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Origin preserves the upstream [Apache-2.0 license](LICENSE) and [NOTICE](NOTICE); separately licensed directories retain their own terms. See [LICENSING.md](LICENSING.md).
