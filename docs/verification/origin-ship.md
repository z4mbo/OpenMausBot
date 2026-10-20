# Ship: deploys, previews and releases

Ship runs against the real Convex functions of `backend/convex`, held in memory
by convex-test (`scripts/testing/origin-campaigns-backend.ts`), and against
loopback stand-ins for the Vercel, Cloudflare Pages and GitHub APIs
(`scripts/testing/origin-ship-providers.ts`). The launcher passes only a
loopback `OMB_SHIP_PROVIDER_URL` into the disposable server, so the fixture's
provider tokens, written to its own data folder, never leave this computer and
no real deployment, tag or post is made.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-ship.ts
```

It seeds one project linked to `acme/launch` with three targets (Vercel "Web",
Cloudflare Pages "Docs" and the GitHub Actions workflow "Mobile build"), an
owner and a viewer, then prints `previewUrl`. Drive it from a second terminal:

```sh
node scripts/testing/check-origin-ship.mjs <previewUrl> docs/verification/evidence/origin-ship
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers 1280 px dark and light,
375 px dark, and a viewer:

- each target shows its deployments with state, commit, branch and age, the
  one serving production marked Live, the production address, and Promote,
  Redeploy or Roll back only where the provider allows it;
- Ask Atlas to ship sends the Chief a brief naming `origin_release_draft` and
  the Web target;
- Draft release suggests v1.4.0 from the four pull requests merged since
  v1.3.2 (a feature bumps the minor version) and leaves out older ones;
  approving lists its steps first, then tags the release on GitHub, deploys
  Web with the member's own token and drafts the Broadcast announcement,
  which still waits for approval;
- a Cloudflare roll back and a workflow run ask first, and live polling shows
  the new deployments turn Ready and Live without a reload;
- the pull request card in chat links the PR's Vercel preview;
- a viewer sees deployments and releases but no deploy, release or target
  controls, and nothing scrolls sideways at 375 px.

Stop the launcher with Ctrl-C so it removes its temporary data.

The cheap-model release notes, the Chief-only agent tools and the approval
gate are covered by `server/ship/ship.test.ts`, `server/auto-approve.test.ts`
and `shared/outbound.test.ts`; the Convex rules by `backend/convex/ship.test.ts`.
