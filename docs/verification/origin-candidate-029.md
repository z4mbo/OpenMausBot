# Origin 0.2.9 candidate

Version 0.2.9 carries the public invitation and acceptance changes originally prepared for 0.2.8, the reported desktop account/computer overlap correction and optional centrally configured Brevo transport. It requires fresh exact-source CI, Windows/Mac packages, website image and publication checks. Public 0.2.7 remains the verified baseline until those checks and rollout finish.

## Changes and proof

- Public invitation addresses, backend affinity, persistent acceptance and truthful mail delivery statuses are described in the [invitation report](origin-invitations.md). Its five bug scenarios and isolated before/after evidence remain applicable; copied public URLs are established by the browser and clipboard helper tests, with native clipboard acceptance qualified separately.
- Header fix `c1210a4f3` separates the account and computer controls from the desktop title bar and constrains the shared popover width. A forty-character account formerly overlapped the computer control. The unchanged final DOM regression fails all twelve cases on frozen 0.2.8 and passes all twelve after correction. The [header report](sidebar-header-fit.md) records actual browser measurements and matched images; the desktop bridge remains synthetic.
- Test-only correction `1d326fbb6` fixes the proven cross-drive Windows Vite fixture failure while preserving strict status/body requirements. See [CI recovery](origin-ci-recovery.md).
- Feature `fc00c55f3` adds explicitly selected Brevo transport and protects its key from agent child processes. Resend remains the default. Fake transports establish request shape, configuration failure, bounded timeout and secret handling. No provider account, domain authentication, key activation or recipient delivery is implied by those tests.

The current shared changelog has four user-facing entries and preserves published 0.2.7 history. The unshipped 0.2.8 tag preserves its own historical source; it is not represented as a published release.

## Held 0.2.8 outputs

Frozen source `63c38a2cf5e22166efafb7e727b562988e5b084c`, tag `origin-v0.2.8`, built successfully in [native run 39122300158](https://github.com/z4mbo/Origin/actions/runs/39122300158). Numeric GitHub draft `416411426` contains fifteen verified assets. Its distribution has thirteen payloads, 1,947,886,614 payload bytes and 1,947,890,038 total asset bytes. The manifest SHA-256 is `f0165f40455de8b73a5b2f062de0df83901db4378e53bc00d17f05ec0ab02d24`; checksums SHA-256 is `9d59d80fd6a4751f97e4855389fa4e05baf749d446f9199c87d833c31cc5ddf5`.

Those assets and the private 0.2.8 site image passed staging checks only. No 0.2.8 feed promotion, public GitHub release, backend deployment, migration or website promotion occurred, and no deployment key was issued for it. They cannot be relabelled as 0.2.9. Its private compiled-site preview was stopped after its own qualified sixteen browser checks.

## Local and delivery gates

Current integrated checks pass all 5,957 client/shared tests across 561 files in 378.96 seconds, both required application/server TypeScript commands, backend and site TypeScript, full lint, locale generation, fourteen site tests and 175 backend tests across nineteen files. The six touched server/shared suites pass 483 tests with five existing skips; nine guard/release/deployment suites pass 121 tests. The Vite/private-file and documentation suites separately passed 53 checks after integration; the final documentation check passes all seven cases after evidence assembly. The [sanitized checkpoint](evidence/origin-candidate-029.json) retains command names and raw-log identities. Exact hosted/native sources and public rollout will be recorded after verification.

Mail account setup awaits the user's action-time agreement approval. The existing Resend account requires a paid upgrade for another domain; no purchase was authorized. A free Brevo signup form is prepared, without creating the account or accepting its terms. Email invitations retain a usable copy/share path and report when the provider is unconfigured. Real external recipients require an explicitly supplied recipient. No synthetic test sends real mail.

Publication follows the [authorized delivery goal](origin-delivery-goal.md) and [documented release process](origin-delivery.md), using fresh backup and exact-source inputs. The review PR stays open; task PR merges still require the person. Windows signing, Mac notarization/manual updates and physical/provider/TURN acceptance retain their stated limitations.
