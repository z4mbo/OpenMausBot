# Connect your stack: the guided Integrations checklist

Settings, Integrations opens with a checklist of the services a project uses:
GitHub and the deploy targets Ship releases to. Each step shows whether it is
ready, whose key it uses
(yours or shared, and by whom), a link to the provider's key page, and a Check
that makes the provider's cheapest read-only call with the saved key. Saving a
key checks it at once.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-integrations.ts
```

It stands in for the workspace, its shared GitHub and the Origin session with
`scripts/testing/origin-integrations-fakes.ts`. Saving and removing keys go to
the disposable server. Drive it from a second terminal:

```sh
node scripts/testing/check-origin-integrations.mjs <previewUrl> docs/verification/evidence/origin-integrations
```

The check answers every key check itself, so no request reaches a provider. At
1280 px and 375 px, dark and light, it proves:

- 1 of 2 steps is ready, and the first unfinished one (Deploys) opens with
  Vercel's key page;
- Add key opens Netlify's form below; saving it runs the check, shows the
  rejection in the form and in the checklist, and the Deploys step stays
  unfinished until a key works;
- a working Vercel key completes Deploys and its check names the account.

Each provider's call is covered with fake vendors in
`server/integration-checks.test.ts`: the address, the auth header, the account
it reports, a rejection with the key scrubbed from the message, and an
unreachable provider. `server/integration-keys.test.ts` covers the route's
admin scope and draft fields. Stop the launcher with Ctrl-C.
