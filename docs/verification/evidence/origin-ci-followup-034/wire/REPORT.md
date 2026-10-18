# CI 034: agents catalog wire manifests

Fix: `7d6c858eeedd38c4e7992745a2783f6ea1f61514`, based on frozen `f44ebe30a9568ed634b9eb8a45476f42e4c059b1`. This is a test-fixture-only commit, co-authored by Codex. No product source, assertion, tool list, timeout, retry policy or size-budget threshold changed. No push, deployment, package installation or release mutation was performed.

## Reproduced failures and cause

The untouched f44 run of `server/drivers/agents-bridge-wire.test.ts` and `server/drivers/agents-catalog-wire.test.ts` reproduced exactly **3 failed / 63 passed**:

1. Bridge wire line 211: the unbridged twin no longer matches its pinned bytes/hash.
2. Bridge wire line 229: the bridged profile manifest no longer matches.
3. Catalog wire line 169: the unbridged profile manifest no longer matches.

Branding commit `795ca0077c4562e731563bacad33e96f8591790e` changed product description text in agents-catalog.ts and agents-bridge.ts and refreshed the two full-list goldens, but left `profiles.json` and `bridged.profiles.json` at their previous serialized digests. The full-list structural/byte checks already passed at f44; the three failures are the stale per-profile manifests.

## Exact delta proof

`derive-delta.mjs` bundles the real catalog/bridge at the pre-branding parent `d06fe4cb6bdb33b81800424cacd619bd60665c4a`, then at f44, with the same unchanged imported definitions. All twenty profile combinations are evaluated both unbridged and bridged: **40 comparisons**. For every profile, the pre-branding serialized byte length, SHA-256 and ordered tool list exactly match f44's old manifest.

Every current serialized result is byte-for-byte identical to its old result after replacing only `OpenMausBot` with `Origin`. Recursive comparison additionally requires every changed leaf to be a description string with exactly that replacement. There are eleven occurrences per result, each shortening ASCII UTF-8 by five bytes: **all forty results shrink exactly 55 bytes**. Tool names/IDs/order, schema validation keys, enum/required values, annotations, permissions and bridge logic are unchanged.

Unbridged changed fields are the descriptions for list_room_targets, coordinate_bots, select_computer (two occurrences), request_credential (two), request_sign_in, fill_login (two), and run_on_startup descriptions in both routine tools. Bridged profiles retain the same changed hot-tool descriptions and replace the two hidden routine-description occurrences with the find_tool/use_tool description occurrences.

| Default profile | Before | Current |
| --- | --- | --- |
| Unbridged bytes | 68,524 | 68,469 |
| Unbridged SHA-256 | `5a1181da1dbd2ddb2182ac2ad4295dc59378fb52b6cb95393c2c95527ed565c2` | `760961c9f01cef156bb97f09e86e9674a57c834bf0f7ec18aaacb53fba9c32f7` |
| Bridged bytes | 15,658 | 15,603 |
| Bridged SHA-256 | `15813e96252013d93b2a606b533e904cf3fc811c41b21596443fae682360ff22` | `44ea1f9521afc5eebf26d9a08d082ab9c1aaee0fc2a2b2fe3680429496aba5c1` |

`catalog-delta.json` records every profile, changed field, replacement count and old/current digest. SHA-256: `dd3a36399275718212b2e8a6ba0a40e4317bafe9e5121960b326ae3e21d61df4`.

## Minimal correction and checks

The commit refreshes only the 20 bytes/hash pairs in each of the two profile manifests. Exact serialized-byte checks, SHA-256 checks, tool names, profile coverage, source-versus-bundle parity, Chief/tool-scope rules and all 2% budgets remain enforced unchanged.

- Baseline exact two files: **3 failed, 63 passed**.
- The explicit golden-update invocation produced **1 failed, 65 passed** because the bridge file read the old unbridged manifest before the catalog file regenerated it. Its log is retained. This intermediate write-order result is not called a successful validation.
- Independent normal invocation, with `UPDATE_AGENTS_CATALOG_GOLDENS` absent: **66 passed across the exact two files**.
- Related consumers: **217 passed, 2 existing Windows platform skips across five files**: agents-bridge unit, chat-completions bridge consumer, agents-bridge-gates, agents-bridge-switch, and agents-bridge.e2e. The skipped cases require a POSIX FIFO and a device file. No skip or test body was changed.
- `git diff --check` passed; final tracked status was clean after the single commit.

Tests ran on Node 24.21.0 with an explicit environment whitelist and owned home/temp directories. Repository setup gives each file a throwaway home; the E2E uses `launchVerificationServer` and its fake engine, and closes that isolated fixture in finally. No real credentials/providers, main checkout servers, local Convex, production data or installed app were used. No broad suite or new release qualification is inferred.

Evidence remains in this private directory: `red.*`, `update.*`, `green.*`, `consumers.*`, the delta derivation and bundles, command records, this report and the final evidence manifest. The earlier native audit and delivery-summary evidence are preserved separately.
