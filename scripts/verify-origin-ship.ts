import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";
import { startFakeShipProviders } from "./testing/origin-ship-providers.ts";

type Json = Record<string, unknown>;

/** One project with a GitHub repository, three deploy targets and a member and a viewer besides its owner. */
async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const user = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@fixture.test");
  const viewer = await user("vic@fixture.test");
  const as = (token: string) => ({ mutation: (name: string, args: Json) => t.mutation(ref(name), { sessionToken: token, ...args }) });
  const o = as(owner.token);
  const { teamId } = await o.mutation("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const projectId = String(await o.mutation("projects:create", { teamId, name: "Launch", repoUrl: "https://github.com/acme/launch" }));
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("teamMembers", { teamId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("members", { projectId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
  });
  await o.mutation("ship:saveTarget", { projectId, provider: "vercel", name: "Web", ref: "launch-web", account: "", branch: "main", siteUrl: "https://launch.fixture.test" });
  await o.mutation("ship:saveTarget", { projectId, provider: "cloudflare", name: "Docs", ref: "launch-docs", account: "acc123", branch: "main" });
  await o.mutation("ship:saveTarget", { projectId, provider: "github-actions", name: "Mobile build", ref: "mobile.yml", branch: "main", siteUrl: "https://apps.fixture.test/launch" });
  return { ownerToken: owner.token, viewerToken: viewer.token, projectId };
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const providers = await startFakeShipProviders();
// The launcher passes only a loopback OMB_SHIP_PROVIDER_URL into the child, so every provider and GitHub call reaches the fake.
process.env.OMB_SHIP_PROVIDER_URL = providers.origin;
const fixture = await launchVerificationServer();
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.ownerToken, projects: {} }), { mode: 0o600 });
writeFileSync(join(fixture.info.dataDir, "integration-keys.json"), JSON.stringify({ vercel: { apiToken: "fixture-vercel-token" }, cloudflare: { apiToken: "fixture-cloudflare-token" }, x: { apiKey: "k", apiSecret: "s", accessToken: "a", accessSecret: "b" } }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
const config = JSON.stringify({ url: convex.url, token: seeded.ownerToken, viewerToken: seeded.viewerToken, projectId: seeded.projectId });
const serveConfig = (_req: unknown, res: { setHeader(name: string, value: string): void; end(body: string): void }) => { res.setHeader("Content-Type", "application/json"); res.end(config); };
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-ship-preview.tsx", route: "/__origin-ship.html", title: "Isolated Origin Ship",
    extraRoutes: [
      { path: "/__origin-ship.json", handler: serveConfig },
      { path: "/__origin-campaigns.json", handler: serveConfig },
      { path: "/__origin-ship-requests.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(providers.requests)); } },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url, providers: providers.origin }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await providers.close(); await convex.close(); }
