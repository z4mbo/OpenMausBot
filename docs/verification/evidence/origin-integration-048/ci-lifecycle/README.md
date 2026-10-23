# Isolated fixture lifecycle corrections

The [CI diagnosis](../ci/README.md) records the failed 0.3.2 shards. These changes affect four test/fixture files; product code and its active-work refusal are unchanged.

The deterministic [rename red run](room-rename-red.log) holds the Chief's resume after recipient movement revokes the child assignment. The former immediate rename returns 409. The fixture now asserts that refusal, releases the resumed Chief, waits for coordinator settlement and bot/task idle, then renames or deletes/recreates the team. Existing withheld-result and private transcript assertions remain.

The card-answerer fixture now selects a probed harness/webhook pair below the usual ephemeral range. It retries at most three times only for EADDRINUSE from its own launched child, awaits that child's close, and requires its listening line before accepting health. Synthetic checks prove asynchronous teardown before relaunch, no retry for other errors, and bounded cleanup after repeated collisions.

The [focused green run](focused-green.log) passed two actual isolated room scenarios and three retry/teardown checks. Forty unrelated room cases were filtered; the seven existing POSIX card cases are platform-skipped on Windows and require Linux CI acceptance. [Server TypeScript](server-typecheck.log), [owned lint](owned-lint.log), and owned diff checks passed. No timeout, product authorization, active-work guard or test-skip policy changed.

[Source hashes](source-files.json) bind the verified bytes of root commits `77c8b4c77` (room ordering) and `2ab64717d` (card binding). [Report](report.json) separates CI evidence, local checks and remaining platform acceptance. No production data or services were used. The manifest binds the sanitized copies; original ignored-log hashes remain as provenance.
