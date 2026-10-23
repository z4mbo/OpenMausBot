import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const PALETTE = ["#a61e4d", "#3b5bdb", "#2b8a3e", "#e67700", "#5f3dc4", "#0b7285", "#c2255c", "#364fc7"];
const swatchSvg = (fill: string, label: string, width = 640, height = 360) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/><circle cx="${width * 0.7}" cy="${height * 0.4}" r="${Math.min(width, height) / 4}" fill="white" fill-opacity="0.18"/><text x="24" y="${height - 30}" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`;
const swatch = (fill: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(swatchSvg(fill, label))}`;

/** One second of a 440 Hz tone, so audio players have something to play. */
function toneWav(): Buffer {
  const rate = 8_000;
  const samples = rate;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / rate) * 6_000), index * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** One project with finished, failed and cancelled generations of every kind; new ones run through the fixture server. */
async function seed(convex: FakeConvex, mediaBase: string) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const { userId, token } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const { teamId } = await t.mutation(ref("workspaces:create"), { sessionToken: token, name: "Fixture" }) as { teamId: string };
  const projectId = String(await t.mutation(ref("projects:create"), { sessionToken: token, teamId, name: "Fixture project" }));
  const generation = (row: Json) => t.run((ctx) => ctx.db.insert("studioGenerations", {
    projectId, mode: row.kind, model: "fal-ai/flux/schnell", modelLabel: "FLUX.1 schnell", saved: [], broadcast: [], outputs: [],
    createdBy: userId, createdByName: "ada", createdAt: Date.now(), updatedAt: Date.now(), ...row,
  }));
  await generation({ kind: "image", prompt: "Team photo collage", status: "done", aspectRatio: "3:4", outputs: [{ url: swatch("#a61e4d", "collage"), kind: "image" }] });
  await generation({ kind: "image", prompt: "A neon cat on a skateboard", status: "failed", error: "fal.ai refused the prompt: NSFW content detected" });
  await generation({ kind: "image", prompt: "Pricing card, three tiers", status: "cancelled" });
  await generation({ kind: "audio", mode: "audio", model: "fal-ai/elevenlabs/tts/eleven-v3", modelLabel: "ElevenLabs v3 voice", prompt: "Welcome to the Origin launch", status: "done", outputs: [{ url: "https://cdn.fixture.test/welcome.mp3", kind: "audio", contentType: "audio/mpeg" }] });
  await generation({ kind: "video", mode: "video", model: "fal-ai/kling-video/v3/pro/text-to-video", modelLabel: "Kling 3 Pro", prompt: "Five second teaser clip", status: "done", aspectRatio: "16:9", outputs: [{ url: `${mediaBase}/video/teaser.webm`, kind: "video", contentType: "video/webm" }] });
  const hero = await generation({ kind: "image", model: "fal-ai/nano-banana-pro", modelLabel: "Nano Banana Pro", prompt: "Hero shot of the app on a dark desk", status: "done", aspectRatio: "16:9", agentName: "Atlas", outputs: [{ url: swatch("#3b5bdb", "hero"), kind: "image" }] });
  const product = await t.run((ctx) => ctx.db.insert("designAssets", { projectId, type: "image", name: "Product photo.png", url: swatch("#2b8a3e", "product"), createdAt: Date.now(), updatedAt: Date.now() }));
  await t.run((ctx) => ctx.db.insert("studioCharacters", {
    projectId, name: "Aurora bottle", kind: "product", description: "Frosted glass bottle, copper cap, embossed logo", referenceAssetIds: [product],
    createdBy: userId, createdByName: "ada", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  await t.run((ctx) => ctx.db.insert("studioTemplates", {
    projectId, name: "Launch hero", description: "Our product on a desk, in the brand's light", mode: "image", model: "fal-ai/nano-banana-pro",
    prompt: "Hero shot of [Product: the app] on [Place: a dark desk], soft rim light", params: { aspectRatio: "16:9" }, sourceAssetIds: [],
    coverUrl: swatch("#3b5bdb", "hero"), coverKind: "image", generationId: hero, createdBy: userId, createdByName: "ada", agentName: "Atlas", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  return { token, projectId };
}

/** fal.ai's queue and media hosts on loopback. A job finishes on its second status poll unless its prompt says hold. */
async function startFakeFal() {
  const certs = mkdtempSync(join(tmpdir(), "omb-fal-media-"));
  const key = join(certs, "fal-media.key");
  const certificate = join(certs, "fal-media.crt");
  await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certificate, "-subj", "/CN=127.0.0.1", "-days", "1"]);
  const wav = toneWav();
  const webm = readFileSync(fileURLToPath(new URL("./testing/fixtures/studio-teaser.webm", import.meta.url)));
  const media = createHttpsServer({ key: readFileSync(key), cert: readFileSync(certificate) }, (req, res) => {
    const path = req.url ?? "/";
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (path.endsWith(".wav")) { res.writeHead(200, { "Content-Type": "audio/wav" }); res.end(wav); return; }
    if (path.startsWith("/video/")) { res.writeHead(200, { "Content-Type": "video/webm" }); res.end(webm); return; }
    const match = /\/image\/(\d+)-(\d+)x(\d+)\.svg$/.exec(path);
    if (!match) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    res.end(swatchSvg(PALETTE[Number(match[1]) % PALETTE.length]!, `result ${match[1]}`, Number(match[2]), Number(match[3])));
  });
  await new Promise<void>((resolve) => media.listen(0, "127.0.0.1", resolve));
  const mediaBase = `https://127.0.0.1:${(media.address() as { port: number }).port}`;

  const requests: Array<{ method: string; path: string; body?: Json }> = [];
  const jobs = new Map<string, { endpoint: string; body: Json; polls: number }>();
  const SIZES: Record<string, [number, number]> = { "16:9": [640, 360], "9:16": [360, 640], "3:4": [480, 640], "4:3": [640, 480], "21:9": [700, 300] };
  const result = (endpoint: string, body: Json, index: number): Json => {
    if (endpoint === "fal-ai/any-llm" && /JSON/.test(String(body.system_prompt))) {
      return { output: JSON.stringify({ script: `Meet the launch: ${String(body.prompt)}. Try it today.`, caption: `${String(body.prompt)} #launch` }) };
    }
    if (endpoint === "fal-ai/any-llm") return { output: `A cinematic ${String(body.prompt)}, soft rim light, shallow depth of field, 35mm` };
    if (endpoint.includes("elevenlabs")) return { audio: { url: `${mediaBase}/audio/${index}.wav`, content_type: "audio/wav" } };
    if (/video|ffmpeg|avatar|lipsync/.test(endpoint)) return { video: { url: `${mediaBase}/video/${index}.webm`, content_type: "video/webm" } };
    const [width, height] = SIZES[String(body.aspect_ratio ?? "")] ?? [560, 560];
    return { images: [{ url: `${mediaBase}/image/${index}-${width}x${height}.svg`, content_type: "image/svg+xml" }] };
  };
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json : undefined;
      requests.push({ method: req.method ?? "GET", path, ...(body ? { body } : {}) });
      const reply = (status: number, value: Json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.method === "POST") {
        const id = `fixture-${requests.length}`;
        jobs.set(id, { endpoint: path.slice(1), body: body ?? {}, polls: 0 });
        const job = `${base}/jobs/requests/${id}`;
        return reply(200, { request_id: id, status_url: `${job}/status`, response_url: job, cancel_url: `${job}/cancel` });
      }
      const id = /requests\/([^/]+)/.exec(path)?.[1] ?? "";
      const job = jobs.get(id);
      if (!job) return reply(404, { detail: "No such request" });
      if (req.method === "PUT" && path.endsWith("/cancel")) return reply(202, { status: "CANCELLATION_REQUESTED" });
      const held = /\bhold\b/i.test(String(job.body.prompt ?? job.body.text ?? ""));
      if (path.endsWith("/status")) {
        job.polls += 1;
        if (held) return reply(200, job.polls < 3 ? { status: "IN_QUEUE", queue_position: 3 - job.polls } : { status: "IN_PROGRESS" });
        return reply(200, job.polls >= 2 ? { status: "COMPLETED" } : { status: "IN_PROGRESS" });
      }
      return reply(200, result(job.endpoint, job.body, Number(id.split("-")[1])));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => media.close(resolve));
    rmSync(certs, { recursive: true, force: true });
  };
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, mediaBase, requests, close };
}

const convex = await startFakeConvex();
const fal = await startFakeFal();
const seeded = await seed(convex, fal.mediaBase);
const live = await launchVerificationServer({ ...process.env, OMB_FAL_QUEUE_URL: fal.url });
writeFileSync(join(live.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.token, projects: {} }), { mode: 0o600 });
writeFileSync(join(live.info.dataDir, "integration-keys.json"), JSON.stringify({ fal: { key: "fixture-id:fixture-secret" } }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(live, {
    entry: "/scripts/testing/origin-studio-preview.tsx", route: "/__origin-studio.html", title: "Isolated Origin Studio",
    extraRoutes: [
      { path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.token, viewerToken: seeded.token, projectId: seeded.projectId })); } },
      { path: "/__origin-studio-fal.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fal.requests)); } },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...live.info, previewUrl: preview.previewUrl, convexUrl: convex.url, falUrl: fal.url, falMedia: fal.mediaBase }));
  await parkUntilSignal();
} finally { await preview?.close(); await live.close(); await fal.close(); await convex.close(); }
