export { HEADLESS_VERBS as HEADLESS_VERB_NAMES } from "./headless/args.ts";

export const HEADLESS_USAGE = `Drive a running workspace (scripts, CI, other agents):
  pnpm omb doctor                    check the server answers and an engine is ready
  pnpm omb bots | channels | models  your bots, your rooms, the engines and their models
  pnpm omb run BOT "do this"         give a bot one job and wait until it and every teammate it asked are done
  pnpm omb send BOT "text"           send one message and return at once
  pnpm omb wait BOT                  wait on work already running
  pnpm omb messages BOT              the latest messages of a conversation
  pnpm omb interrupt BOT [--tree]    press Stop (--tree: and every teammate on its job)
  pnpm omb export BOT --out DIR      write a job's transcripts, files and screens to DIR
  pnpm omb events [--job THREAD]     the server's live events as JSON lines
  pnpm omb team apply FILE           make the workspace match a team file (team export writes one)
  pnpm omb engine set claude --key-env ANTHROPIC_API_KEY   give it an engine without a screen
  pnpm omb connect URL --code CODE --out FILE              get a token for a workspace elsewhere
  pnpm omb new-bot | new-channel | set-model | edit | mcp

  Server: --url URL (or OPENMAUSBOT_URL), --port N (or OMB_PORT), else this computer's.
  Token: OPENMAUSBOT_TOKEN or --token-file FILE. --json prints one JSON document;
  progress goes to stderr (--quiet drops it). pnpm omb help VERB for the details.`;

export const USAGE = `Origin — your team of AI bots, ready in a few steps

  pnpm omb                            set up once, then open your workspace
  pnpm omb setup [--data-dir DIR]
  pnpm omb start [the same options as serve]
  pnpm omb serve [--port 8799] [--data-dir DIR] [--label NAME]
                    [--public-url https://host] [--tailscale | --tunnel | --domain HOST] [--no-pair]
  pnpm pair  [--label NAME] [--client] [--phone ios|android]
                    [--public-url https://host]
  pnpm omb sessions [revoke ID]
  pnpm omb status
  pnpm omb login [--email you@example.com]
  pnpm omb logout
  pnpm omb access list | add EMAIL [--chat-only] | remove EMAIL
  pnpm omb service install [--domain HOST | --tunnel | --tailscale] [--port N] [--data-dir DIR] | uninstall
                    [--sentinel]   (the health scan below, every two minutes, instead of the server)
  pnpm omb sentinel [--data-dir DIR] [--out DIR] [--once] [--json]   (read-only health scan; see --help)
  pnpm omb browser install [--with-deps] | status
  pnpm omb fleet init --domain HOST [--operator USER] | create NAME --admin EMAIL [--member EMAIL] [--brand FILE]
                    [--anthropic-key-file FILE] [--cap USD] [--license-key KEY] [--memory 1G]
                  | list | users NAME add|remove EMAIL [--chat-only] | suspend NAME | resume NAME
                  | delete NAME --yes [--keep-data] | upgrade   (all take --dry-run)
                  | agent [--socket PATH] [--group USER]   (root; installed by init --operator)

setup   choose AI access and optional phone access; keep existing bots and chats
start   same as pnpm omb: use your saved settings and open the workspace
serve   starts the server without prompts and prints a pairing link + QR code
pair    mints a pairing code against a running server (--client: chat only)
sessions lists paired devices; "sessions revoke ID" signs one out
status  what the server says about itself
login   signs this machine in to an OpenMausBot account (an emailed code)
        and reserves its public address for --tunnel
logout  releases that address and signs out
access  who may sign in with an emailed code at /pair: an address or
        @domain; --chat-only gives chat and approvals without settings.
        Takes effect at once, no restart.
service keep the server running across reboots: writes a systemd unit
        (Linux) or a launchd agent (macOS) for the same serve options and
        prints the commands that install it. Run from a stable Origin checkout
        whose files remain available to the service user.
browser install: the bots' browser engine (agent-browser, pinned) into the
        data dir, and Chrome for Testing into the user's browser cache.
        --with-deps also installs
        the Linux libraries Chrome needs (run as root once). Then run
        browser install as the user running serve, from that user's home.
        status: what the current user and data directory have.
fleet   many client workspaces on one Linux server, each its own account,
        service, data folder, brand, sign-in list and keys at NAME.HOST
        behind the system Caddy. Plans are printed unless run as root;
        --dry-run prints supported plans. Run from a stable Origin checkout;
        automatic fleet upgrade is unavailable. Update the checkout separately.
        init --operator USER also installs the fleet agent, a root service
        on a Unix socket only USER may open, so the workspace running as
        USER manages the others from Settings → Installations.

--tailscale  serve over your tailnet: Tailscale terminates HTTPS and the
             link uses this machine's MagicDNS name (needs Tailscale signed in
             and HTTPS certificates enabled for the tailnet)
--tunnel     serve at a public https://c-… address through a
             Cloudflare tunnel: no domain, no proxy, no open port. Run
             \`pnpm omb login\` once on this machine first.
--domain     serve at https://HOST on your own domain: a pinned Caddy is
             downloaded once and run alongside the server, and gets the
             certificate itself. Point the domain's DNS at this machine and
             open ports 80 and 443.

--no-open   do not open a browser window
--no-pair   skip phone setup and do not print a pairing code
--local     start locally this time, ignoring saved remote-access settings

${HEADLESS_USAGE}

Use the Origin checkout from https://github.com/z4mbo/Origin with Node 24+ and pnpm.
Run \`pnpm install --frozen-lockfile\`, then \`pnpm omb setup\` and \`pnpm omb\`.
Use \`pnpm pair\` to pair another device. Origin does not publish an npm package.
`;
