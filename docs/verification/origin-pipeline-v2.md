# Pipeline replies, stages, sequences and scoring

The fixture mounts the production `PipelinePage` against the real functions of
`backend/convex`, run in memory by convex-test (`scripts/testing/origin-campaigns-backend.ts`),
and a disposable `launchVerificationServer` whose Brevo and Twilio requests go to a
loopback stand-in (`OMB_PIPELINE_PROVIDER_URL`). Inbound messages are delivered to the
real `/pipeline/twilio` and `/pipeline/brevo` HTTP actions, signed with the fixture's
synthetic Twilio auth token or carrying its Brevo secret. Nothing reaches Convex
deployments, Brevo or Twilio.

## Reproduce

```powershell
node --experimental-strip-types scripts/verify-origin-pipeline.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-pipeline.mjs http://127.0.0.1:PRINTED_PORT/__origin-pipeline.html
npx.cmd vitest run shared/origin-pipeline-score.test.ts server/origin-pipeline.test.ts src/components/origin-pipeline
npx.cmd vitest run --root backend backend/convex/pipeline.test.ts backend/convex/pipelineInbound.test.ts
```

The check mutates the fixture, so launch a fresh one for each run. Stop the launcher
with Ctrl+C.

## What it proves

- A signed Twilio SMS and a Brevo reply land on their leads' timelines as unread,
  filter the board under Replies, and notify the lead's owner in the Inbox; opening
  the lead clears it.
- An agent's drafted email is edited, approved and sent with the project's reply-to
  address.
- An agent's sequence drafts its due step for approval, turns a due call task into
  the lead's next step, pauses and resumes; a person's sequence stops when the lead
  replies on WhatsApp.
- The table sorts by score and shows next-action chips; the drawer explains the score.
- Stages are renamed, removed with their leads reassigned, added and reordered.
- Webhook addresses and the Brevo secret show to editors only, at 375 and 1280 px,
  dark and light.

Screenshots and `report.json` are in
[evidence/origin-pipeline-v2](evidence/origin-pipeline-v2/).
