import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const swatch = (fill: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${fill}"/><text x="24" y="330" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`)}`;

/** One project with finished, failed and cancelled generations of every kind; new ones run through the fixture server. */
async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const { userId, token } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const { teamId } = await t.mutation(ref("workspaces:create"), { sessionToken: token, name: "Fixture" }) as { teamId: string };
  const projectId = String(await t.mutation(ref("projects:create"), { sessionToken: token, teamId, name: "Fixture project" }));
  const generation = (row: Json) => t.run((ctx) => ctx.db.insert("studioGenerations", {
    projectId, mode: row.kind, model: "fal-ai/flux/dev", modelLabel: "FLUX.1 dev", saved: [], broadcast: [], outputs: [],
    createdBy: userId, createdByName: "ada", createdAt: Date.now(), updatedAt: Date.now(), ...row,
  }));
  await generation({ kind: "image", prompt: "Team photo collage", status: "done", outputs: [{ url: swatch("#a61e4d", "collage"), kind: "image" }] });
  await generation({ kind: "image", prompt: "A neon cat on a skateboard", status: "failed", error: "fal.ai refused the prompt: NSFW content detected" });
  await generation({ kind: "image", prompt: "Pricing card, three tiers", status: "cancelled" });
  await generation({ kind: "audio", mode: "audio", modelLabel: "ElevenLabs v3", prompt: "Welcome to the Origin launch", status: "done", outputs: [{ url: "https://cdn.fixture.test/welcome.mp3", kind: "audio", contentType: "audio/mpeg" }] });
  await generation({ kind: "video", mode: "video", modelLabel: "Kling 2.1", prompt: "Five second teaser clip", status: "done", aspectRatio: "16:9", outputs: [{ url: "https://cdn.fixture.test/teaser.mp4", kind: "video", contentType: "video/mp4" }] });
  await generation({ kind: "image", prompt: "Hero shot of the app on a dark desk", status: "done", aspectRatio: "16:9", agentName: "Atlas", outputs: [{ url: swatch("#3b5bdb", "hero"), kind: "image" }] });
  return { token, projectId };
}

/** fal.ai's queue on loopback: a job stays in progress until it is cancelled. */
async function startFakeFal() {
  const requests: Array<{ method: string; path: string }> = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    requests.push({ method: req.method ?? "GET", path });
    req.resume();
    const reply = (status: number, body: Json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    if (req.method === "POST") {
      const job = `${base}${path}/requests/fixture-${requests.length}`;
      return reply(200, { request_id: `fixture-${requests.length}`, status_url: `${job}/status`, response_url: job, cancel_url: `${job}/cancel` });
    }
    if (req.method === "PUT" && path.endsWith("/cancel")) return reply(202, { status: "CANCELLATION_REQUESTED" });
    return reply(200, { status: "IN_PROGRESS" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

const convex = await startFakeConvex();
const fal = await startFakeFal();
const seeded = await seed(convex);
const fixture = await launchVerificationServer({ ...process.env, OMB_FAL_QUEUE_URL: fal.url });
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.token, projects: {} }), { mode: 0o600 });
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({ fal: { key: "fixture-id:fixture-secret" } }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
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
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url, falUrl: fal.url }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await fal.close(); await convex.close(); }
