# Origin cards in agent chat

When a Chief or agent calls an Origin tool, the item it returned shows in the
chat as a card the person can act on, not only as text. The tool result keeps
the words the model reads; the card travels as `originCard` on an activity
row (`shared/origin-chat-cards.ts`), next to the existing issue, pull request
and Studio cards, drawn by the same `OriginToolCard` in
`src/components/OriginToolCards.tsx`, while `server/origin-chat-cards.ts` keeps it out of the model's
answer. Each card reads its record live from Origin, so it follows the
project after the turn ends, and opens the project's section focused on the
item.

| Tool | Card | Actions |
| --- | --- | --- |
| `origin_broadcast_draft`, `origin_broadcast_list`, `origin_broadcast_schedule` | Post preview per channel, status, schedule | Approve, then Schedule; Open |
| `origin_campaign_get`, `origin_campaign_create` | Campaign status, dates, channels, counts | Open |
| `origin_list_assets`, `origin_add_asset` | Image, video and audio previews | Open each asset |
| `origin_vault_list` | Titles, kinds and "Agents may use", never a value | Open |
| `origin_repo_status` | Branch protection, open pull requests with checks, commits | Open, GitHub |
| `origin_feedback` | Bug or idea, status | Create issue, open its issue |
| `origin_call_notes` | Decisions, key points, action items | Draft issues, open each issue |

`origin_call_notes` is new: agents had no way to read a call's notes. It is a
deferred read tool (`server/drivers/agents-tool-domains.ts`).

Approval rules are the backend's own: Schedule shows only once a person
approved an agent's post, and a viewer sees neither. A post longer than the
card can show is approved from Publish, after reading all of it.

## Run

```sh
OMB_VERIFY_PLAYWRIGHT=<path to playwright's index.mjs> \
  node --experimental-strip-types scripts/verify-origin-chat-cards.ts
```

The script needs nothing outside this computer: the real Convex functions of
`backend/convex` run in memory (`scripts/testing/origin-campaigns-backend.ts`)
and the server is the disposable fake-engine fixture. The fake engine calls
seven of the tools above through the real agents MCP server in one turn. The full
renderer (`scripts/testing/threads-preview.tsx`) runs in headless Chromium at
1280 px, dark, with `@/lib/origin-cloud` pointed at the in-memory backend.

It exits non-zero unless:

- every tool drew its card in the thread, and no tool answer the model read
  carries the card;
- the vault card holds no ciphertext, username or address;
- the post card offers Approve and hides Schedule until it is approved, then
  schedules it through the backend;
- Draft issues on the call card creates the three Draft issues;
- clicking an asset opens Assets with that asset focused;
- the page threw no error.

It writes `report.json` and the screenshots to
`docs/verification/evidence/origin-chat-cards/`, including
`chat-header-scrolled.png`: the thread header after the transcript scrolled
under it, an opaque bar with no blur of the cards beneath.

Every Origin card in chat (posts, campaigns, assets, vault, repository,
feedback, calls, issues, pull requests, Studio and designs) is drawn in
`CardFrame` (`src/components/origin-cards/CardFrame.tsx`): one frame, a header
with the icon, title, meta line and open button, and the same small solid and
quiet action buttons.

Unit coverage: `shared/origin-chat-card-items.test.ts`,
`server/origin-cloud.test.ts` (cards per tool and the route that draws them)
and `server/broadcast/tools.test.ts`.
