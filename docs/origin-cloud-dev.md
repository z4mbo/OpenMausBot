# Origin Cloud: local development backend

Dev-only notes. Everything here runs on your machine against a local Convex
backend; nothing touches a cloud deployment.

## Backend

- Repo: `C:\Users\aless\Documents\origin-workspace` (Convex functions in `convex/`).
- Deployment: `local:local-ggs-origin_workspace` (written to `origin-workspace/.env.local`).
- Client URL: `http://127.0.0.1:3210`
- HTTP actions (site) URL: `http://127.0.0.1:3211` (signed `/integrations` bridge).
- Data and config live in `origin-workspace/.convex/local/default/` (gitignored).
  The backend binary is `convex-local-backend.exe`, cached under
  `%LOCALAPPDATA%\convex\binaries\`.

The CLI attached the local deployment to the Convex team/project `ggs:origin-workspace`
because the Convex CLI on this machine is logged in. The deployment itself is
local-only; its data never leaves the machine.

### Convex environment variables (local deployment only)

| Name | Value |
| --- | --- |
| `ORIGIN_INTEGRATION_SECRET` | random 64-hex string; read it with `npx convex env get ORIGIN_INTEGRATION_SECRET`. Also copied into `origin-workspace/.env.local` for the Next.js app. |
| `ORIGIN_PUBLIC_URL` | `http://localhost:3000` |
| `ORIGIN_SIGNUP_MODE` | unset, so sign-up is open (`invite` would make it invite-only). |

### Start (detached, survives closing the terminal)

PowerShell, from anywhere:

```powershell
Start-Process cmd.exe -WorkingDirectory C:\Users\aless\Documents\origin-workspace -WindowStyle Hidden `
  -ArgumentList '/c','npx convex dev --codegen disable --typecheck disable --tail-logs always > .convex\dev.log 2>&1'
```

`npx convex dev` keeps the backend running and re-pushes `convex/` on every
change. `--codegen disable` keeps `convex/_generated/` untouched (the CLI would
otherwise rewrite it with different line endings). Logs: `origin-workspace\.convex\dev.log`.

Check it is up: `curl http://127.0.0.1:3210/version`.

### Stop

```powershell
Get-Process convex-local-backend -ErrorAction SilentlyContinue | Stop-Process
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like '*convex*dev*' | ForEach-Object { Stop-Process -Id $_.ProcessId }
```

### Reset all data

Stop the backend, delete `origin-workspace\.convex\local\default\convex_local_storage`
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
  (operation `feedback`, the same path the Next.js `/api/feedback` route uses).
- Vault (credentials), GitHub pull requests and commits are empty.

## Pointing the OpenMausBot client at it

The Origin desktop app reads the URL from localStorage `origin-cloud-url`, else
`VITE_ORIGIN_CONVEX_URL`. For dev, set `VITE_ORIGIN_CONVEX_URL=http://127.0.0.1:3210`
or call `setCloudUrl("http://127.0.0.1:3210")` from `src/lib/origin-cloud`.

## Running the origin-workspace web app against it

`cd C:\Users\aless\Documents\origin-workspace; npm run dev` uses `.env.local`
and serves `http://localhost:3000`.
