# Cross-drive Vite verification fixture

The isolated HTTP fixture must exercise Vite's file-denial policy even when the repository and Windows temporary directory use different drives. CI run [39121184420](https://github.com/z4mbo/Origin/actions/runs/39121184420), attempt 1 at `16fda399b834ce24d8b895f6a082bf32030444be`, completed with only Windows shard 2 failing. Its 46-case file had 23 passes and 23 failures: the ordinary asset returned 200, but the raw-file positive and all 22 raw-file denial cases returned 404. This is a verification blocker, not evidence that private files were served.

Vite 7.3.6 constructs its raw-file static server with `sirv('/')`, resolving that root against the process working directory's drive. Its raw-file middleware removes the requested Windows drive before calling the static server. When CI runs from drive D and the fixture is on C, the resulting path is missing on D; the existence check returns 404 before the deny predicate runs. The earlier native-path correction resolves Windows short aliases but does not resolve this separate drive mismatch.

The correction in `scripts/testing/vite-private-files.test.mjs:50` constructs Vite while the isolated test worker's working directory is the fixture root, with the repository config already pinned by an absolute path. A `finally` restores the original directory immediately after construction, and the success path asserts that restoration. Vite captures its static root during construction. Production config, fixture location, denial patterns, positive 200/body assertions, negative 403/no-marker assertions, timeouts and all 46 cases are unchanged.

## Reproduction and result

The [sanitized evidence](evidence/origin-vite-private-files-cross-drive.json) retains every request/status pair and source hashes. On Node 24.21.0, the unchanged source at `63c38a2cf5e22166efafb7e727b562988e5b084c` reproduced exactly 23 failures with an owned temporary drive alias as the child working directory and a native C-drive fixture. The same source, environment and test file passed 46/46 with matching drives. After the correction, both child configurations passed 46/46. A real Vite construction failure, injected by a synthetic config plugin, also restored the original cross-drive working directory and cleaned the fixture. All owned listeners, temporary roots and drive mappings were closed or removed.

Run the isolated HTTP test from the repository root:

```sh
pnpm exec vitest run scripts/testing/vite-private-files.test.mjs
```

The test creates only marked synthetic files and chooses a free loopback port. It preserves the configured Vite defaults for environment files, certificate files and Git metadata, plus the private scratch-directory denial. It does not use an account, credential, mail provider, browser, backend or the user's preview servers. This record proves the local regression and cleanup behavior; a new hosted CI result must independently verify the integrated correction. It makes no new publication or packaged-runtime claim.
