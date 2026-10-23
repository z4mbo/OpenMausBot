# Remaining 0.3.2 CI failures and bounded 0.4.1 correction

Workflow **39381788335 failed**. These receipts cover its four failing Linux/Windows Vitest shards, the reproduced direct-delegation fixture contradiction, and its focused correction. They do not claim a passing full 0.3.2 run or fresh full 0.4.1 acceptance.

| Job | Platform/shard | Result | Concrete failure |
| --- | --- | --- | --- |
| 118493171061 | Linux 2 | 1 failed, 4970 passed, 15 skipped | Original-child fixture expected default follow-up to reuse an explicitly independent `thread:"new"` job. |
| 118493171187 | Linux 3 | 5074 passed, 29 skipped; one suite failed | Card-answerer server failed to bind 34930 (`EADDRINUSE`), so seven suite tests never reached assertions. |
| 118493171051 | Windows 2 | 1 failed, 4862 passed, 123 skipped | Same original-child identity assertion as Linux. |
| 118493171145 | Windows 4 | 1 failed, 4933 passed, 145 skipped | Team rename returned 409 while revocation could resume a supervising Chief; the fixture had polled only bot-level busy before revocation. |

The reviewed PR source was `5aafbf02ab2ded075d2c75955419f35a45cce99a`; workflow logs show merge `2043883b7fb739692c1b8fd7c7d0f7c6d5ac858d` into the existing integration base. The merge object was unavailable locally, so merge-tree equality is not asserted. The relevant allocation and failing fixture files were unchanged at reviewed 0.4.1 commit `86b9326afd81d277117ec953b7a9b70caed07d07`.

The direct-delegation scenario reproduced the exact failure on current 0.4.1 using the real isolated server and controlled fake engine. Runtime allocation correctly distinguishes a normal canonical project delegation (`kind:"work", continuity:true`) from an explicitly new independent job (`continuity:false`). The corrected scenario starts with a normal delegation and retains every private-chat/context assertion. The separate explicit-new real case now verifies that later default work receives a different canonical child while the independent transcript and selected direct chat remain unchanged. Helper coverage includes both unnamed and named fresh jobs, legacy marker boundaries, parent/room scope, conflicting canonical links, and folder guards.

Correction commit `0baf67f27` changes the two test files only. Focused real fixtures: **3 passed**, 39 deselected; allocation helper: **21 passed**; targeted oxlint with warnings denied and `git diff --check`: passed. The red run had one failure, 41 deselected. No runtime allocation rule or assertion was weakened. The backend lane owns the separate port and room-rename fixture repairs; `windows032-review.json` is its read-only diagnosis, not proof of those future repairs.

`receipt.json` records exact source fingerprints, original private-log hashes, bounded excerpt line ranges, and evidence limits. Raw CI logs remain ignored. Archived excerpts include only failures and totals; ANSI controls and the isolated worktree prefix are removed. The empty `final-ui-tsc-build.log` is the parent's reported client `tsc -b` exit 0 at `86b9326...`, session 36576; this lane verified its empty bytes and did not rerun that check.

No live provider, production data, protected development ports, native app GUI, macOS runtime, installation, push, tag, or publication was exercised by this lane. `manifest.json` hashes every retained file except itself.
