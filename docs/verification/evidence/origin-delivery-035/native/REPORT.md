# Native 035 actual downloaded-package audit

Result: the bounded package checks passed for Origin 0.2.13 from frozen source `1483a7d76fb092b5ef6860afc5ffb520fc4e7707`, native run `39175524797`.

The root completion marker records both download commands exiting 0 and 13 regular payload files. It was read and copied only after the root ready signal. All inspected bytes came from the fresh root `.omb-scratch/artifacts/0.2.13/{mac,windows}` downloads. No held f44 package input was used. Verified 034 helper logic was copied into this new owned audit directory and pinned to the final source; no tracked source, historical artifact or installed app was modified.

## Mac ZIP contents and identity

| Target | ZIP bytes | Entries | Selected files | Main executable |
| --- | ---: | ---: | ---: | --- |
| arm64 | 318267373 | 2479 | 7 | `Origin.app/Contents/MacOS/Origin`, Mach-O arm64 |
| x64 | 335594983 | 2479 | 7 | `Origin.app/Contents/MacOS/Origin`, Mach-O x64 |

Both ZIPs contain the exact Sentinel executable and `Origin.app/Contents/Resources/server/openmausbot.js` paths. Each actual CLI satisfies the discovery predicate by containing `--check-install`. Both Info.plist files report Origin, executable Origin, bundle ID `com.imbored.origin`, short/build version `0.2.13`, and the `origin-app` protocol. Their updater configurations use generic `https://origin.imbored.fun/downloads/` with the Origin updater cache name.

Extraction was selective and traversal-checked. Compared with the preceding helper's selection, `Resources/server/index.js` was the sole extra selected entry per Mac ZIP, for the bounded static check below. No framework, native GUI or Mac process was executed.

## ASAR source comparisons

All three actual ASARs contain `shared/product-brand.mjs` and metadata `name: origin`, `version: 0.2.13`, author name Origin and `main: electron/main.mjs`.

All **159 plain Electron .mjs/.cjs files per target**, 477 comparisons in total, match `git show 1483a7d76fb092b5ef6860afc5ffb520fc4e7707:<path>`, with CRLF-to-LF as the only normalization. The shared brand module matches the same frozen source. Per-file raw/source/normalized hashes are retained in `metadata-results.json`.

Both Mac ASAR SHA-256 values are `e08abb9691333dda29d8472a6758ac93924ddb3e062cfef9f41f8a3aadd3b04f`. Windows ASAR SHA-256 is `9f925b500624a4623ce886640f421f9677c2de9052c60805e1faa2096331e8b2`. The shared brand module's normalized SHA-256 across all targets is `9e6ee8914888bcac087623b42c5039d68c65d2224575286efc10ca975c0dd051`; Windows raw bytes differ only by CRLF.

## Restored descriptor fallback in actual JS bundles

The known `server/index.js` entry was inspected from each actual downloaded target. All three contain the emitted `cuaDescriptorPaths` helper at line 192124 and the exact array order:

`Origin`, `OpenMausBot`, `openmausbot`, `OpenGrokBot`, `opengrokbot`.

The check was limited to that named function and a bounded body pattern, with no broad chunk scan. `bundled-fallback-results.json` retains each actual bundle hash, function hash/body, order and line. This establishes that the restored case-sensitive legacy candidate is present in the shipped JS. It does not execute macOS discovery, validate a real descriptor, or extend the independent source tests into native acceptance.

## Windows actual packaged-resource execution

The downloaded Windows ZIP is 370051115 bytes with 2224 entries. The selector extracted 1049 files: actual server and browser-engine trees, ASAR, updater configuration and Origin.exe. Windows file metadata reports product/company/file description Origin, product version `0.2.13.0` and file version `0.2.13`.

The frozen `scripts/smoke-packaged-server.mjs` (SHA-256 `dec83b64bb367233668299210151f429c668f4952e1db0a42f2155acc6b0854b`) ran under Node v24.21.0 against that extracted server and browser bundle. Its outer environment was an explicit 14-variable whitelist with Windows system paths and owned HOME/USERPROFILE/APPDATA/LOCALAPPDATA/XDG/data/temp paths. No inherited provider/account credentials or owner application data were supplied. The frozen smoke creates its own further-isolated fixture environment and uses synthetic license/backup values.

The process exited **0** at `2026-10-18T23:30:35.461Z`, passing:

- Server health/read-only search without reachable node_modules.
- All 13 spawned proxy paths resolving within the package.
- Packaged MCP initialize, health, final-frame drain and clean exit.
- Packaged CLI doctor and bots calls.
- Encrypted backup worker export using the fixture password.
- Two packaged desktop-entry server starts with populated compile cache.
- Enterprise-layer discovery within the package.
- Browser discovery without installation: engine `0.36.0-omb.1`, browser access enabled by default.

Post-run evidence found no matching fixture processes and no listener on health port 53698. Frozen cleanup removed its server staging/home; three `omb-cline-mcp-*` directories remain only under this audit's owned TEMP, and the outer owned home remains retained. No optional recursive cleanup was attempted. No helper error occurred in this audit; all raw logs are retained.

## Feeds, provenance and limits

Both actual feeds report 0.2.13 and include release notes. Mac feed paths name both Origin ZIPs and both Origin DMGs; Windows names `Origin-0.2.13-setup.exe`. All three internal updater configurations point to Origin's downloads domain. The parent separately verified payload sizes/SHA-512 and eleven canonical notes. Its reported final manifest SHA-256 is `9065916484672e3997c6b4fd956a6588cf3a537af321fa357450c92bb3036b44`; checksums SHA-256 is `d1509e96e813e666dd36cb279213a6249d3fdf64ac0526ac26f9a356db450ae4`. This audit did not duplicate whole-payload hashing or verify GitHub's compressed API-archive digest.

Windows execution used actual extracted packaged server/browser resources under system Node. Origin.exe/Electron GUI, installer, installed update/rollback, browser page navigation and real provider calls were not run. Mac bytes/architecture were inspected on Windows; physical Mac execution, scheduling, signing/notarization and hardware acceptance remain unproved here. Successful resource smoke does not establish every feature or production acceptance. No commit, push, deployment, production probe, provider credential or archival mutation was performed.

The final evidence manifest binds the helpers/inputs, completion marker, extraction manifests, metadata/fallback reports, Windows version metadata, smoke command/result/log and process/port cleanup receipt. Large extracted native package trees and isolated temporary data stay in the owned audit directory; the compact delivery packet contains evidence only. The worktree remains clean at the frozen source.
