# Origin self-hosted update channel

At baseline `c6141cbbd`, `server/update-check.ts:4` queried upstream releases.
Its version parser did not recognize Origin's `origin-v0.2.x` tags, while its
npm instruction installed the upstream product. Docker instructions pulled
the upstream image configured in `deploy/docker-compose.yml:17`.

Concrete scenario: an Origin 0.2.10 self-hosted server checks for the published
`origin-v0.2.11` release. The old checker queries a different repository, and
even an Origin response produces `available: false`. An npm installation is
offered `npm install -g openmausbot@latest`, replacing the product. This is P2.

Fix `67d5d8a26` queries Origin, accepts its canonical release tags, and keeps
held candidate tags ineligible. Docker updates build the Origin checkout.
The private npm installation has no invented replacement package or update
command; its release link remains available. The deployment recipe uses a
local Origin image and documents the same update path.

Four new regressions fail before the fix. All 19 related tests pass afterward,
including an available Origin release through the registered HTTP handler.
Server typechecking and touched lint pass. A standard isolated verification
server also returned HTTP 200 with current 0.2.12, published 0.2.11 and the
Origin release URL. Its process, listener and temporary data are absent after
cleanup. No production data was used.

The [retained report](evidence/origin-update-channel-034/report.json) and
[manifest](evidence/origin-update-channel-034/manifest.json) bind the raw logs,
HTTP result and source files. The actual public lookup is read-only; the
newer-version case uses synthetic GitHub metadata. This does not establish a
Docker build, packaged desktop update or production deployment.
