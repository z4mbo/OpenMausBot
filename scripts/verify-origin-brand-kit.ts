import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";
import { encodeNode, type CanvasNode } from "../shared/canvas-scene.ts";
import { pageDocument, isPageFont } from "../shared/canvas-page.ts";
import type { BotRecord } from "../server/store.ts";
import type * as OriginCloud from "../server/origin-cloud.ts";

type Json = Record<string, unknown>;

const svg = (body: string, size = 160) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size * 3}" height="${size}" viewBox="0 0 ${size * 3} ${size}">${body}</svg>`)}`;
const LOGO = svg(`<circle cx="70" cy="80" r="52" fill="#7C3AED"/><circle cx="92" cy="62" r="20" fill="#FDE68A"/><text x="150" y="104" font-family="Georgia, serif" font-size="72" font-weight="700" fill="#7C3AED">Lumen</text>`);
const ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="36" fill="#7C3AED"/><circle cx="92" cy="62" r="24" fill="#FDE68A"/></svg>`)}`;

let z = 0;
const node = (patch: Partial<CanvasNode> & Pick<CanvasNode, "id" | "type">): CanvasNode => ({
  version: 1, versionNonce: 1, parentId: null, z: ++z, name: patch.id, x: 0, y: 0, width: 100, height: 40, rotation: 0, opacity: 1,
  fill: null, stroke: null, strokeWidth: 0, radius: 0, ...patch,
});

/** A hero frame drawn without the brand: a dark board, white type, a blue button and a green badge. */
const HERO = [
  node({ id: "hero", type: "frame", name: "Hero", x: 0, y: 0, width: 960, height: 560, fill: "#0B0B0F", clip: true }),
  node({ id: "title", type: "text", name: "Title", parentId: "hero", x: 72, y: 120, width: 760, height: 70, text: "Ship your night-owl ideas", fontSize: 56, fontWeight: 700, font: "sans", align: "left", lineHeight: 1.15, fill: "#FFFFFF" }),
  node({ id: "copy", type: "text", name: "Copy", parentId: "hero", x: 72, y: 220, width: 620, height: 52, text: "Plan, design and launch with your team and its agents, from one place.", fontSize: 20, fontWeight: 400, font: "sans", align: "left", lineHeight: 1.3, fill: "#D1D5DB" }),
  node({ id: "button", type: "rect", name: "Button", parentId: "hero", x: 72, y: 330, width: 200, height: 56, radius: 12, fill: "#2563EB" }),
  node({ id: "label", type: "text", name: "Button label", parentId: "hero", x: 96, y: 346, width: 152, height: 24, text: "Get started", fontSize: 18, fontWeight: 600, font: "sans", align: "center", lineHeight: 1.3, fill: "#FFFFFF" }),
  node({ id: "badge", type: "ellipse", name: "Badge", parentId: "hero", x: 820, y: 60, width: 72, height: 72, fill: "#16A34A" }),
];

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const user = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@fixture.test");
  const viewer = await user("vic@fixture.test");
  const as = (name: string, args: Json) => t.mutation(ref(name), { sessionToken: owner.token, ...args });
  const { teamId } = await as("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const projectId = String(await as("projects:create", { teamId, name: "Lumen", description: "A calm planning app for night-owl founders: tasks, notes and launches in one dark, quiet place." }));
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("teamMembers", { teamId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("members", { projectId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("designAssets", { projectId, type: "image", name: "Lumen logo", url: LOGO, contentType: "image/svg+xml", createdAt: now, updatedAt: now });
    await ctx.db.insert("designAssets", { projectId, type: "icon", name: "Lumen icon", url: ICON, contentType: "image/svg+xml", createdAt: now + 1, updatedAt: now + 1 });
    await ctx.db.insert("designAssets", { projectId, type: "document", name: "Launch brief.pdf", url: "https://cdn.fixture.test/brief.pdf", createdAt: now + 2, updatedAt: now + 2 });
  });
  const canvasId = String(await as("draw:createCanvas", { projectId, name: "Landing" }));
  await as("draw:updateElements", { teamId, canvasId, elements: HERO.map(encodeNode) });
  return { ownerToken: owner.token, viewerToken: viewer.token, projectId, teamId, canvasId };
}

/** fal.ai's queue on loopback, keeping each submitted input so the check can read the prompt Studio sent. */
async function startFakeFal() {
  const inputs: Json[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "/";
      const reply = (status: number, body: Json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.method === "POST") {
        inputs.push({ path, ...JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Json });
        const job = `${base}${path}/requests/fixture-${inputs.length}`;
        return reply(200, { request_id: `fixture-${inputs.length}`, status_url: `${job}/status`, response_url: job, cancel_url: `${job}/cancel` });
      }
      return reply(200, { status: "IN_PROGRESS" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, inputs, close: () => new Promise((resolve) => server.close(resolve)) };
}

const readJson = async (req: import("node:http").IncomingMessage): Promise<Json> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Json;
};

const convex = await startFakeConvex();
const fal = await startFakeFal();
const seeded = await seed(convex);
const fixture = await launchVerificationServer({ ...process.env, OMB_FAL_QUEUE_URL: fal.url });
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.ownerToken, projects: {} }), { mode: 0o600 });
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({ fal: { key: "fixture-id:fixture-secret" } }), { mode: 0o600 });
// The agent tools load the server's config; pointing it at the fixture's data first keeps the person's own data out of reach.
process.env.OMB_DATA_DIR = join(fixture.info.dataDir, "launcher");
const { convexOriginClient, runOriginTool } = await import("../server/origin-cloud.ts") as typeof OriginCloud;
const chief = { id: "fixture-chief", name: "Atlas", section: "Lumen", chiefOfStaff: true } as unknown as BotRecord;
const toolDeps = { bots: [chief], state: { url: convex.url, sessionToken: seeded.ownerToken, projects: { [chief.id]: seeded.projectId } }, connect: (url: string) => convexOriginClient(url) };
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-brand-kit-preview.tsx", route: "/__origin-brand-kit.html", title: "Isolated Origin brand kit",
    extraRoutes: [
      { path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.ownerToken, viewerToken: seeded.viewerToken, projectId: seeded.projectId, teamId: seeded.teamId, canvasId: seeded.canvasId })); } },
      { path: "/__brand-fal.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fal.inputs)); } },
      { path: "/__brand-agent", method: "POST", handler: async (req, res) => {
        const body = await readJson(req);
        const result = await runOriginTool(String(body.tool), (body.args ?? {}) as Json, chief.id, toolDeps);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      } },
      { path: "/__brand-page.html", handler: async (_req, res) => {
        const page = await convex.t.run(async (ctx) => (ctx.db as unknown as { query(table: string): { first(): Promise<Json | null> } }).query("publishedPages").first());
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (!page) { res.statusCode = 404; res.end("not published"); return; }
        res.end(pageDocument({ title: String(page.title), description: String(page.description), page: { body: String(page.body), background: String(page.background), fonts: (page.fonts as string[]).filter(isPageFont) } }));
      } },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url, falUrl: fal.url }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await fal.close(); await convex.close(); }
