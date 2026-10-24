# Wake-phrase voice for project agents

With listening switched on for a project (the ear button in a project chat's
header, off by default), saying "ehi <project>" or "hey <project>" wakes that
project's agent. The next thing said (or what followed the name in the same
breath) is sent to it as a question, and its answer appears in the chat and is
spoken. A strip above the composer shows what the session is doing, keeps a
short running transcript and turns listening off; while you are in another
chat a pill in the sidebar shows that a project is listening.

## Voice backends

| Backend | Wake phrase | Question | Answer | Leaves the computer |
| --- | --- | --- | --- | --- |
| Local (free, default) | whisper.cpp on Windows, Apple on-device speech on macOS | same | the agent's TTS voice, else the OS voice | nothing |
| OpenAI API key | the same local engine | a GPT-Live call (`gpt-live-1`, about $0.05/min) | GPT voice, with barge-in | the call's audio, after the wake phrase |
| ChatGPT plan | — | — | — | not offered (see below) |

Idle audio is never streamed: the wake phrase is always heard by the local
engine, so wake listening needs the desktop app on Windows (x64, arm64) or
macOS, connected to this computer's own server. A remote server's page, a web
browser and Linux show the button disabled with that reason.

The ChatGPT plan cannot carry voice. OpenAI's Sign in with ChatGPT for
open-source apps covers the Responses API and lists audio input and the
transcription API as unsupported
(<https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations>).
Oh My Pi's plan-based voice reaches `chatgpt.com/backend-api/codex/realtime/calls`
while presenting itself as Codex Desktop; Origin does not do that. A project
agent can still run on the ChatGPT plan while its voice is Local.

The OpenAI key is the Live-call key (`openaiLiveKey` in the desktop secret
store, `live.key` on a server); it never reaches the renderer or a call
response. whisper.cpp's provenance and pinned digests are in
[`third_party/whisper.cpp/README.md`](../../third_party/whisper.cpp/README.md).

## Checks

```sh
pnpm exec vitest run src/lib/voice src/components/voice shared/speech-text.test.ts
pnpm exec vitest run scripts/testing/voice-wake.e2e.test.ts
node --test electron/local-voice.node-test.mjs electron/capabilities.node-test.mjs
pnpm smoke:local-voice    # Windows only: downloads about 69 MB into a temp directory
pnpm typecheck
pnpm i18n:check
```

- Unit tests pin the wake-phrase matcher (Italian and English wake words,
  mis-heard names, multi-word names, questions in the same breath, short names
  heard exactly), backend selection (Local by default, the plan never
  selectable, only Local keeps audio on the computer), the session state
  machine, the utterance detector, both listeners and the controller.
- `scripts/testing/voice-wake.e2e.test.ts` launches the standard isolated
  fixture (`launchVerificationServer`, the same as `control-omb launch`) with
  the fake engine and the fake GPT-Live, and drives the real session
  controller with a scripted transcript source in place of the microphone.
  Local: chatter before the wake phrase never reaches the chat, the question
  after it does, and the fake engine's answer is what gets spoken. API key:
  "hey <bot>, what is six times seven?" opens a GPT-Live session with the saved
  key, the question lands in the chat once the call is live, the Live
  controller appends the agent's answer to the call
  (`session.commentary.append`), a quiet call is hung up and listening returns
  to local, and `/api/config` never holds the key.
- `pnpm smoke:local-voice` installs the real pinned whisper.cpp release and
  model, speaks "Hey Origin." and "Hey Origin, what is the status of the
  launch issues this week?" with Windows' SAPI voice and checks the transcript
  and the wake match.

## Boundaries

- No real microphone, AudioWorklet or echo cancellation is exercised; the
  utterance detector is tested with synthetic tones.
- The macOS path (Apple on-device speech with `--on-device-only`) was not run:
  the helper change needs `pnpm build:speech` on a Mac.
- The GPT voice path is proven against the fake GPT-Live only, without WebRTC
  or a real key; a real call should be made before release.
- `control-omb ui` cannot show the controls, because the web renderer has no
  desktop bridge and wake listening is desktop-only.

## Last exercised

2026-10-24, Windows 11 x64, `agent/voice-wake`: the unit and render tests, the
fixture e2e (2 tests) and `pnpm smoke:local-voice` (install 1.6 s from a warm
network; "Hey Origin." in 1.7 s, the question in 1.0 s, both transcribed
exactly) passed.
