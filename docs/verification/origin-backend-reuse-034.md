# Convex backend reuse and evidence integrity — 034

Read-only verification at source
`ec60e5a8aa578c021132c5053d6bd5f0448bbbab` finds no Convex source change
requiring another deployment. Published backend source
`697e9f0adacd7d90af9b3f190ab5c4df978b48f1` has the same backend tree,
all 94 backend files, 85 parsed source roots and 87 files in their resolved
import/dependency closure. The two shared dependencies are
`shared/origin-columns.ts` and `shared/origin-site-address.ts`.

All 100 compared source, dependency and build/deployment metadata bindings
match. The only normalization is the root package version from the previous
release to 0.2.13; every other package field remains equal. Optional metadata
presence is also checked. There are no unresolved or nonliteral imports in
the inspected closure. The existing 033 AST verifier's backend prefix was
reused with the explicit source and expected version; no new framework or
backend test run was introduced.

The [source-bound report](evidence/origin-backend-reuse-034/report.json)
retains every comparison hash, Git blob and byte length, the AST edges and
the verifier hashes. A later final freeze can reuse this result by comparing
that complete input set and the backend tree, with the same version-only
normalization and optional metadata checks. If any input differs, review
that change before reusing the result.

This is a source comparison, not a fresh production probe. The original
030 and 031 delivery receipt bytes are identical, preserving their original
deployment, migration, mail and key-removal timestamps. No credential,
secret phase, live Convex process or deployment was accessed. Bundled Node
server fixes, native packages and website changes still require their own
delivery and acceptance evidence.

## Committed evidence verification

The branding [artifact manifest](evidence/origin-branding-034/artifact-manifest.json)
has current SHA-256
`2a3b6a67f4c6918f79385a9dd63638356110f6832470c50671556d4fafaf69fa`.
All 63 listed payloads match their committed Git blob hashes and byte lengths;
every payload in that directory is listed. The manifest itself is the index,
not a payload claiming its own hash.

The landing [manifest](evidence/origin-landing-capture-034/manifest.json)
has SHA-256
`d33019c643c6482b666269fdc2438d1a213c47429c93e045063c03fb2f440c83`.
Its eight committed payloads also match every hash and byte length, with
complete directory coverage. All three website WebP assets equal the
captured derivatives byte for byte. The seven captured frontend Git blobs
remain identical at the inspected integration source. This preserves the
capture's synthetic-renderer boundary; it does not establish native GUI or
production acceptance.

## Historical branding snapshot

The captured [source snapshot](evidence/origin-branding-034/source-snapshot.json)
is an earlier checkpoint. Its recorded artifact-manifest hash beginning
`06466dd6` and its recorded self-reference are historical values, not the
current manifest or a current self-hash assertion. Later compatibility
proof and manifest refreshes do not rewrite that capture. Its raw source
hashes can also differ from committed blobs through text normalization or
subsequent edits; those differences are not a semantic change count.

Use the current 63-payload artifact manifest and this source-bound report
for present integrity checks. The captured snapshot, screenshots and
original receipts remain unchanged. No broad test suite was repeated for
this comparison.
