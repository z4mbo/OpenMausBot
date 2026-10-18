# Origin CLI and service distribution boundaries

This check covers the checkout CLI, its help and recovery messages, fleet upgrade
planning, and optional Sentinel service installation. It uses isolated test homes
and recording fleet dependencies. It does not install a package, activate a native
service, or access production.

| Severity | Scenario | Before | Fix |
| --- | --- | --- | --- |
| P1 | An operator runs fleet upgrade with a registered workspace | The production executor is given `npm install -g openmausbot@latest`, followed by service restarts; non-root and dry-run modes print the same unsupported plan | Upgrade fails at planning, before package installation, executor writes or service restarts |
| P2 | A user follows setup, help or npx-cache service recovery instructions | Origin recommends installing or running the upstream application | Instructions use the Origin checkout, `pnpm install --frozen-lockfile`, `pnpm omb` and `pnpm pair` |
| P2 | Origin installs an optional Sentinel schedule while the upstream desktop app exists | The generated schedule can select the upstream app's executable and CLI instead of the invoking Origin checkout | Discovery selects only Origin desktop candidates; otherwise it keeps the invoking checkout's exact script and Node |

The fleet registry records workspace identities and ports, while its shared
service template pins the caller's exact Node and script paths. It has no checkout
revision or update policy. Installing an unrelated global package cannot safely
update this source fleet. Automatic upgrade remains unavailable; operators use the
[documented Origin source update procedure](../self-hosting.md#updating), then
restart and verify each running workspace separately.

The optional Sentinel path is `main`'s service command, `runServiceCommand`, then
`runSentinelService` when the Sentinel flag is set, and finally
`shippedSentinelCli`. Normal Electron startup does not call that discovery path.
The Mac candidates are the system and user Applications folders with Origin's
bundle and executable names. Linux keeps the configured `openmausbot` executable
under the Origin product directory. Both retain the existing bundled server CLI
filename. These follow `electron-builder.yml` and the shared product name.

The changes retain `.openmausbot` data paths, existing systemd/launchd and task
identities, wire headers, discovery paths and executable filenames where those
are compatibility contracts. Actual upstream account and mobile-app names remain
explicit vendor identities. No Origin npm package is invented.

The [report](evidence/origin-cli-distribution-034/report.json) and
[manifest](evidence/origin-cli-distribution-034/manifest.json) bind the baseline,
three logical fix commits, source hashes and retained logs:

- Four fleet regressions fail before the fix, including the executor's recorded
  npm-install argv. The selected fleet run then passes 34 tests; eight Unix-socket
  agent cases are skipped on Windows.
- Six instruction regressions fail before the fix. The selected CLI, headless,
  service, fleet and guard run passes 189 tests with five existing skips across
  20 files.
- Four Sentinel selection regressions fail before its separate fix. The selected
  service, Sentinel, instruction and size checks then pass 26 tests with one
  existing skip. They cover both apps present, upstream-only checkout fallback,
  missing app/script, and a bundle that does not advertise Sentinel.
- Server TypeScript and touched-file lint pass for the instruction and final
  Sentinel source. No timeout or retry policy changes are involved.

The service tests render actual unit files in disposable directories; they do not
run launchd, systemd or Task Scheduler. Mac ZIP paths and physical installation
remain release/native verification work. No physical Mac/Linux scheduling or
automatic fleet rollout acceptance is claimed.

From an isolated checkout with Node 24, run the focused regression files
`server/origin-cli-instructions.test.ts`, `server/fleet.test.ts`,
`server/fleet-cli.test.ts`, `server/service-unit.test.ts` and
`server/service-cli.test.ts` with Vitest. The corresponding complete selected-run
logs and each failing-before log are retained in the collection.
