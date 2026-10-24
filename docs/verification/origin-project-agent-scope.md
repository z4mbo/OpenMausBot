# Project agent scope and workspace control

A project Chief and its specialists resolve one cloud project. A project's
`managedSections` does not widen its data or peer authority. A workspace head
is a visible Chief in a `Workspace: ` section; it resolves the linked Chiefs
in its explicitly managed teams. Hidden Chiefs and workspace-head project
links do not supply project identity.

`pickProject` selects only from `ctx.reachable`; a project argument cannot
grant access. Issue IDs and ORI keys resolve inside that set before a bare-ID
relation, label, PR or deletion operation runs. Related issue titles are
filtered by the same set. Peer discovery, dispatch and room supervision also
apply the current project links, including when two explicitly linked bots
share a section. Agent lookup and rosters filter project identity before
returning display names. Existing peer restrictions, audiences and approval gates
still narrow access. Changes to links or team grants take effect on the next
check.

## Capability matrix

Here **project agent** means the project's Chief; specialists also have the
ordinary project tools, while Chief-only assignment, PR review/merge and
standup retain their role gate. **Workspace agent** means the workspace head.
Each row applies to every tool named in it.

| Tool | Project agent | Workspace agent | Scope |
| --- | --- | --- | --- |
| `origin_list_projects` | Yes | Yes | Own project / managed projects; visible Chiefs and team roster |
| `origin_list_issues`, `origin_get_issue` | Yes | Yes | Reachable projects; issue ownership before details, labels, PRs; reachable related projects only |
| `origin_create_issue`, `origin_update_issue`, `origin_comment_issue`, `origin_delete_issue`, `origin_complete_issue` | Yes | Yes | Resolved project and issue; existing backend edit checks; deletion calls `tasks:deleteTask` |
| `origin_assign_issue` | Yes | Yes | Recipient must belong to the issue's project; actual dispatch still uses `coordinate_bots` |
| `origin_team_chat`, `origin_team_chat_post` | Yes | Yes | Selected project's team and project channel; no direct messages |
| `origin_vault_list` | Yes | Yes | Selected project's Vault plus personal items explicitly shared for agent use; member unlock and edit-role checks remain |
| `origin_vault_store` | Yes | Yes | Selected project's Vault; encrypted payload read through caller's allowed file roots; cannot grant itself agent use |
| `origin_list_assets`, `origin_add_asset` | Yes | Yes | Selected project's library; local upload uses caller's allowed file roots and deployment upload origin |
| `origin_repo_status`, `origin_review_pr`, `origin_merge_pr` | Yes | Yes | Selected project's GitHub connection; merge retains admin role, head SHA and mandatory person approval |
| `origin_feedback` | Yes | Yes | Portal resolved by selected project before feedback ID lookup |
| `origin_brand_get`, `origin_brand_update` | Yes | Yes | Selected project's kit; logos/icon resolve in project's Assets |
| `origin_call_notes`, `origin_standup` | Yes | Yes | Selected project, or reachable projects for standup; no arbitrary note ID |
| `list_bots`, `list_room_targets`, `coordinate_bots`, `assignment_status` | Yes | Yes | Project peers / managed teams; current peer/audience/room checks, bounded wait and automatic result return |
| `list_threads` | Yes | Yes | Ordinary owned/opened threads; head's direct chat also discovers supervised direct conversations |
| `read_agent_transcript` | No | Yes | Direct chat only; supervised managed peer, matching audience, source-conversation/room access and lending visibility; 100 messages / 20,000 text characters, secret redaction |

## Verification

Run the isolated fake-engine acceptance and the regression suites:

```sh
pnpm exec vitest run server/origin-agent-scope.e2e.test.ts
UPDATE_AGENTS_CATALOG_GOLDENS=1 pnpm exec vitest run server/drivers/agents-catalog-wire.test.ts server/drivers/agents-bridge-wire.test.ts
pnpm exec vitest run server/drivers/ server/origin server/agent-tool-policy server/peer-roster.test.ts server/auto-approve.test.ts server/safety-floor.test.ts server/routes/sign-in.test.ts --maxWorkers=2
pnpm typecheck
pnpm lint
```

Retained evidence: [check results](evidence/origin-project-agent-scope/report.json)
and [fixture waits, transcripts and resulting backend state](evidence/origin-project-agent-scope/acceptance.json).

The acceptance starts `launchVerificationServer` and an in-memory Convex
adapter running the real backend functions. It seeds three disposable
projects accessible to one synthetic account. Alpha's Chief is deliberately
granted Beta and Elsewhere teams: foreign reads, bare-ID deletion and peer
handoffs must still fail. Its related-issue output excludes both projects.
An encrypted Vault payload persists without agent-use permission. The head
discovers Alpha and Beta, reads Alpha's person-started transcript, sees the
managed related issue but no Elsewhere title, deletes Beta's disposable issue,
and collects results from both Chiefs. Elsewhere's issue remains intact.
The fixture writes `*.log.scope.json` evidence beside its retained log, then
closes its exact server and removes its temporary home/data. No production
backend deployment is involved.

The regression suite exercises every registered Origin tool with a foreign
project, foreign bare issue IDs, same-section conflicting links, hidden or
forged identities, transcript revocation/limits/redaction, encrypted-only
Vault writes, foreign roster-name disclosures, room-derived transcript privacy
and rejection of foreign design submissions. Catalog source and
bundle wire goldens retain their existing 2% size budget.

## Limits

Vault storage accepts the existing passphrase-encrypted JSON format; a member
prepares/encrypts it, enables agent use and unlocks it. Agents cannot acquire
the Vault passphrase or enable their own secret access. Personal secrets
explicitly shared for agent use retain their established workspace-wide scope.

No GitHub mutation or live-model judgment is established by this fixture. Issue completion keeps
its existing implementation so the separate completion change can replace it.
These boundaries govern server tools and peer coordination; they do not
constitute a filesystem or network sandbox for arbitrary engine commands.
No visible UI or frontend design changes are included.
