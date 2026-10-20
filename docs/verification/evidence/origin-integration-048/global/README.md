# Combined-source local checks

The [receipt](receipt.json) binds all eight successful checks to clean source `6d1c772d121d557e9742e71da8102f453d9e336f`: TypeScript project build, server TypeScript, lint, release/locale checks, Electron syntax, required guards, and the complete client/shared suite (609 files, 6,275 tests). Runtime source hashes match before and after. The full suite is qualified to that source, not to future documentation or fixture commits.

Four UI/test files subsequently changed in commits `d03d8ddf8c78443f74d5c6ef07936b27d0651a26`, `ccb65fbab1dbfc5261b9bc6ae9b234448157a3d9` and `86b9326afd81d277117ec953b7a9b70caed07d07`. Their focused browser/test evidence is in [UI](../ui/README.md). Root ran the exact `tsc -b` project build after those changes (session 36576, exit 0); its empty successful log is retained separately. Later server fixture corrections have their own [CI evidence](../ci/README.md). Final source workflows are a separate delivery gate.

The [baseline observation](baseline-040.json) is a read-only receipt taken before delivery. It records public 0.4.0 and the refusal to execute superseded 0.3.2 operators. No production application rows were read or mutated. A future execution must freshly check that baseline; this historical observation does not authorize operations.

The manifest records original and sanitized hashes. Logs contain synthetic test data. No provider account, recipient email, physical Mac installation, production acceptance, release publication or deployment is established by these checks.
