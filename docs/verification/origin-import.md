# Resumable Origin workspace and project imports

Run only in a disposable workspace. This recipe starts and closes the repository's
`control-omb.ts` fixture launcher itself and runs a synthetic Convex HTTP provider
on a free loopback port. It does not use the local Convex deployment, a signed-in
account, live app data, or a real model.

```sh
node --experimental-strip-types scripts/verify-origin-import.ts
npx vitest run src/lib/origin-import.test.ts src/components/OriginSync.test.ts server/origin-import.test.ts server/origin-cloud-sync.test.ts server/store.test.ts server/bot-wire-privacy.e2e.test.ts
npx tsc -b
npx tsc -p tsconfig.server.json
```

The HTTP recipe drives the real `runImport` client and production local routes.
It obstructs only two exact temporary link-write paths inside the fixture. It
proves that a failed workspace link write retains one recoverable head; a failed
project link write retains one complete Chief and six specialists; retry repairs
the link; and lost responses and concurrent retries return the same identities.
The final state has nine bots: the fixture starter, the workspace head, and one
seven-bot project team. Its workspace head manages exactly that project section.
The private import receipt remains on disk and is absent from API bot payloads.

The HTTP unit suite additionally covers the capacity boundary before allocation,
an atomic bot-write failure, recovery after loading a fresh Store, cloud access
revocation, account/deployment changes during pending operations, local admin
session revocation, hosted model restrictions, wrong workspace ancestry, reserved
section names, and refusal to silently restore locally changed Chief authority.

Evidence is written to `docs/verification/evidence/origin-import/result.json`,
including the launcher's exact URL, PID, temporary data directory and retained
server log path. The launcher removes its own data on completion. This proves the
local import protocol with synthetic cloud authorization responses; it does not
prove a production account, network outage recovery elsewhere, or desktop
packaging. Old unlinked bots without a durable cloud identity are not deleted or
guessed from their names.
