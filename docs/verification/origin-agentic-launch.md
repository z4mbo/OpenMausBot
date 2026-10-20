# A Chief runs a launch with a cheap real model

One real model turn, everything else isolated. The real Convex functions of
`backend/convex` run in memory (convex-test over the HTTP wire), fal.ai is a
loopback fake that `OMB_FAL_QUEUE_URL` points Studio at, and the server is the
live tier's hermetic one (temporary data dir and home, loopback ports). The
only thing that leaves the machine is the model call itself. Nothing is
posted: Broadcast has no channel keys and the post stays a draft.

```sh
node --experimental-strip-types scripts/verify-origin-agentic-launch.ts \
  --cli <absolute path to the Claude Code CLI> \
  --config-dir <absolute path to a signed-in Claude config folder>
```

`--model` defaults to `claude-haiku-5-5`; the script refuses anything but a
Claude Haiku or GPT Luna model. The Chief "Atlas" is linked to the project
"Origin Lite" and asked to make a launch image, draft a post that uses it and
add a lead. The script exits non-zero unless, through the real tools:

- Studio sent at least one request to the fake fal queue with the fixture key,
  and a generation by Atlas exists;
- a Broadcast post by Atlas is a draft waiting for a person's approval;
- Grace Hopper is a Pipeline lead.

It writes `docs/verification/evidence/origin-agentic-launch/report.json` with
every tool call (input, output, ok), the fal requests, the generations, posts
and leads, and the Chief's reply. A run takes about 30 seconds and a few cents.
