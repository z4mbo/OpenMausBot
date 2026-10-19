# Origin storage authority and upload verification

## Proven bug and fix

**P1: revoked private-project access could be recovered through a remembered storage ID.** A member read a private asset and remembered its `_storage` ID. After removal, `design.list` correctly refused the source project. The former member created another workspace/project, submitted that ID to `design.createAsset`, and received a fresh private-file URL. The original regression in `backend/convex/storageAdmission.test.ts` was observed failing before this fix. Its source is an existing legacy reference, covering installations predating provenance.

All five reference writers now use `admitStorageReference`: account avatars (`auth.updateProfile`), project icons (`projects.update`), shared-agent avatars (`agents.setAvatar`), assets (`design.createAsset`), and drawing files (`draw.saveFile`). Destination write permission and source read permission are separate checks. Knowing an unreferenced ID grants no authority. A current source reader may deliberately reuse a file in an authorized destination. Access removal prevents subsequent sharing from the removed scope; an already authorized copy retains the destination's access rules. Replacing a reference preserves other shared images.

## Upload provenance

`lib/storage.ts` issues ten-minute, one-use upload capabilities pinned to the authenticated session, actor and exact destination. Only token hashes are stored. All five issuers return URL strings; `POST /uploads` accepts raw bytes and returns `{ storageId }`, preserving the renderer/tool transport shape.

The HTTP action consumes the capability before reading, bounds streamed bytes without trusting Content-Length, stores the blob itself, and registers its scope through an internal mutation. Both consumption and completion recheck session expiry/generation/account status and current destination authority. Callers cannot pair unrelated storage IDs with intents. Failed completion deletes only the new blob just stored by that HTTP operation, never a reused/shared blob.

Profile, agent and icon uploads are bounded at 5 MiB; assets and Draw at 15 MiB. Profile MIME policy remains PNG/JPEG/WebP/GIF, agent/icon images accept `image/*`, and Draw retains PNG/JPEG/WebP/GIF/SVG. These checks validate declared stored Content-Type, not image-content sniffing. Expired intents are removed in batches of 100 with continuations; issuance allows at most 100 unexpired intents per account. Interrupted uploads require a new capability.

`server/origin-cloud.ts` also accepts the selected deployment's corresponding `.convex.site` origin, the next loopback port, or the explicitly configured action origin. Unrelated hosts remain refused. Custom deployments require `ORIGIN_CONVEX_SITE_URL` for a distinct action origin.

## Legacy migration and rollout

Tables/indexes are additive; existing rows have no new required fields. `internal.storage.migrateReferences` accepts `{ table, cursor }` and returns `{ cursor, done, admitted }`. Allowed tables: `users`, `projects`, `workspaceAgents`, `designAssets`, `drawingFiles`. Each call visits at most 100 rows and admits only extant referenced blobs under their account/project/workspace scope. Continue the returned cursor until `done`; reruns are idempotent. No storage-wide first-caller assignment or blob deletion occurs.

Before backfill completes, indexed legacy-reference lookup permits reuse only for an actor who currently reads a source reference. Old unreferenced blobs stay unclaimable, so no insecure grace period is needed.

Rollout must account for older packaged tool servers:

1. Build, verify and publish compatible Windows/macOS desktop artifacts and update the hosted app server. Their upload allowlist supports the action origin.
2. Confirm the intended deployment's action origin and `/uploads` reachability/CORS while preserving existing images.
3. Deploy the additive schema/indexes and secured issuers/writers together to the explicitly selected deployment. Existing renderer uploads retain their API shape. Old packaged **tool** uploads reject the action origin until upgraded; there is deliberately no unprovenanceable direct-upload fallback.
4. Run all five internal migration streams on a backed-up, reviewed deployment, recording cursor completion and counts. This slice ran them only in disposable fixtures.
5. Verify scoped upload, authorized shared reuse and removed-member denial through the deployed application before claiming deployed acceptance.

Historical references lack reliable original-uploader provenance. Migration preserves existing bindings; it cannot identify unauthorized rebinds made before this fix. Such rows require ownership/audit review rather than automatic deletion or reassignment.

## Checks

From `backend/`, `npm.cmd exec vitest -- run` passed **17 files / 132 tests**, including **15 admission tests**; `npm.cmd run typecheck` passed. Registered Convex handlers and the actual registered HTTP action ran inside disposable convex-test databases:

- The original revoked-member rebind and denial through all five writers.
- Unknown IDs, private profile upload theft and unrelated valid intents.
- All five issuers' raw POST/storageId transport and successful references.
- Authorized legacy reuse/copies and shared-avatar replacement.
- Replay, overlapping POSTs, expiry, MIME rejection, declared oversize and chunked byte bounds.
- Project removal during the pending body, session generation revocation and sign-out.
- Cleanup of rejected new blobs while preserving another stored file.
- Idempotent 100-row pages and all five reference-table migrations.
- CORS preflight without ambient credentials.

`pnpm.cmd exec vitest run server/origin-storage-upload.test.ts server/origin-cloud.test.ts` passed **50 tests**. Nine new origin tests cover same-origin compatibility, cloud/local/configured action origins and unrelated-host denial, without external network writes. Touched-file oxlint passed. An initial whole-server typecheck encountered unrelated in-progress companion test typing errors; the integrated audit report owns that final gate.

convex-test 0.0.60 omits Blob.type from emulated metadata. Legacy-image fixtures explicitly restore it; production MIME validation remains active. HTTP admissions record their trusted transport Content-Type for optional missing system metadata.

These results prove isolated handler authorization/transport, not a deployed schema, native installer, real account, or browser upload. This slice touched no live local Convex process or production data.

## Public URL boundary and remaining limits

Convex `storage.getUrl()` returns a bearer URL: anyone already holding it can fetch without another app authorization check, even after membership changes. This fix does **not** revoke previously issued URLs or downloaded copies. Official [storage security documentation](https://docs.convex.dev/file-storage/overview) and [serving-files guidance](https://docs.convex.dev/file-storage/serve-files) explain deletion/reupload revocation and HTTP actions for per-request checks. Deleting shared blobs would break authorized references. Private-file byte serving with per-request authorization and reviewed rotation of exposed URLs remain separate work.

Source lookup inspects at most 100 admission scopes and 100 references per legacy table. If the only authorized source is later, new cross-scope reuse fails closed with an upload-again message. Existing reads and exact indexed destination-scope checks still work. This is an availability limit; large-sharing acceptance is not claimed.
