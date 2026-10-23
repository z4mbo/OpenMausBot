# Current image drift — cycle049 release hold

The live image a70d46e9fa00195b221e68a0a194cf4399ee92ae8cd4ead97891fc7713f6a767 contains newer concurrent source. It must not be accepted as an equivalent040 baseline. The prepared042 delivery remains held; no guards were weakened or baseline pins changed.

One exact-image diagnostic container was created with a unique audit label, read-only root filesystem, network none and no mounts. It was never started or execed. Only333 explicit frozen source paths were copied to an in-memory tar reader for hashes. It was removed in finally after exact ID/image/label/created-state guards. No production account data or environment values were read. No further SSH was used after this inspection.

All321 existing inspected files match raw SHA256 from main commit 97383097d13e5c9bb969801623e6ccd9ed3b356f (Origin0.5.0: Launchpad, Docs and milestones, Ship, Brand kit, Pulse). Of these,303 match040 and289 match042. Eighteen existing source files differ from both040 and042; all eighteen exactly match973. They include shared/origin-releases.ts, backend schema/generated API, pages/studio implementations and shared canvas/outbound contracts. Twelve union paths are absent, including candidate-only hosting files and ignored site files. There are no existing inspected files unknown to973. This identifies a source fingerprint, not a complete image-build provenance proof: unlisted new files and compiled output were not inspected. The original LF-normalized summary misclassified eight binary assets; the final receipt uses raw hashes and corrects that diagnostic summary.

The main checkout was read only with optional Git locks disabled. The observed uncommitted files were backend/convex/pulse.ts, backend/convex/pulse.test.ts, server/origin-project-context.ts and server/origin-project-tools.test.ts. Their contents were not changed or incorporated into this review.

The private budget-access fix1697 is absent: backend/convex/budgets.ts:151 forAgent authenticates workspace membership, then calls budgetChecks without checking project membership. A non-admin workspace member knowing a private-project agent ID can receive its name, monthly cap and spend. requireMember at permissions.ts:41 rejects the same non-project member; that gate is missing here. This is a source finding, not a production query test. The hosted monthly-budget/accounting fix a4af is also absent because973 has no modelHosts.ts or generated API module. Ordinary agentRuns still checks budgetRefusal at line35 and books recordSpend at line152; no claim is made that the nonexistent hosted path is reachable in973.

Preserved resources: the source7e89 candidate archive/context and private image af52ccde9fb6a84e6b915ebc6d95634ff8038202e1e2ce8ca51f8d235376c396, last independently verified09:28:11Z; old040 image b3be41ef45f30a7cd6fa35babcbc1e17d29b937b5c7652705ced0bb8b2f54679 was not removed or retagged by this lane; every public download/feed and currenta70 service was left unchanged; private attempt1 history, upload/build receipts and rollback/context/operator configurations remain untouched. No freshness claim is made for old-image availability after the concurrent deployment. Root separately reported at09:38 that GitHub latest and feeds still show040. No042 site promotion, backend execution, tag move, prune or release mutation was performed here.

Review material:

- source-comparison-final.json — SHA256 f515e9484c2574f3944d827bdb132b903a0eb66a7a1e2ea8f35977bbe74383a6
- response.json — SHA256 08fc11d4574b2b992639383ca3196d53140b604b2e2d9496502c0fe938fdb54b
- request.json — SHA256 ee241ba5644dd7195389a3d04ccd2a5166c2f9be49d0b4a327b8603811726986
- patch-presence.json — SHA256 efe9ddf2cd80b74acc1e374bf67dd3eef6ca8a07c9ee1aff731315fb1267e3c9

The only next decision supported by this evidence is to keep042 delivery held and reconcile ownership of concurrent050 work before selecting a future integrated source. This report performs no merge or new audit.
