# Origin backend

The Convex deployment behind the Origin desktop app and origin.imbored.fun: accounts and sessions,
workspaces and invites, projects, issues, chat, shared agents and threads, notifications, feedback
portals, the vault and the signed `/integrations` bridge the app server calls.

```text
convex/        functions, schema, crons, HTTP actions and their tests (convex-test, in memory)
lib/           pure helpers the functions import
```

Production is the Convex deployment `wry-fly-446`. Development runs against a local deployment
(`npx convex dev` writes `CONVEX_DEPLOYMENT` to `.env.local`, state in `.convex/local/`; both gitignored).

## Develop

From the repository root:

```sh
pnpm install
pnpm dev:backend      # npx convex dev in backend/: local backend on http://127.0.0.1:3210, HTTP actions on :3211
pnpm test:backend     # vitest, no network
pnpm --filter @origin/backend typecheck
```

`docs/origin-cloud-dev.md` covers the local deployment, its environment variables and the seed data.

## Deploy

`node scripts/deploy-origin.mjs --backend` from the repository root backs up production with
`npx convex export` and runs `npx convex deploy` here. It needs `CONVEX_DEPLOY_KEY` for production in the
environment; never write the key to a file.
