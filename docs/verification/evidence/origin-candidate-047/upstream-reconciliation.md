# Upstream fit after combining Origin source

Comparison target: frozen Origin `3e6f5c3b563efad735d2b4773347174f7492655e`. This supplements the immutable October20 review through `2026-10-20T04:03:12Z`; it does not rewrite its earlier36 dispositions against the older Origin source.

The concurrent0.3.0 branch already brought source adaptations for five of the eight targeted suggestions:

| Upstream change | Present combined implementation | Acceptance boundary |
| --- | --- | --- |
| [#3097](https://github.com/milind-soni/OpenMausBot/pull/3097), OpenRouter free-tier setup | `server/drivers/openrouter-free.ts` detects the key tier, labels free choices, chooses a free tool-capable default and maps credit/privacy refusals. | Synthetic OpenRouter/free/catalog tests pass. Real catalog availability and current free-tier terms are not asserted. Unsupported/unpriced API models still fail closed under a daily cap. |
| [#3127](https://github.com/milind-soni/OpenMausBot/pull/3127), bounded SSE replay | `server/host/sse-replay.ts` retains500 frames and an8,000,000-character target, accounting separately for client serialization and retained payload. | Source/helper tests; newest oversize frame is retained deliberately, so this is not a strict process-memory-byte cap. |
| [#3129](https://github.com/milind-soni/OpenMausBot/pull/3129), smaller private native logs | `server/drivers/native.ts` replaces large inline image/base64 payloads with length markers before credential redaction. | Synthetic log tests; no claim that every arbitrary secret or undocumented vendor shape is recognized. |
| [#3130](https://github.com/milind-soni/OpenMausBot/pull/3130), serialize queued log events once | `server/harness/bus.ts` queues its redacted serialized line and persists that line rather than reserializing the event. | Queue/order tests; no measured production performance claim. |
| [#3132](https://github.com/milind-soni/OpenMausBot/pull/3132), idle transcript cache eviction | `server/thread-cache.ts` and Store reload inactive transcripts from the message database while preserving its reported busy set. | Cache/helper tests. Full hosted/offline/crash recovery acceptance remains separate from this helper proof. |

A fresh six-file suite on the frozen combined source passed96 tests at2026-10-20 07:35:34 Europe/Rome: OpenRouter-free, OpenAI-compatible catalog, native logs, harness bus, thread cache and SSE replay. These are source adaptations brought through the concurrent branch, not a claim that five complete upstream patches are byte-equivalent or newly implemented by this review.

The remaining direct feature candidates are [#3090 HTML attachment previews](https://github.com/milind-soni/OpenMausBot/pull/3090) and [#3095 ready-made bot templates](https://github.com/milind-soni/OpenMausBot/pull/3095). HTML preview should preserve Origin attachment permissions, a sandbox/CSP, bounded reads, cancellation and keyboard focus. Templates should create project specialists under the correct Chief without duplicate bosses. [#3124 MCP over loopback HTTP](https://github.com/milind-soni/OpenMausBot/pull/3124) remains a separate transport/security migration, with capability/host confinement and cancellation acceptance before adoption.

Keep one upstream change per adaptation commit, retain its PR/merge source and dependency map, test against Origin-specific access/sender/lease rules, then run a finite isolated browser/native check. Never wholesale-merge upstream release/versioning, cloud subscriptions or authority policy into Origin. Re-evaluate a deferred suggestion against the current source before implementing it: this reconciliation demonstrates why stale absence claims create duplicate work.
