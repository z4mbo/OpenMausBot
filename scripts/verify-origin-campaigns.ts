import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const swatch = (fill: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="${fill}"/><text x="24" y="290" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`)}`;

/** One project with posts, Studio content and issues, and a campaign that links some of them. */
async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const user = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@fixture.test");
  const viewer = await user("vic@fixture.test");
  const as = (token: string) => ({ query: (name: string, args: Json) => t.query(ref(name), { sessionToken: token, ...args }), mutation: (name: string, args: Json) => t.mutation(ref(name), { sessionToken: token, ...args }) });
  const o = as(owner.token);
  const { teamId } = await o.mutation("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const projectId = String(await o.mutation("projects:create", { teamId, name: "Fixture project" }));
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("teamMembers", { teamId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("members", { projectId, userId: viewer.userId, email: "vic@fixture.test", name: "vic", role: "viewer", status: "active", createdAt: now, updatedAt: now });
  });

  const day = (offset: number, hour: number) => { const at = new Date(); at.setDate(at.getDate() + offset); at.setHours(hour, 0, 0, 0); return at.getTime(); };
  const post = (variants: Json[], agent?: Json) => o.mutation("broadcast:save", { projectId, variants, assetIds: [], ...(agent ? { agent } : {}) }).then(String);
  const launched = await post([{ channel: "x", text: "Origin 0.4 is live: campaigns tie Studio and Broadcast together. https://origin.test/?utm_campaign=spring-launch" }, { channel: "linkedin", text: "Origin 0.4 is live." }]);
  await t.run((ctx) => ctx.db.patch(launched, { status: "published", variants: [
    { channel: "x", text: "Origin 0.4 is live.", result: "published", url: "https://x.com/i/web/status/1849", publishedAt: day(-2, 10) },
    { channel: "linkedin", text: "Origin 0.4 is live.", result: "published", url: "https://www.linkedin.com/feed/update/urn:li:share:1", publishedAt: day(-2, 10) },
  ] }));
  const teaser = await post([{ channel: "bluesky", text: "Teaser: one place to launch with your agents." }, { channel: "x", text: "Teaser: one place to launch with your agents." }]);
  await o.mutation("broadcast:schedule", { postId: teaser, at: day(1, 9) });
  const drafted = await post([{ channel: "x", text: "Three ways a Chief runs your launch week." }], { botId: "fixture-chief", name: "Atlas" });
  await post([{ channel: "bluesky", text: "Hiring: a designer who loves dark UIs." }]);

  const generation = (prompt: string, kind: "image" | "video", fill: string) => t.run((ctx) => ctx.db.insert("studioGenerations", {
    projectId, mode: kind, model: "fal-ai/flux/dev", modelLabel: kind === "image" ? "FLUX.1 dev" : "Kling 2.1", kind, prompt, status: "done",
    outputs: kind === "image" ? [{ url: swatch(fill, prompt.split(" ")[0]!), kind }] : [{ url: "https://cdn.fixture.test/teaser.mp4", kind }],
    saved: [], broadcast: [], createdBy: owner.userId, createdByName: "ada", createdAt: Date.now(), updatedAt: Date.now(),
  }));
  const hero = await generation("Hero shot of the app on a dark desk", "image", "#3b5bdb");
  const square = await generation("Square launch card with the logo", "image", "#2b8a3e");
  const clip = await generation("Five second teaser clip", "video", "#000");
  await generation("Team photo collage", "image", "#a61e4d");

  const issue = (title: string) => o.mutation("tasks:createTask", { projectId, title, priority: "medium", assignedToEmail: "ada@fixture.test", dueDate: new Date(day(7, 12)).toISOString().slice(0, 10) }).then(String);
  const landing = await issue("Landing page for the launch");
  const video = await issue("Cut the teaser video");
  await issue("Unrelated bug in settings");
  await t.run((ctx) => ctx.db.patch(video, { done: true }));

  const campaignId = String(await o.mutation("campaigns:create", {
    projectId, name: "Spring launch", goal: "200 beta sign-ups from indie founders in three weeks.", audience: "Indie founders shipping their first SaaS",
    channels: ["x", "bluesky", "linkedin"], startDate: new Date(day(-3, 12)).toISOString().slice(0, 10), endDate: new Date(day(18, 12)).toISOString().slice(0, 10), budgetNote: "€300 for boosted posts",
  }));
  for (const [kind, itemId] of [["post", launched], ["post", teaser], ["post", drafted], ["generation", hero], ["generation", square], ["generation", clip], ["issue", landing], ["issue", video]] as const) {
    await o.mutation("campaigns:link", { projectId, campaignId, kind, itemId });
  }
  await o.mutation("campaigns:recordMetrics", { projectId, campaignId, metrics: [{ postId: launched, channel: "x", likes: 128, reposts: 31, replies: 12, impressions: 9400, at: Date.now() }] });
  await o.mutation("campaigns:create", { projectId, name: "Black Friday", goal: "Convert trial teams to the annual plan.", channels: ["x"] });
  return { ownerToken: owner.token, viewerToken: viewer.token, projectId };
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const fixture = await launchVerificationServer();
// The fixture's Origin session points at the in-memory backend, so the metrics route reads and writes it like a real deployment.
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.ownerToken, projects: {} }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-campaigns-preview.tsx", route: "/__origin-campaigns.html", title: "Isolated Origin Campaigns",
    extraRoutes: [{ path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.ownerToken, viewerToken: seeded.viewerToken, projectId: seeded.projectId })); } }],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await convex.close(); }
