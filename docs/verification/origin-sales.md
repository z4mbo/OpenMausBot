# Sales: contacts, conversations and deals

The Sales section (the Pipeline section renamed; its ids, tables and agent tool
names are unchanged) is checked against the same isolated fixture as
[Pipeline replies, stages, sequences and scoring](origin-pipeline-v2.md):
`scripts/verify-origin-pipeline.ts` mounts the production `PipelinePage` on the
real functions of `backend/convex` run in memory by convex-test, and a
disposable `launchVerificationServer` whose Brevo, Twilio and Stripe requests
go to a loopback stand-in. The fixture's quick model is the repository's fake
engine answering one-shot calls from `FAKE_CLAUDE_TEXT_FILE`, so "Suggest" runs
the real route and prompt without a provider. Nothing reaches a Convex
deployment, Brevo, Twilio, Stripe or a model provider.

## Reproduce

```powershell
node --experimental-strip-types scripts/verify-origin-pipeline.ts
$env:OMB_VERIFY_PLAYWRIGHT = 'file:///ABSOLUTE/PATH/TO/playwright/index.mjs'
node scripts/testing/check-origin-sales.mjs http://127.0.0.1:PRINTED_PORT/__origin-pipeline.html
npx.cmd vitest run server/origin-sales.test.ts server/origin-pipeline.test.ts src/components/origin-pipeline
npx.cmd vitest run --root backend backend/convex/pipelineSales.test.ts backend/convex/pipeline.test.ts
```

The check mutates the fixture: launch a fresh one for it, and another for
`scripts/testing/check-origin-pipeline.mjs`. Stop the launcher with Ctrl+C.

## What it proves

- The inbox lists every conversation newest first with unread counts, agent
  drafts to approve and won deals to confirm; opening one clears its unread
  reply; a reply goes out on the channel the contact last wrote on.
- An agent's draft is edited and approved inside the conversation; an agent's
  "won" changes nothing until a person confirms it there.
- A template fills the reply with the contact's details; Suggest asks the quick
  model with the brand voice and the conversation framed as data, and the reply
  is sent through the loopback Brevo.
- Contacts that share a phone number merge with their history; filters save as
  a shared view; selected contacts are tagged, assigned, started on a sequence
  and exported as CSV.
- The capture dialog documents the public API and webhook address and shows
  when it last captured.
- A deal gets products and a Stripe payment link sent by email; it is won for
  what was paid once the loopback Stripe reports a completed checkout. A deal is
  lost with its reason, and the won totals add up.
- Inbox, conversation, contacts, deals and the deal drawer at 375 and 1280 px,
  dark and light, without sideways scrolling; a viewer cannot reply or approve.

Screenshots and `report.json` are in
[evidence/origin-sales](evidence/origin-sales/).
