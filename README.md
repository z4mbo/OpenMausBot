# Origin

A self-hosted team workspace: projects with an issue board, inbox, chat, calls, a shared Draw canvas and GitHub sync. Built with Next.js and Convex.

## Run locally

Requires Node.js 24.

```sh
npm ci
npx convex dev            # local Convex backend; writes .env.local
```

In a second terminal:

```sh
SECRET=$(openssl rand -hex 32)
npx convex env set ORIGIN_INTEGRATION_SECRET "$SECRET"
npx convex env set ORIGIN_SEALING_KEY "$(openssl rand -base64 32)"
ORIGIN_INTEGRATION_SECRET="$SECRET" ORIGIN_PUBLIC_URL=http://localhost:3000 npm run dev
```

Open http://localhost:3000 and create an account.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e`.

## Deploy

1. Deploy the backend to your Convex production deployment and set its environment:

   ```sh
   npx convex deploy
   npx convex env set ORIGIN_INTEGRATION_SECRET <openssl rand -hex 32>
   npx convex env set ORIGIN_SEALING_KEY "$(openssl rand -base64 32)"
   npx convex env set ORIGIN_PUBLIC_URL https://origin.example.com
   npx convex env set ORIGIN_SIGNUP_MODE invite   # optional, after creating your account
   ```

   `ORIGIN_SEALING_KEY` encrypts stored GitHub credentials; keep it stable.

2. Copy `.env.example` to `.env`, fill in the Convex URLs, `ORIGIN_PUBLIC_URL` and the same `ORIGIN_INTEGRATION_SECRET`, then:

   ```sh
   docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
   ```

   The app listens on `127.0.0.1:3000`; put an HTTPS reverse proxy in front and persist the `origin-data` volume. Deploy the Convex backend before a new web image. Details, email and TURN: [deploy/README.md](deploy/README.md).

## Connect AI agents (MCP)

Origin exposes an MCP server at `/api/mcp` for Claude Code, Codex, ChatGPT, OpenCode and other MCP clients.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
