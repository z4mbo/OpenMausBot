# Candidate 045 server build and packaged smoke

The final active-worktree server emit, bundle and actual packaged-server smoke all exit **0** on Windows x64 / Node v24.21.0. [The receipt](server-build-smoke.json) records commands, timings, input/output fingerprints, critical artifact hashes and sanitized logs. The source inputs remain unchanged throughout the final run, which includes the working-folder inheritance correction and Claude broker whitespace cleanup.

The run starts at `2026-10-20T04:35:00Z`, with HEAD `2a29a82702fef4f9b3b4c2c91e52fb3af72deab4` and additional working-tree changes. Package metadata remains `0.2.15`; this verification does not create or publish a version. The sorted 770-input fingerprint is `2470ecdca2a6cb151475d97c9be2c83e258d7c5e270803e4680af107476a006b`. The final `dist-server/index.js` SHA-256 is `58c9c64067344cdf48a287e5d0c62bd803b60607c08909273715a46687a77911`.

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc -p tsconfig.server.build.json` | Pass; server JavaScript emitted into this worktree's `dist-server`. |
| `node scripts/bundle-server.mjs` | Pass; packaged entries and required resources bundled. |
| `node scripts/smoke-packaged-server.mjs` | Pass; copied outside the checkout into the script's own temporary staging/home, beneath a CommonJS parent scope and without reachable repository `node_modules`. |

The actual smoke verifies server health and the read-only search worker; all 13 spawned proxy paths; MCP initialization, health and final-frame drain; bundled CLI doctor/bots calls; an encrypted backup-worker export using synthetic fixture values; two desktop bootstrap starts using a populated compile cache; and enterprise-layer discovery. Its outer process receives an explicit environment whitelist, an owned temporary HOME and only portable Node/Windows System32 on PATH. No provider or account credentials are inherited. At `2026-10-20T04:35:52Z`, no Node process matching either owned fixture home remains, and no listener remains on the final health port `61459`. The two owned outer homes are retained privately for diagnostics.

The [initial successful build](initial-server-build/server-build-smoke.json) is retained separately with its own logs and source hashes. It predates the working-folder correction and is superseded for current-source acceptance by the final receipt above. The final receipt lists exactly two changed inputs between those runs.

This is a server-resource smoke under system Node. It does not establish installer/Electron GUI behavior, macOS/Linux native execution, browser-bundle acceptance, real provider behavior, publication or deployment. The container-launcher branch is skipped by the smoke on Windows. Only generated outputs in the active worktree and the owned fixtures were used; the frozen release worktree, protected development ports and production remain untouched.
