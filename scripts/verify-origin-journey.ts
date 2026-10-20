import { fileURLToPath } from "node:url";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;
const DAY = 86_400_000;

/** Four projects, one at each phase: Seed has nothing, Sketch has a Brief, Forge has open issues, Rocket is shipped with posts and leads. */
async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 }));
  const token = await t.run((ctx) => createSession(ctx, ownerId));
  const o = { mutation: (name: string, args: Json) => t.mutation(ref(name), { sessionToken: token, ...args }) };
  const { teamId } = await o.mutation("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const project = async (name: string) => String(await o.mutation("projects:create", { teamId, name }));
  const seedProject = await project("Seed");
  const sketch = await project("Sketch");
  const forge = await project("Forge");
  const rocket = await project("Rocket");
  const now = Date.now();
  const brief = (projectId: string) => o.mutation("projectDocs:save", { projectId, title: "Brief", content: "## Problem\nTeams lose ideas between chat and code.\n\n## Audience\nSmall product teams.", tags: ["brief"] });
  for (const projectId of [sketch, forge, rocket]) await brief(projectId);
  for (const projectId of [forge, rocket]) await o.mutation("draw:createCanvas", { projectId, name: "Flow" });

  await t.run(async (ctx: any) => {
    const todo = async (projectId: string) => (await ctx.db.query("columns").withIndex("by_project", (q: any) => q.eq("projectId", projectId)).collect()).find((row: any) => !row.isDraft && !row.isDone)._id;
    for (const [projectId, titles] of [[forge, ["Sign-up flow", "Board view", "Invite teammates"]], [rocket, []]] as const) {
      const columnId = await todo(projectId);
      for (const [order, title] of titles.entries()) await ctx.db.insert("tasks", { teamId, projectId, columnId, title, priority: "medium", done: false, order, createdAt: now, updatedAt: now });
      await ctx.db.patch(projectId, { openIssueCount: titles.length });
    }
    const done = await todo(rocket);
    for (let i = 0; i < 6; i++) {
      const taskId = await ctx.db.insert("tasks", { teamId, projectId: rocket, columnId: done, title: `Shipped ${i + 1}`, priority: "medium", done: true, order: i, createdAt: now - 9 * DAY, updatedAt: now - DAY, completedAt: now - DAY });
      await ctx.db.insert("taskCompletions", { teamId, projectId: rocket, taskId, completedAt: now - DAY });
    }
    await ctx.db.insert("shipReleases", { projectId: rocket, tag: "v1.0.0", title: "Rocket 1.0", notes: "First release", status: "published", pulls: [], announce: false, createdBy: ownerId, createdAt: now - DAY, updatedAt: now - DAY, publishedAt: now - DAY });
    await ctx.db.insert("studioGenerations", { projectId: rocket, mode: "image", model: "fixture", modelLabel: "Fixture", kind: "image", prompt: "Launch hero", status: "done", outputs: [], saved: [], broadcast: [], createdBy: ownerId, createdByName: "ada", createdAt: now, updatedAt: now });
    await ctx.db.insert("broadcastPosts", { projectId: rocket, variants: [{ channel: "x", text: "Rocket is live", result: "published", publishedAt: now - 3_600_000 }], assetIds: [], status: "published", authorUserId: ownerId, createdAt: now - DAY, updatedAt: now - 3_600_000 });
    for (let i = 0; i < 5; i++) await ctx.db.insert("pipelineLeads", { projectId: rocket, name: `Lead ${i + 1}`, source: "page", stage: i < 3 ? "New" : "Contacted", order: i, value: 900, tags: [], ...(i === 0 ? { unreadReplies: 2, lastReplyAt: now } : {}), createdAt: now - i * DAY, updatedAt: now - i * DAY });
  });
  return { token, teamId, seed: seedProject, sketch, forge, rocket };
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const unreachableApi = { info: { url: "http://127.0.0.1:9" } };
const cloud = fileURLToPath(new URL("./testing/origin-pulse-cloud.ts", import.meta.url));
const links = fileURLToPath(new URL("./testing/origin-journey-links.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(unreachableApi, {
    entry: "/scripts/testing/origin-journey-preview.tsx", route: "/__origin-journey.html", title: "Isolated Origin journey",
    extraRoutes: [
      { path: "/__origin-pulse.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, ...seeded })); } },
      { path: "/api/origin/avatar-looks", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ looks: {} })); } },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: /^@\/lib\/origin-cloud-links$/, replacement: links },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ previewUrl: preview.previewUrl, convexUrl: convex.url }));
  await parkUntilSignal();
} finally { await preview?.close(); await convex.close(); }
