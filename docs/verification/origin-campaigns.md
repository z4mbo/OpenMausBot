# Campaigns in Broadcast

Campaigns run against the real Convex functions of `backend/convex`, held in
memory by convex-test and served over the HTTP wire `ConvexHttpClient` speaks.
The fixture's Origin session points at that backend, so the metrics route of
the disposable server reads and writes it like a deployment. Nothing reaches
the network: X has no keys in the fixture and no Bluesky post is published.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-campaigns.ts
```

It seeds one project with posts (published, scheduled, an agent draft),
Studio generations, three captured leads (two carry the campaign's
`utm_campaign`, one another campaign's), issues and a "Spring launch"
campaign, then prints `previewUrl`. Drive it from a second terminal:

```sh
node scripts/testing/check-origin-campaigns.mjs <previewUrl> docs/verification/evidence/origin-campaigns
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers 1280 px dark and light
and 375 px dark, and a viewer:

- the campaign list and detail: brief, utm tag, stat tiles, the timeline with
  per-channel state and X numbers, the content gallery, leads by stage (the
  other campaign's lead is not attributed) and issues;
- Refresh calls `/api/origin/campaigns/metrics`, which reads the campaign from
  the backend and reports that X is not connected; LinkedIn is named as
  unread;
- Plan with the Chief sends the brief into its chat;
- lead, issue and content links open Pipeline with the lead, Issues with the
  issue, and Studio; a timeline post opens the Broadcast composer;
- linking an issue, moving to Running and creating a campaign (with the
  utm preview and the date-order check) write through the backend;
- a viewer sees no create, link or plan controls.

Stop the launcher with Ctrl-C so it removes its temporary data.
