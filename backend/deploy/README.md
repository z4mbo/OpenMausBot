# Deploy Origin

The standard deployment consists of a Next.js Node container, persistent local storage, a Convex backend, an HTTPS reverse proxy, and optionally coturn for calls across restrictive networks.

## 1. Configure Convex

Create your own Convex project. Develop against a separate development deployment, and publish with `npx convex deploy` using its production deploy key. Never commit a deploy key. See [Convex custom hosting](https://docs.convex.dev/production/hosting/custom).

Set the resulting `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` in the server environment. These are public endpoint URLs, not access credentials. They are also required at build time.

Generate a random integration secret:

```sh
openssl rand -hex 32
```

Set the same value as `ORIGIN_INTEGRATION_SECRET` in the Node server and the selected Convex deployment's environment. Set `ORIGIN_PUBLIC_URL` in both to your HTTPS application origin, without a trailing slash. The secret authenticates the server-to-server integration bridge. Do not rotate it without coordinating both services.

Origin allows open sign-up by default. For a private instance, make it invite-only so new accounts can only be created from an invitation link:

```sh
npx convex env set ORIGIN_SIGNUP_MODE invite
```

Create your own account first, then switch the mode on. Remove the variable to reopen sign-up.

## 2. Run the Application

Copy `.env.example` to `.env` on your server, fill in your own values, and protect it with `chmod 600 .env`. Keep the file outside any public web root.

From the repository root:

```sh
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

The app listens on `127.0.0.1:3000`. Route your HTTPS reverse proxy to it. Preserve `Host`, set `X-Forwarded-Proto`, and **overwrite** `X-Real-IP` with the actual client address. Never trust a client-provided `X-Real-IP`; the feedback endpoint uses it for rate limits.

Persist `/data/origin`. It contains chat history, attachment files, call state, GitHub credentials, OAuth state, and encryption key material. Do not serve this directory as static files, include it in an image, or publish it. Do not run multiple app replicas against separate copies of this directory: this release uses a single-instance local collaboration store.

## 3. Connect GitHub

The first workspace administrator can register the instance's GitHub App from **Settings > Integrations** using the GitHub manifest flow. Review GitHub's requested permissions before approving it. Configure the callback and webhook against your own public origin. Then install the app and finish account authorization for each workspace.

Repository creation uses the connected administrator's personal account and creates private repositories. For an existing repository, an admin must approve workspace access. A fine-grained project token is an optional alternative; never ask ordinary members for a server-wide token.

Server credentials are encrypted on disk. The encryption key and database must remain available together. Revoke credentials through the source service if the host is compromised.

## 4. Configure Email and Calls

SMTP is optional. Set `ORIGIN_SMTP_HOST`, `ORIGIN_SMTP_PORT`, `ORIGIN_SMTP_SECURE`, `ORIGIN_SMTP_USER`, `ORIGIN_SMTP_PASSWORD`, and `ORIGIN_SMTP_FROM`. Test an actual invitation; a saved configuration is not proof of delivery. Origin returns a shareable invitation link if mail delivery fails.

For a TURN relay, set `ORIGIN_TURN_HOST`, `ORIGIN_TURN_SECRET`, `ORIGIN_TURN_REALM`, and `ORIGIN_TURN_PUBLIC_IP` in your private server environment, then:

```sh
docker compose --env-file .env -f deploy/docker-compose.turn.yml up -d
```

Allow TCP/UDP 3478 and UDP 49160-49260. Keep the TURN secret identical in the app and relay. The provided relay uses host networking on Linux and denies private/multicast peers. Review `turn-firewall.sh` before applying its additional host egress restriction as root. Confirm an actual relayed call from two different networks.

## 5. Verify the Deployment

- Create a new account and workspace; an unrelated account must not see it.
- Test member and viewer permissions, invitation revocation, and session revocation.
- Send a chat attachment and test a call from a second browser/network.
- Connect GitHub, create a private repository, and close a linked test issue.
- Create a document, edit from two sessions, and confirm both edits persist.
- Enable a test feedback portal and check that no internal data is public.
- Verify desktop and mobile navigation, HTTPS, health, disk capacity, and logs.

Existing installations should deploy additive Convex schema changes before the matching web image. Do not replace or import production data merely to publish code. `ORIGIN_LEGACY_*` settings exist only for an operator-controlled migration of an older Origin installation; leave them unset for a new installation.
