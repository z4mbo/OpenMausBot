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
npx.cmd vitest run --root backend backend/convex/pipelineSales.test.ts backend/convex/pipeline.test.ts backend/convex/pipelineRevenue.test.ts
```

The check mutates the fixture: launch a fresh one for it, and another for
`scripts/testing/check-origin-pipeline.mjs`. Stop the launcher with Ctrl+C.

## What it proves

- The inbox lists every conversation newest first with unread counts, agent
  drafts to approve and won deals to confirm; opening one clears its unread
  reply; a reply goes out on the channel the contact last wrote on.
- The inbox files the project's older contacts once, then shows one page of
  conversations and loads older pages past it. `j` and `k` move through them,
  `r` jumps to the reply, `s` snoozes, `e` archives; snoozed and archived
  conversations come back from their folders, and one is assigned to a member.
- An agent's draft is edited and approved inside the conversation; an agent's
  "won" changes nothing until a person confirms it there.
- A template fills the reply with the contact's details; Suggest asks the quick
  model with the brand voice and the conversation framed as data, and the reply
  is sent through the loopback Brevo.
- Contacts that share a phone number merge with their history, and every
  notification still opens the contact that stays; filters save as
  a shared view; selected contacts are tagged, assigned, started on a sequence
  and exported as CSV.
- The capture dialog documents the public API and webhook address and shows
  when it last captured.
- A deal gets products and a Stripe payment link sent by email. A signed
  `checkout.session.completed` posted to the real `/pipeline/stripe` HTTP action
  marks it won live for what was paid, once; a repeat changes nothing. Sales
  settings show the webhook address and that the signing secret is stored,
  sealed with `ORIGIN_SEALING_KEY`. A deal is lost with its reason, the won
  totals add up, and a deal in dollars is summed apart, never converted.
- The deal coach asks the quick model (the fake engine) with the deal, its
  timeline framed as data and the brand voice; it names the next step and the
  risk, keeps the answer on the deal, and its follow-up is sent through Brevo.
  Agents ask it with `origin_pipeline_deal` action `coach`.
- Inbox, conversation, contacts, deals and the deal drawer at 375 and 1280 px,
  dark and light, without sideways scrolling; a viewer cannot reply or approve.

Screenshots and `report.json` are in
[evidence/origin-sales](evidence/origin-sales/).
