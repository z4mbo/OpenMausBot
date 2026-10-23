# Additional-team cache follow-up (next cycle)

Source: `d09a9202130ef58976aea8ee6c221dc433f97e25` (Origin 0.2.12 frozen source).
Upstream: [OpenMausBot #3036](https://github.com/milind-soni/OpenMausBot/pull/3036), merge `53d759e8841abe6a1bd869637c221b99d1f7b7ea`.

## Confirmed bug: P2 stale team-access display after Chief handover

1. In a disposable fake-engine server, create Chief A and bot B in Office plus a Research peer. Give A additional access to Research and General.
2. Elect B as the Office Chief. The server demotes A and deletes A's `managedSections`.
3. Elect A again. Its server record is a Chief with no additional-team grant.
4. The real server's `/api/events` emits A's complete demotion and re-election bot frames without `managedSections`. Feeding those actual frames through the frozen client reducer leaves its old `["Research", ""]` array cached.
5. The real `ManagedTeamsSettings` component rendered from that cached bot checks Research and General and disables Save, because its local selection equals the stale allowed list. Reloading a full state would remove the stale cache.

`stream-proof.json` captures the actual three server SSE phases. `reproduction.json` tests all three affected reducer paths (`botPatched`, `taskSwitched`, and a thread-switching `botPatched`), then repeats them with an external virtual version containing upstream's three explicit optional-field copies. Frozen behavior retains the array in 3/3 cases; the proposed virtual version clears it in 3/3 cases. Both use the real component for static HTML, without a browser.

Source path:

- `server/routes/bot-patch.ts:646-649`: electing another Chief calls `store.setChiefOfStaff`.
- `server/store.ts:1825-1844`: handover demotes the previous Chief, deletes `managedSections`, saves, and emits bot updates.
- `server/store.ts:1560` and `1582-1584`: a reviewed team-setup demotion also deletes the field and emits updates (source traced; this particular flow was not executed).
- `server/index.ts:5000-5002`: a store bot change broadcasts `wireBot` as a complete bot frame.
- `src/state/store.tsx:3412-3425`: incoming bot frames dispatch `botPatched`.
- `src/state/store.tsx:1303`, `1305-1315`, and `1927-1933`: the old cached object is spread into the next bot without explicitly clearing omitted `managedSections`.
- `src/components/bot-settings/PermissionsSection.tsx:92-98`: allowed values and the remount key come from the cached field.
- `src/components/bot-settings/ManagedTeamsSettings.tsx:12-14`, `29-38`: selection starts at allowed values, checked boxes use selection, and Save is disabled until selection differs.

## Permission boundary

This proof does **not** establish an authorization bypass. On the real isolated server, A's re-elected record lacks the field. The actual `canReachPeer` implementation returns false for Research and General after re-election, and true for Research before revocation. The server's registered coordination/retry/proposal paths read current server records, rather than this renderer cache (`server/peer-roster.ts:28-36,94-100`; `server/index.ts:15582,15594-15597`; `server/team-setup-requests.ts:99,142-153`). No model or peer tool was invoked, so this is source tracing plus real-server record/predicate verification, not full tool execution acceptance.

If a person changes a different checkbox and saves the stale selection, `PermissionsSection` submits every selected team with `acknowledgePeerScope: true`; the server validates new grants against its current record (`server/routes/bot-patch.ts:481-495,522-527`). Thus stale checked boxes can mislead a person about what the next save grants, but any new authority still follows the ordinary owner-confirmed update path. That conditional save outcome was source traced, not executed.

Other client consumers use `managedSections` for workspace filtering/adoption (`src/lib/origin-workspaces.ts:75-84`, `origin-sync.ts:33-38`, `origin-cloud-links.ts:63-70`). No cloud adoption, wrong-row update, or production exposure was tested or claimed here.

## Proposed next logical change

Adapt upstream's three copies of `managedSections: action.bot.managedSections` beside the existing optional-field copies in `src/state/store.tsx`. Add the parameterized regression to `src/state/store.test.ts`, including a still-Chief complete frame that omits the field, and a control showing non-empty incoming grants are preserved. No server authority change is needed. A new isolated settings/browser before-and-after run should accompany the fix; the static component render here is not a screenshot or packaged-app acceptance.

## Safety and evidence

All scripts, generated bundles, reports, and static HTML were created only under this newly owned external temporary folder. Both `launchVerificationServer` instances used dedicated free ports in 23100-23180, isolated homes/data, and the repository fake engine; no fake engine turn was started. Both exact child processes stopped and their fixture data directories were removed. Their retained logs are under this folder. Main checkout, ports 5199/8799, Convex 3210, production data, root scratch, and root browser were untouched. Root HEAD and clean status were checked before and after.

Evidence SHA256:

- `reproduction.json`: `6dac68d35e7c06366fb37f9b8dd67b10a1d849258b7f3d5f9fed9d3bbf31aebb`.
- `stream-proof.json`: `6d394ff3a1e3c91e8fbe8d9568f6c4d7db5fd29fc96799f79f531278c804790f`.

The proposed bundle is a test-only virtual modification outside the checkout. No fix was applied to Origin, and this finding does not change 0.2.12's frozen release scope.
