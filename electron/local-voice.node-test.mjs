import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  audioContext,
  binaryTarget,
  cleanPrompt,
  createLocalVoice,
  transcriptFrom,
  wavFromPcm16,
  WHISPER_BINARIES,
  WHISPER_MODEL,
} from "./local-voice.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "omb-local-voice-"));
  const zip = Buffer.from("fake zip bytes");
  const modelBytes = Buffer.from("fake ggml model");
  const binaries = { "win32-x64": { url: "https://example.test/whisper.zip", sha256: sha(zip), bytes: zip.length } };
  const model = { name: "ggml-test.bin", url: "https://example.test/model.bin", sha256: sha(modelBytes), bytes: modelBytes.length };
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    const body = url === binaries["win32-x64"].url ? zip : url === model.url ? modelBytes : null;
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, { status: 200 });
  };
  const spawned = [];
  let whisperResult = { code: 0, stdout: " Hey, Origin.\n" };
  const spawnImpl = (file, args, options) => {
    spawned.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      if (path.basename(file) === "tar.exe") {
        const release = path.join(args[args.indexOf("-C") + 1], "Release");
        mkdirSync(release, { recursive: true });
        for (const name of ["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu-haswell.dll", "SDL2.dll", "wchess.exe"]) {
          writeFileSync(path.join(release, name), name);
        }
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0, null);
        return;
      }
      child.stdout.end(whisperResult.stdout ?? "");
      child.stderr.end("whisper log");
      child.emit("close", whisperResult.code, null);
    });
    return child;
  };
  const voice = createLocalVoice({
    directory, platform: "win32", arch: "x64", fetchImpl, spawnImpl, tarPath: "C:\\Windows\\System32\\tar.exe", binaries, model, threads: 2,
  });
  return {
    directory, voice, fetched, spawned, binaries, model,
    answerWith(result) { whisperResult = result; },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("only Windows x64 and arm64 have upstream whisper.cpp binaries", () => {
  assert.equal(binaryTarget("win32", "x64"), "win32-x64");
  assert.equal(binaryTarget("win32", "arm64"), "win32-arm64");
  assert.equal(binaryTarget("win32", "ia32"), null);
  assert.equal(binaryTarget("darwin", "arm64"), null);
  assert.equal(binaryTarget("linux", "x64"), null);
  for (const asset of [...Object.values(WHISPER_BINARIES), WHISPER_MODEL]) {
    assert.match(asset.url, /^https:\/\/(github\.com\/ggml-org\/whisper\.cpp\/releases\/download\/|huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/)/);
    assert.match(asset.sha256, /^[0-9a-f]{64}$/);
    assert.ok(asset.bytes > 1_000_000);
  }
});

test("a WAV header describes 16 kHz mono PCM16", () => {
  const wav = wavFromPcm16(new Int16Array([1, -1, 300]));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.length, 50);
  assert.equal(wav.readInt16LE(46), -1);
});

test("non-speech markers are dropped from the transcript", () => {
  assert.equal(transcriptFrom(" Hey, Origin.\n What is up?\n"), "Hey, Origin. What is up?");
  assert.equal(transcriptFrom("[BLANK_AUDIO]\n"), "");
  assert.equal(transcriptFrom(" (music)\n [Silence]\n"), "");
});

test("short clips get a short audio context and prompts stay plain", () => {
  assert.equal(audioContext(16_000), 384);
  assert.equal(audioContext(16_000 * 10), 628);
  assert.equal(audioContext(16_000 * 40), 1500);
  assert.equal(cleanPrompt('Ehi "Origin"\n\u0000 hey'), "Ehi Origin hey");
  assert.equal(cleanPrompt(42), "");
  assert.equal(cleanPrompt("x".repeat(500)).length, 200);
});

test("installs the pinned archive and model, keeping only what whisper-cli needs", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  assert.deepEqual(await f.voice.status(), { engine: "whisper", installed: false, installing: false, receivedBytes: 0, totalBytes: f.binaries["win32-x64"].bytes + f.model.bytes });
  const progress = [];
  f.voice.onProgress((p) => progress.push(p.receivedBytes));
  await f.voice.install();
  const status = await f.voice.status();
  assert.equal(status.installed, true);
  assert.equal(status.receivedBytes, status.totalBytes);
  assert.ok(progress.length >= 2);
  const kept = readdirSync(path.join(f.directory, "whisper-b5454-x64")).sort();
  assert.deepEqual(kept, ["ggml-base.dll", "ggml-cpu-haswell.dll", "ggml.dll", "whisper-cli.exe", "whisper.dll"]);
  assert.ok(existsSync(path.join(f.directory, "models", "ggml-test.bin")));
  assert.deepEqual(readdirSync(f.directory).filter((name) => name.startsWith(".")), []);
  await f.voice.install();
  assert.equal(f.fetched.length, 2, "a second install downloads nothing");
});

test("a download that does not match its checksum installs nothing", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.model.sha256 = "0".repeat(64);
  await assert.rejects(f.voice.install(), { code: "download-corrupt" });
  const status = await f.voice.status();
  assert.equal(status.installed, false);
  assert.equal(status.error, "download-corrupt");
  assert.ok(!existsSync(path.join(f.directory, "models", "ggml-test.bin")));
  assert.deepEqual(readdirSync(f.directory).filter((name) => name.startsWith(".")), []);
});

test("an unsupported computer refuses to install", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "omb-local-voice-"));
  try {
    const voice = createLocalVoice({ directory, platform: "darwin", arch: "arm64" });
    assert.equal((await voice.status()).engine, "none");
    await assert.rejects(voice.install(), { code: "unsupported-platform" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transcribes a clip with the project names as prompt and deletes the clip", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  await assert.rejects(f.voice.transcribe(new Int16Array(16_000)), { code: "not-installed" });
  await f.voice.install();
  assert.equal(await f.voice.transcribe(new Int16Array(100)), "", "too short to be speech");
  assert.equal(await f.voice.transcribe(new Int16Array(16_000), { prompt: "Ehi Origin.", language: "it" }), "Hey, Origin.");
  const call = f.spawned.at(-1);
  assert.equal(path.basename(call.file), "whisper-cli.exe");
  const flag = (name) => call.args[call.args.indexOf(name) + 1];
  assert.equal(flag("--prompt"), "Ehi Origin.");
  assert.equal(flag("-l"), "it");
  assert.equal(flag("-ac"), "384");
  assert.equal(flag("-t"), "2");
  assert.ok(!existsSync(flag("-f")), "the clip is deleted after transcription");
  assert.equal(call.options.windowsHide, true);
  await f.voice.transcribe(new Int16Array(16_000), { language: "../../x" });
  assert.equal(f.spawned.at(-1).args[f.spawned.at(-1).args.indexOf("-l") + 1], "auto");
});

test("a missing Visual C++ runtime is told apart from other failures", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  await f.voice.install();
  f.answerWith({ code: 3221225781, stdout: "" });
  await assert.rejects(f.voice.transcribe(new Int16Array(16_000)), { code: "vc-runtime-missing" });
  f.answerWith({ code: 1, stdout: "" });
  await assert.rejects(f.voice.transcribe(new Int16Array(16_000)), { code: "transcribe-failed" });
  f.answerWith({ code: 0, stdout: " ok\n" });
  assert.equal(await f.voice.transcribe(new Int16Array(16_000)), "ok", "the queue recovers after a failure");
});

test("removing the download deletes the binaries and the model", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  await f.voice.install();
  await f.voice.remove();
  assert.equal((await f.voice.status()).installed, false);
});
