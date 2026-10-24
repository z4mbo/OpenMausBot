import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-convex-backend.ts";
import type { BotRecord } from "../server/store.ts";
import type * as OriginCloud from "../server/origin-cloud.ts";

type Json = Record<string, unknown>;

const svg = (body: string, size = 160) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size * 3}" height="${size}" viewBox="0 0 ${size * 3} ${size}">${body}</svg>`)}`;
const LOGO = svg(`<circle cx="70" cy="80" r="52" fill="#7C3AED"/><circle cx="92" cy="62" r="20" fill="#FDE68A"/><text x="150" y="104" font-family="Georgia, serif" font-size="72" font-weight="700" fill="#7C3AED">Lumen</text>`);
const ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="36" fill="#7C3AED"/><circle cx="92" cy="62" r="24" fill="#FDE68A"/></svg>`)}`;

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
  return { ownerToken: owner.token, viewerToken: viewer.token, projectId, teamId };
}

const readJson = async (req: import("node:http").IncomingMessage): Promise<Json> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Json;
};

const convex = await startFakeConvex();
const seeded = await seed(convex);
const fixture = await launchVerificationServer(process.env);
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.ownerToken, projects: {} }), { mode: 0o600 });
// The agent tools load the server's config; pointing it at the fixture's data first keeps the person's own data out of reach.
process.env.OMB_DATA_DIR = join(fixture.info.dataDir, "launcher");
const { convexOriginClient, runOriginTool } = await import("../server/origin-cloud.ts") as typeof OriginCloud;
const chief = { id: "fixture-chief", name: "Atlas", section: "Lumen", chiefOfStaff: true } as unknown as BotRecord;
const toolDeps = { bots: [chief], state: { url: convex.url, sessionToken: seeded.ownerToken, projects: { [chief.id]: seeded.projectId } }, connect: (url: string) => convexOriginClient(url) };
const cloud = fileURLToPath(new URL("./testing/origin-convex-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-brand-kit-preview.tsx", route: "/__origin-brand-kit.html", title: "Isolated Origin brand kit",
    extraRoutes: [
      { path: "/__origin-cloud.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.ownerToken, viewerToken: seeded.viewerToken, projectId: seeded.projectId, teamId: seeded.teamId })); } },
      { path: "/__brand-agent", method: "POST", handler: async (req, res) => {
        const body = await readJson(req);
        const result = await runOriginTool(String(body.tool), (body.args ?? {}) as Json, chief.id, toolDeps);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      } },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await convex.close(); }
