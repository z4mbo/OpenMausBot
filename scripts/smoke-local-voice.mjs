#!/usr/bin/env node
// Windows only. Downloads the pinned whisper.cpp release and model (about 69 MB) into a temporary directory,
// speaks two phrases with Windows' own SAPI voice, transcribes them and checks the wake phrase. Nothing outside
// the temporary directory is touched; it is removed at the end. Needs Node 23.6+ to import the TypeScript matcher.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLocalVoice } from "../electron/local-voice.mjs";
import { matchWakePhrase } from "../src/lib/voice/wake-phrase.ts";

assert.equal(process.platform, "win32", "this smoke runs whisper.cpp's Windows build");
const directory = await mkdtemp(path.join(tmpdir(), "omb-local-voice-smoke-"));
try {
  const voice = createLocalVoice({ directory });
  let last = 0;
  voice.onProgress(({ receivedBytes, totalBytes }) => {
    const percent = Math.floor((receivedBytes / totalBytes) * 10) * 10;
    if (percent > last) console.log(`download ${percent}%`);
    last = Math.max(last, percent);
  });
  const installStarted = Date.now();
  await voice.install();
  console.log(`installed in ${Date.now() - installStarted} ms`, await voice.status());

  const phrases = { wake: "Hey Origin.", question: "Hey Origin, what is the status of the launch issues this week?" };
  for (const [name, text] of Object.entries(phrases)) {
    const wav = path.join(directory, `${name}.wav`);
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
      `$s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}', $f)`,
      `$s.Speak('${text.replace(/'/g, "''")}')`,
      "$s.Dispose()",
    ].join("; ");
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "inherit" });
    const bytes = await readFile(wav);
    const dataAt = bytes.indexOf("data") + 8;
    const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset + dataAt, bytes.byteOffset + bytes.length - ((bytes.length - dataAt) % 2)));
    const started = Date.now();
    const transcript = await voice.transcribe(samples, { prompt: "Ehi Origin. Hey Origin." });
    console.log(JSON.stringify({ phrase: text, transcript, ms: Date.now() - started }));
    const wake = matchWakePhrase(transcript, [{ id: "origin", name: "Origin" }]);
    assert.equal(wake?.id, "origin", `the wake phrase was not heard in ${JSON.stringify(transcript)}`);
    if (name === "question") assert.match(wake.rest, /status of the launch issues/i);
  }
  console.log("local voice smoke passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
