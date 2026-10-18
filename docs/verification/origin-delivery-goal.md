# Origin inspection and online delivery

The user expanded the active goal on 2026-10-17: after the deep inspection, update everything and push online. This supersedes the earlier restriction against deployment. The active goal remains unfinished until inspection, verification and delivery are complete.

On 2026-10-18 the user requested continued productive iterations until the weekly usage allowance is exhausted, and a visible app preview with explanations of changes while work proceeds. Finish each verified release before beginning the next improvement cycle. Do not manufacture activity to consume usage, purchase credits, or use an account reset. Keep the goal active across completed release cycles while allowance remains.

After the weekly allowance ended, the user explicitly authorized existing credits and requested fixing failed CI and completing website, Mac and Windows publication. This supersedes the allowance stop condition. Continue that delivery with visible app previews; do not purchase credits or use an account reset.

## Required outcome

- Inspect the complete monorepo, including concurrent main-checkout changes read-only, with specialist agents working in waves.
- Prove and fix real security, data integrity, authorization, concurrency and UI/UX defects. Keep logical commits and practical regression tests.
- Inspect populated screens in real browsers using isolated fixtures, including mobile, light/dark themes, keyboard access and failure states. Record before/after evidence and distinguish mocked checks from native or production acceptance.
- Keep README, shared release history, in-app What's New, website history and desktop updater release notes aligned with each version.
- Run the required TypeScript, client/shared, guard, backend and touched server tests, plus applicable lint, website and packaging checks.
- Push GitHub changes and open the review PR against `origin-integration`.
- Build and publish matching Windows and macOS downloads and updater feeds, deploy the landing page and required backend changes through the documented release process, and verify public versions, links and artifact hashes.
- Record every adopted or deferred upstream OpenMausBot PR. Continue the daily review at 06:00 Europe/Rome, staying quiet when unchanged.
- Finish with bug scenarios, severity, source locations, fix commits, UI evidence, delivery results and explicit remaining limitations.
- Keep isolated, synthetic app previews visible while working. Show before/after images for visible changes and explain their effect; keep those fixtures separate from automated-test fixtures and personal data.

## Isolation and authority

Implementation stays in `C:\Users\aless\Documents\Origin-bugfix` on `bugfix/scan`. Do not edit the concurrent main checkout, touch its servers on ports 5199/8799, or change its local Convex process. Never test mutations against production or personal data. Deployment authorization does not authorize merging task PRs without the person's approval or overwriting another person's changes.

Production delivery follows local verification and uses the repository's release/deployment commands. Preserve backups and report unavailable credentials, failed checks or missing platform acceptance honestly. Do not describe source changes, CI artifacts or synthetic browser fixtures as a completed public release.
