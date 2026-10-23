# Candidate 050 evidence

This is a curated integration record for proposed Origin 0.7.2. Published baseline is Origin 0.7.1 (`fa83fb6b9e7e6e7e8195e93405a975007917872a`). Final source freeze, exact-source CI, desktop builds, package audit and production delivery remain pending. Old 049 delivery operators remain held.

`manifest.json` hashes raw archive bytes (excluding itself). The `.gitattributes` entry uses `-text -whitespace` to prevent evidence normalization. Original source paths/hashes are retained for copied files. The upstream Markdown removes only one very long transient git-status paragraph; the complete 45-row ledger and JSON are retained, without PR patch dumps.

Historical receipts deliberately keep their original uncommitted/pending fields. Root subsequently committed the integration as `dc652c11a0ce37331aff8a35810a9c86c6162e35`, Claude fix as `0021fb7c1510273f6f5e362baa67a6ce526835d0`, Usage fix as `b13f328a96a16c17f85c1676a7da2c90d3919630`, and CI trigger as `a7636129e50107f235c889a28b13113b2b72ce93`. The source and browser supplements qualify later observations without rewriting historical receipts.

The 634-file/6,457-test client/shared result predates Usage visibility changes; four focused suites/28 tests passed afterwards. Backend42 files/333 tests and its typecheck passed. Server101/backend24 focused checks are reported in `reports/host-review.md`; their individual raw logs were not saved, so none are fabricated here. Claude adoption has465 distinct passing tests and5 existing skips, plus three actual isolated HTTP checks through the fake CLI, with owned-process/data cleanup. It did not use real provider credentials. Blank typecheck/lint logs contain no success text; exit status is reported by the owning agent/receipt.

Browser screenshots were captured and interpreted by root using isolated synthetic fixtures. `receipts/root-browser-supplement.json` records those facts and limitations. Publish's actual isolated Draft Save is evidenced; current Publish images are after-only, and the separate renderer matched before/after fixture remains pending. These images do not prove every feature, all themes, real outbound publishing, packaged applications or production behavior.

The archived `3177-live-fixture.mjs` is the exact original source recipe and contains an explicitly synthetic key. Its relative imports assume its original `.omb-scratch/reconciliation-050` location; the archived copy is evidence, not a standalone runnable launcher. No key material, environments, full upstream patches, production backups or application rows are archived.

Cleanup evidence records one completed, authorized private-cache operation:33 exact payload unlinks, retained local copies stable, protected closure/images/0.7.1 feeds unchanged, final free space6,537,908,224 bytes. Its immutable intent and streaming outcomes are retained; automatic replay is false. It is not a release or permission for another cleanup.

Root may add the remaining renderer captures and final frozen references before committing; any archive edit must regenerate `manifest.json` from the actual bytes. No acceptance result should be inferred from an unfilled final delivery gate.
