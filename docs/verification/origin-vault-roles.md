# Personal Vault, service sign-ins and project roles

A person's own Vault sits beside each project's shared Vault. Either can hold a
**service sign-in**: the tokens a service's command line reads from its
environment (Convex, Vercel, App Store Connect, Netlify, Cloudflare, Supabase,
Expo, npm, Fly.io, or named variables of another service), encrypted with the
Vault passphrase as one JSON object. While the Vault is unlocked on a computer
and the item is marked usable by agents, that computer's agents see the
variables in `origin_vault_list` and set them on the command that needs them.
The values stay in the local server's memory only and are masked in logs and
transcripts; variables the shell, engine billing or Origin itself depend on
(`PATH`, `OMB_*`, `ANTHROPIC_*`, `GITHUB_TOKEN`...) are refused.

Project Members lists what each role can do, and an admin can add a member
straight in as Admin.

## Run

```powershell
node --experimental-strip-types scripts/verify-origin-pages.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-vault-roles.mjs http://127.0.0.1:PRINTED_PORT/__origin-pages.html
npx.cmd vitest run server/origin-vault-agent.test.ts src/components/origin-pages/VaultPage
pnpm --filter @origin/backend exec vitest run convex/personalCredentials convex/accessMatrix
```

The browser check covers 1280 and 375 px in dark and light: unlocking the
project Vault and revealing a Convex sign-in as `CONVEX_DEPLOY_KEY=...`;
switching to Personal, where project items are absent; saving an App Store
Connect sign-in whose recorded write is encrypted, carries `kind: "service"`,
`service: "apple"`, no project id and no plaintext; and the role legend and
Admin option in Members. Every case asserts no horizontal overflow and no page
errors. Screenshots and `browser-checks.json` land in
`docs/verification/evidence/origin-vault-roles/`.

## Not covered

The fixture mocks Convex, so it proves the screens, not a deployed backend;
`backend/convex/personalCredentials.test.ts` covers owner-only access against convex-test.
No real service token was used, and no agent ran a real `vercel` or `convex`
command. A member's write token can still approve a pull request someone else
opened from a personal GitHub account; branch protection stops the agent's own
pull requests from being approved by the same App.
