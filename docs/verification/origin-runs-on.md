# Who runs a shared agent, and whose subscription pays

A shared agent's settings have a **Who runs** card with three modes:

- **Whoever writes**: each person's message runs on their own computer and their own Claude, ChatGPT or Grok
  account. Each person pays for their own messages.
- **A chosen member**: every message runs on one member's computer and subscription. Only a computer its owner
  offered (the switch at the bottom of the card) can be chosen by someone else; choosing your own computer offers
  it. While it is offline, messages run on each sender's own computer.
- **Cloud**: an always-on Origin server (`ORIGIN_HOST_KIND=server` or a Cloud home) runs every message with the
  key or subscription signed in there, including its owner's own messages from another computer.

Only people who can edit the agent change the mode. Credentials never move: a run goes to the host that holds
them, which answers with its own engines and mirrors the reply. Each host publishes, per shared agent, only a
label of the account it would use (`{ provider: "claude" | "chatgpt" | "grok" | "key", plan? }`, plan names from
the providers' usage endpoints, at most every half hour). A hosted run is picked up only by the host it went to,
so a person signed in on a laptop and a server runs it once.

The chat header shows a **runs-on badge** next to the computer icon: the runner's avatar, name and subscription
("Ada · Claude Max"), "You · …" when your own computer answers, or "Cloud"; a grey dot when the chosen computer is
offline. At narrow widths only the avatar shows. `RunsOnBadge` takes `{ kind, name, you?, avatarUrl?,
subscription?, offline? }`; `SharedAgentRunsOn({ bot })` fills it from `agentHosts:runsOn`.

## Checks

```sh
pnpm --filter @origin/backend exec vitest run convex/agentHosts
pnpm exec vitest run src/components/RunsOnBadge.test.ts server/agent-subscriptions.test.ts server/origin-shared.test.ts
OMB_VERIFY_PLAYWRIGHT=/path/to/playwright/index.mjs node --experimental-strip-types scripts/verify-origin-runs-on.ts
```

The last command starts an isolated fake-engine server (`launchVerificationServer`), the real Convex functions
in memory (`startFakeConvex`) seeded with Ada (owner, a laptop on Claude Max and a server on an Anthropic key) and
Grace (member, an unoffered laptop on ChatGPT Plus), and mounts the real `ChatView` and `RunsOnCard` in headless
Chromium. As Ada it picks a chosen member, then Cloud, then Whoever writes through the card; as Grace it reads the
badge after each change, after Ada's laptop goes stale, and at a narrow width. It writes
[`evidence/origin-runs-on/report.json`](evidence/origin-runs-on/report.json) and these screenshots:

| | |
|---|---|
| Chosen member, seen by Grace | ![](evidence/origin-runs-on/badge-chosen-member.png) |
| Chosen member offline | ![](evidence/origin-runs-on/badge-chosen-member-offline.png) |
| Cloud | ![](evidence/origin-runs-on/badge-cloud.png) |
| Whoever writes, seen by Grace | ![](evidence/origin-runs-on/badge-whoever-writes.png) |
| Narrow header | ![](evidence/origin-runs-on/badge-compact.png) |

Card: [whoever writes](evidence/origin-runs-on/picker-whoever-writes.png),
[chosen member](evidence/origin-runs-on/picker-chosen-member.png),
[member's read-only view](evidence/origin-runs-on/picker-member-view.png),
[offline note](evidence/origin-runs-on/picker-offline-note.png), [cloud](evidence/origin-runs-on/picker-cloud.png).

This does not prove a real provider plan lookup (the fixture has no subscription credentials, so its own label is
just "Claude"), a live Convex deployment's websocket subscriptions, or a hosted run executing on a second real
desktop; the backend tests cover routing and pick-up by host.
