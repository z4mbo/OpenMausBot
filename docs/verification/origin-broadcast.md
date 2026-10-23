# Publish: previews, reels, accounts and the month calendar

The Publish page (section id `broadcast`) runs in an isolated page against a
disposable fake-engine server. The project's posts and assets come from an in-page stand-in for the
Origin backend (`scripts/testing/origin-broadcast-cloud.ts`); the accounts the
composer can post as come from the real server's accounts route, reading
synthetic keys the launcher writes into the disposable data folder. The reel's
video is recorded from a canvas inside the page, so nothing is fetched from the
network and no social account is touched.

Start the fixture in one terminal:

```sh
node --experimental-strip-types scripts/verify-origin-broadcast.ts
```

It prints `previewUrl`. Drive it from a second terminal:

```sh
node scripts/testing/check-origin-broadcast.mjs <previewUrl> docs/verification/evidence/origin-broadcast
```

Set `OMB_VERIFY_PLAYWRIGHT` to Playwright's `index.mjs` when it is not
resolvable from the repository root. The check covers 1280 px and 375 px, dark
and light, and a viewer:

- the week view with media thumbnails, the accounts strip (X has a main and a
  Founder account, TikTok a Founder account, LinkedIn is offered to connect)
  and the overview's approvals tile, which opens the list on the posts to
  approve; an agent's draft cannot be scheduled until approved;
- the post composer: choosing the Founder account for X, adding a hashtag,
  picking an image, the X, LinkedIn (folded caption) and Instagram previews,
  the 280-character limit, a best time from the measured X posts (Tuesday
  09:00), and the saved variants carrying the chosen account;
- a reel: Bluesky is off, one Studio video is required, a cover frame between
  2 and 3 seconds and a music note are saved, and the Instagram and TikTok 9:16
  previews show their safe zones, which can be hidden;
- the month calendar: at 1280 px a scheduled post is dragged to the next day
  and `broadcast:reschedule` keeps its 10:00; at 375 px a day is tapped to list
  its posts;
- a failed post shows the channel's error, and a viewer sees posts read-only.

The Month, Week and List switch sits beside the calendar range and the list
filters, icon-only at 375 px, so the header keeps one row of actions on a phone.
The 1280 px dark captures are also copied as `round5-*.png`, and the week,
composer and reel editor as `../round6/publish-*.png` beside the output folder.
Stop the launcher with Ctrl-C so it removes its temporary data.

The server side has unit tests with fake vendors only:
`server/broadcast/accounts.test.ts` (extra accounts never return a key),
`server/broadcast/scheduler.test.ts` (a post publishes with its chosen account;
an account this computer lacks fails that channel alone),
`server/broadcast/channels.test.ts` (Instagram's `thumb_offset` and TikTok's
cover timestamp), `server/broadcast/metrics.test.ts` (engagement read back for
best times) and `backend/convex/broadcast.test.ts` (reel rules, rescheduling,
recorded metrics).
