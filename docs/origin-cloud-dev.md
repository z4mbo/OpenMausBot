# Origin Cloud: local development backend

Dev-only notes. Everything here runs on your machine against a local Convex
backend; nothing touches a cloud deployment.

## Backend

- Code: `backend/` in this repository (Convex functions in `backend/convex/`).
- Deployment: `local:local-ggs-origin_workspace` (`CONVEX_DEPLOYMENT` in `backend/.env.local`, gitignored).
- Client URL: `http://127.0.0.1:3210`
- HTTP actions (site) URL: `http://127.0.0.1:3211` (signed `/integrations` bridge).
- Data and config live in `backend/.convex/local/default/` (gitignored).
  The backend binary is `convex-local-backend.exe`, cached under
  `%LOCALAPPDATA%\convex\binaries\`.

The CLI attached the local deployment to the Convex team/project `ggs:origin-workspace`
because the Convex CLI on this machine is logged in. The deployment itself is
local-only; its data never leaves the machine.

### Convex environment variables (local deployment only)

| Name | Value |
| --- | --- |
| `ORIGIN_INTEGRATION_SECRET` | random 64-hex string; read it with `npx convex env get ORIGIN_INTEGRATION_SECRET`. Also in `backend/.env.local`; `site/.env.local` only needs the two `NEXT_PUBLIC_CONVEX_*` URLs. |
| `ORIGIN_PUBLIC_URL` | `http://localhost:3000` |
| `ORIGIN_SIGNUP_MODE` | unset, so sign-up is open (`invite` would make it invite-only). |
| `ORIGIN_SEALING_KEY` | 32 random bytes, base64 or 64-hex: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Seals the workspace GitHub connections and shared integration keys; without it nothing can be shared. Rotating it makes every shared connection and key unreadable until an admin shares them again. |

### Start (detached, survives closing the terminal)

PowerShell, from anywhere:

```powershell
Start-Process cmd.exe -WorkingDirectory C:\Users\aless\Documents\Origin\backend -WindowStyle Hidden `
  -ArgumentList '/c','npx convex dev --codegen disable --typecheck disable --tail-logs always > .convex\dev.log 2>&1'
```

`npx convex dev` keeps the backend running and re-pushes `convex/` on every
change. `--codegen disable` keeps `convex/_generated/` untouched (the CLI would
otherwise rewrite it with different line endings). Logs: `backend\.convex\dev.log`.

In a terminal you watch, `pnpm dev:backend` from the repository root runs `npx convex dev` in the foreground.

Check it is up: `curl http://127.0.0.1:3210/version`.

### Stop

```powershell
Get-Process convex-local-backend -ErrorAction SilentlyContinue | Stop-Process
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*convex*dev*' | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

### Reset all data

Stop the backend, delete `backend\.convex\local\default\convex_local_storage`
and `convex_local_backend.sqlite3`, start it again and re-run the seed.

## Test login

- Email: `test@origin.local`
- Password: `origin-dev-3-09r-u74mSx`
- Name: Test User

## Seed data (created through the public functions)

- Workspace **GGs** (slug `ggs`, created by `auth:signup` with `workspaceName`), owner: test user.
- Workspace **weeh** (slug `weeh`, `workspaces:create`), empty.
- In GGs, projects **Kai** and **Yuki** (`projects:create`). Each has the default
  columns Idea, Todo, In progress plus a Done column (`tasks:createColumn`, `isDone: true`).
- Issues (`tasks:createTask`, all assigned to the test user, due dates in Nov 2026):
  - Kai: Set up CI pipeline (high, Todo, has a comment), Design onboarding flow
    (medium, Idea), Fix login redirect bug (high, In progress), Write release notes (low, Done).
  - Yuki: Draft API schema (medium, Todo, has a comment), Benchmark sync engine
    (low, Idea), Ship mobile layout (high, In progress).
- Design asset on Kai: "Kai mockups", type `figma`, link-only (`design:createAsset`, no file upload).
- Feedback portal on Kai, "Kai feedback" (`feedback:configure`), with one idea entry
  "Dark mode please" submitted through the signed `/integrations` HTTP bridge
  (operation `feedback`, the same path the app server's public feedback form uses).
- Vault (credentials), GitHub pull requests and commits are empty.

## Pointing the OpenMausBot client at it

The Origin desktop app reads the URL from localStorage `origin-cloud-url`, else
`VITE_ORIGIN_CONVEX_URL`. For dev, set `VITE_ORIGIN_CONVEX_URL=http://127.0.0.1:3210`
or call `setCloudUrl("http://127.0.0.1:3210")` from `src/lib/origin-cloud`.

## GitHub integration (served by this app)

The GitHub routes live in this server
(`server/routes/github.ts`, logic in `server/github/`), on the same paths, so a
GitHub App manifest, OAuth callback and webhook point at this app:

| Path | Caller | Credential |
| --- | --- | --- |
| `GET/POST/DELETE /api/github/connection?projectId=` | Origin client | `x-origin-session` header (the person's Origin session) |
| `POST /api/github/issues`, `POST /api/github/pull-requests` | Origin client | same |
| `GET/POST /api/github/repo?projectId=[&teamId=]` | Origin client | same |
| `POST /api/github/setup?teamId=`, `POST /api/github/oauth/start?teamId=[&projectId=]` | Origin client | same; answers `{ url }`, a single-use link the client opens in the browser |
| `GET/DELETE /api/github/workspace?teamId=` | Origin client | same |
| `GET /api/github/oauth/begin`, `GET /api/github/setup/begin` | browser | single-use ticket; sets the `origin.github` state cookie |
| `GET /api/github/oauth/install`, `GET /api/github/oauth/callback`, `GET /api/github/setup/callback` | GitHub redirect | state bound to the `origin.github` cookie, PKCE |
| `POST /api/github/webhook` | GitHub | `X-Hub-Signature-256` HMAC, 1 MB body limit |
| `POST /api/integrations/tick` | Convex cron `integrations:kick` | `x-origin-signature` HMAC of `ORIGIN_INTEGRATION_SECRET`, 60 s freshness |
| `POST /api/github/share?teamId=` | Origin client (workspace owner or admin) | `x-origin-session`; hands this server's App credentials and GitHub connection to the backend, which seals them for the whole workspace |

### Workspace GitHub held by the backend

An owner or admin connects GitHub once; the server they connected on shares the
App's credentials and their GitHub connection with the backend
(`backend/convex/teamGitHub.ts`), sealed under `ORIGIN_SEALING_KEY`. From then
on a member's own server, which holds no App, connection or integration secret,
reaches GitHub through the backend's `teamGitHub:bridge` action with the
member's Origin session: the backend checks the member's project role, mints an
installation token for that one repository (read for viewers; issues, pull
requests and contents for editors; contents only for git), creates
repositories (private or public, in the connecting admin's account or an
organization the App is installed on), and reads every issue link, merge and
pull request back from GitHub before recording it. A server that holds
`ORIGIN_INTEGRATION_SECRET` keeps its own connection and also mints tokens for
shared workspaces through the signed bridge (`githubToken`, `createRepository`).
A repository a member links by hand still needs an admin's approval before the
workspace's connection works on it.

Agents get git access through a credential helper the server writes to
`<data dir>/origin-git/` and configures in each project folder; it answers
git with a contents-only token for that folder's repository, never in a prompt,
command line or remote URL. Linking a member's own GitHub uses the App's device
sign-in, so the App's settings need "Enable Device Flow".

The client routes sit behind the app's own sign-in (admin scope for paired
sessions); the browser, GitHub and Convex legs run before it and check their
own credential. Tokens, the App's credentials and OAuth states are sealed in
`<data dir>/origin-github/integrations.sqlite` with the key file next to it.

### Server environment

| Name | Meaning |
| --- | --- |
| `ORIGIN_INTEGRATION_SECRET` | Same value as the Convex deployment's. Without it ticks are refused and the bridge cannot call Convex. |
| `ORIGIN_PUBLIC_URL` | Origin GitHub and Convex reach this server at (OAuth redirect, webhook, tick). Defaults to the server's own public URL. |
| `ORIGIN_CONVEX_URL` | Convex client URL when no Origin sign-in has been shared with the server. |
| `ORIGIN_CONVEX_SITE_URL` | Convex HTTP actions URL; derived otherwise (`:3210` -> `:3211`, `.convex.cloud` -> `.convex.site`). |
| `ORIGIN_LEGACY_OWNER_EMAIL` | The one Origin account allowed to create the GitHub App. |
| `ORIGIN_GITHUB_TOKEN` | Optional fallback token for that owner's own projects (deliberately not `GITHUB_TOKEN`). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Optional: an existing App instead of the manifest setup. |

### Convex side

`integrations:kick` posts to `${ORIGIN_PUBLIC_URL}/api/integrations/tick`, so
the Convex deployment's `ORIGIN_PUBLIC_URL` must be this app's public origin
(for the local dev server, `http://127.0.0.1:8799` or whatever port it runs
on). `ORIGIN_INTEGRATION_SECRET` must match on both sides. Set it on the local
deployment only:

```powershell
cd C:\Users\aless\Documents\Origin\backend
npx convex env set ORIGIN_PUBLIC_URL http://127.0.0.1:8799
```

Convex's invite links also read `ORIGIN_PUBLIC_URL`, which is consistent now
that this app serves `/join/<token>`.

## Moving the dev deployment from origin-workspace to backend/

The local deployment's state lives next to the code that runs it, so the
`npx convex dev` still running in the old `origin-workspace` checkout keeps its
data in `origin-workspace\.convex\local\default\`. To move it:

```powershell
# 1. stop the old dev process and its backend (see Stop above)
# 2. copy its state and environment into backend/
robocopy C:\Users\aless\Documents\origin-workspace\.convex C:\Users\aless\Documents\Origin\backend\.convex /E
Copy-Item C:\Users\aless\Documents\origin-workspace\.env.local C:\Users\aless\Documents\Origin\backend\.env.local
# 3. start it from backend/ (see Start above) and check it
curl http://127.0.0.1:3210/version
```

The deployment name, ports, admin key and data stay the same, so the desktop
app, the app server and `site/` keep working unchanged. `origin-workspace`
stays on disk as an archive.

## Running the site against it

`pnpm dev:site` serves `site/` on `http://127.0.0.1:3001` with
`site/.env.local` (`NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210`,
`NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211`). `site/README.md` has the
checks.
