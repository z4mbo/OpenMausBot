# Windows Electron fixture correction

Commit: `01685a95a72573a8009478fb79e1763a3c2f25e3` on `codex/origin-dialog-focus`, worktree `<local-user>\.codex\worktrees\origin-dialog-followup\Origin`. The commit changes **only**:

- `electron/cloud-sync-main.node-test.mjs`
- `electron/cloud-sync.node-test.mjs`
- `electron/cloud-sync-scan.node-test.mjs`

The first two fixtures now use a synthetic home and native filesystem path semantics. The main fixture separately retains broad-home and app-data refusal checks, one-use token assertions and exact chosen-folder behavior. Production privacy/hierarchy guards remain unchanged. The scanner fixture injects one exact nested-directory `EACCES` through a temporary builtin filesystem mock, checks propagation rather than empty-state interpretation, and restores the ESM binding in `finally`. It does not depend on chmod permissions or skip any platform.

Original CI evidence: `<local-user>\Documents\Origin-bugfix\.omb-scratch\pr-ci-025-readiness-windows-shard1.log:3504` onward (main fixture refusal, permission-test missing rejection and seven service cases). The corresponding Ubuntu cases passed in the retained Ubuntu shard log.

Local reproduction before edits: `electron-files-windows-red.log`: **15 tests, 5 pass, 10 fail**. All nine CI failures reproduce; the tenth is an existing file-symlink test denied by this local Windows token (`EPERM`). That symlink case passed in CI and was left unchanged.

After edits: `electron-files-nine-green.log`: **all nine corrected cases pass, zero skips**. The full three-file run is **14 pass/1 fail**, with only the unchanged local symlink privilege failure (`electron-files-windows-green.log`). Touched oxlint and whitespace checks pass.

The full Electron suite ran (`electron-full-after-fixtures.log`): **802 tests, 783 pass, 15 existing skips, four failures**. Two are the unchanged local file-symlink privilege failures in scanner/engine tests. Two AppImage cases initially lacked `mv` on this shell's PATH. After verifying the existing `C:\Program Files\Git\usr\bin\mv.exe`, both affected AppImage cases pass once with only that directory added to the child test PATH (`electron-appimage-with-git-path.log`: **2/2, zero skips**). Machine PATH, symlink permissions, tools and test bodies were not changed for those environment limitations. The full suite is not claimed green locally.

No runtime code, CI configuration, push, deployment, skipped tests or retry behavior changed. The worktree is clean after commit. The commit can be cherry-picked independently of the preceding three UI commits because it touches only the Electron test files above.
