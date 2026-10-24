// whisper.cpp (MIT, https://github.com/ggml-org/whisper.cpp) heard on this computer. Its Windows binaries and the
// ggml model are downloaded on first use from the upstream release and Hugging Face, each pinned by size and SHA-256.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";

export const WHISPER_VERSION = "b5454";

export const WHISPER_BINARIES = {
  "win32-x64": {
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`,
    sha256: "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb",
    bytes: 8_928_640,
  },
  "win32-arm64": {
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-win-cpu-arm64.zip`,
    sha256: "28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d",
    bytes: 4_371_193,
  },
};

/** Multilingual base, 5-bit: Italian and English wake phrases both need a multilingual model. */
export const WHISPER_MODEL = {
  name: "ggml-base-q5_1.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin",
  sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
  bytes: 59_707_625,
};

const KEPT_FILES = /^(whisper-cli\.exe|whisper\.dll|ggml(-base|-cpu(-[\w]+)?)?\.dll|libomp140\.aarch64\.dll)$/i;
const SAMPLE_RATE = 16_000;
const MAX_SECONDS = 30;
const MIN_SAMPLES = SAMPLE_RATE / 5;
const TRANSCRIBE_TIMEOUT_MS = 30_000;
const PROMPT_CHARS = 200;
// Windows NTSTATUS STATUS_DLL_NOT_FOUND: the Visual C++ 2015-2022 runtime the upstream build links is missing.
const DLL_NOT_FOUND = new Set([3221225781, -1073741515]);
const NON_SPEECH = /^\s*[[(][^\])]*[\])]\s*$/;

export class LocalVoiceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export function binaryTarget(platform, arch) {
  const key = `${platform}-${arch}`;
  return Object.hasOwn(WHISPER_BINARIES, key) ? key : null;
}

/** 16 kHz mono PCM16 as a RIFF/WAVE file, which whisper-cli reads directly. */
export function wavFromPcm16(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function transcriptFrom(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !NON_SPEECH.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** whisper encodes 50 frames a second; a short clip needs only that much context, which makes it several times faster. */
export function audioContext(sampleCount) {
  const seconds = sampleCount / SAMPLE_RATE;
  return Math.min(1500, Math.max(384, Math.ceil(seconds * 50) + 128));
}

export function cleanPrompt(value) {
  return typeof value === "string" ? value.replace(/[\p{Cc}"]/gu, " ").replace(/\s+/g, " ").trim().slice(0, PROMPT_CHARS) : "";
}

async function download(fetchImpl, asset, file, onBytes) {
  const response = await fetchImpl(asset.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new LocalVoiceError("download-failed", `download answered ${response.status}`);
  const hash = createHash("sha256");
  let received = 0;
  const out = createWriteStream(file, { mode: 0o600 });
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > asset.bytes) throw new LocalVoiceError("download-corrupt", "download is larger than expected");
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
      onBytes(chunk.length);
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }
  if (received !== asset.bytes || hash.digest("hex") !== asset.sha256) {
    await rm(file, { force: true });
    throw new LocalVoiceError("download-corrupt", "download did not match its pinned checksum");
  }
}

function run(file, args, { spawnImpl, timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(file, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { if (stdout.length < 65_536) stdout += chunk; });
    child.stderr?.on("data", (chunk) => { if (stderr.length < 16_384) stderr += chunk; });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export function createLocalVoice({
  directory,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  tarPath = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
  binaries = WHISPER_BINARIES,
  model = WHISPER_MODEL,
  threads = Math.max(1, Math.min(4, cpus().length)),
} = {}) {
  const target = binaryTarget(platform, arch);
  const binaryDir = path.join(directory, `whisper-${WHISPER_VERSION}-${arch}`);
  const cli = path.join(binaryDir, "whisper-cli.exe");
  const modelFile = path.join(directory, "models", model.name);
  const totalBytes = target ? binaries[target].bytes + model.bytes : 0;
  let installing = null;
  let received = 0;
  let lastError = null;
  let queue = Promise.resolve();
  const listeners = new Set();

  const exists = async (file) => stat(file).then((info) => info.isFile(), () => false);
  const installed = async () => Boolean(target) && (await exists(cli)) && (await exists(modelFile));

  async function status() {
    return {
      engine: target ? "whisper" : "none",
      installed: await installed(),
      installing: Boolean(installing),
      receivedBytes: received,
      totalBytes,
      ...(lastError ? { error: lastError } : {}),
    };
  }

  const progress = (bytes) => {
    received += bytes;
    for (const listener of Array.from(listeners)) listener({ receivedBytes: received, totalBytes });
  };

  async function installBinaries(staging) {
    const asset = binaries[target];
    const zip = path.join(staging, "whisper.zip");
    await download(fetchImpl, asset, zip, progress);
    const extracted = path.join(staging, "x");
    await mkdir(extracted);
    const result = await run(tarPath, ["-xf", zip, "-C", extracted], { spawnImpl, timeoutMs: 120_000 });
    if (result.code !== 0) throw new LocalVoiceError("extract-failed", "the whisper.cpp archive could not be unpacked");
    const release = path.join(extracted, "Release");
    const names = (await readdir(release)).filter((name) => KEPT_FILES.test(name));
    if (!names.some((name) => name.toLowerCase() === "whisper-cli.exe")) {
      throw new LocalVoiceError("extract-failed", "the whisper.cpp archive has no whisper-cli");
    }
    const ready = path.join(staging, "bin");
    await mkdir(ready);
    for (const name of names) await copyFile(path.join(release, name), path.join(ready, name));
    await rm(binaryDir, { recursive: true, force: true });
    await rename(ready, binaryDir);
  }

  async function installModel(staging) {
    const partial = path.join(staging, model.name);
    await download(fetchImpl, model, partial, progress);
    await mkdir(path.dirname(modelFile), { recursive: true });
    await chmod(partial, 0o600).catch(() => {});
    await rename(partial, modelFile);
  }

  async function install() {
    if (!target) throw new LocalVoiceError("unsupported-platform");
    if (installing) return installing;
    installing = (async () => {
      lastError = null;
      received = 0;
      await mkdir(directory, { recursive: true });
      const staging = await mkdtemp(path.join(directory, ".staging-"));
      try {
        if (await exists(cli)) received += binaries[target].bytes;
        else await installBinaries(staging);
        if (await exists(modelFile)) received += model.bytes;
        else await installModel(staging);
      } catch (error) {
        lastError = error instanceof LocalVoiceError ? error.code : "download-failed";
        throw error instanceof LocalVoiceError ? error : new LocalVoiceError("download-failed", String(error?.message ?? error));
      } finally {
        await rm(staging, { recursive: true, force: true });
        installing = null;
      }
    })();
    return installing;
  }

  async function transcribeNow(samples, options) {
    if (!(await installed())) throw new LocalVoiceError("not-installed");
    if (samples.length < MIN_SAMPLES) return "";
    const clip = samples.length > SAMPLE_RATE * MAX_SECONDS ? samples.subarray(0, SAMPLE_RATE * MAX_SECONDS) : samples;
    const session = await mkdtemp(path.join(directory, ".clip-"));
    const wav = path.join(session, `${randomUUID()}.wav`);
    try {
      await writeFile(wav, wavFromPcm16(clip), { mode: 0o600 });
      const prompt = cleanPrompt(options?.prompt);
      const language = typeof options?.language === "string" && /^[a-z]{2,3}$/.test(options.language) ? options.language : "auto";
      const args = [
        "-m", modelFile, "-f", wav, "-l", language, "-nt", "-np",
        "-t", String(threads), "-ac", String(audioContext(clip.length)),
        ...(prompt ? ["--prompt", prompt] : []),
      ];
      const result = await run(cli, args, { spawnImpl, timeoutMs: TRANSCRIBE_TIMEOUT_MS, cwd: binaryDir });
      if (DLL_NOT_FOUND.has(result.code)) throw new LocalVoiceError("vc-runtime-missing");
      if (result.code !== 0) throw new LocalVoiceError("transcribe-failed", `whisper-cli exited ${result.code ?? result.signal}`);
      return transcriptFrom(result.stdout);
    } finally {
      await rm(session, { recursive: true, force: true });
    }
  }

  /** One clip at a time: whisper-cli already uses every thread it is given. */
  function transcribe(samples, options) {
    const next = queue.then(() => transcribeNow(samples, options));
    queue = next.catch(() => {});
    return next;
  }

  async function remove() {
    if (installing) throw new LocalVoiceError("busy");
    await rm(binaryDir, { recursive: true, force: true });
    await rm(modelFile, { force: true });
  }

  return {
    status,
    install,
    transcribe,
    remove,
    onProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
