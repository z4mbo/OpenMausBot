import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;
const DAY = 86_400_000;

/** Three projects at different stages: Rocket with a month of work, launch and sales; Apollo over budget with a failed run; Notes with only ideas. */
async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { name: "ada", email: "ada@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 }));
  const token = await t.run((ctx) => createSession(ctx, ownerId));
  const o = { query: (name: string, args: Json) => t.query(ref(name), { sessionToken: token, ...args }), mutation: (name: string, args: Json) => t.mutation(ref(name), { sessionToken: token, ...args }) };
  const { teamId } = await o.mutation("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const project = async (name: string) => String(await o.mutation("projects:create", { teamId, name }));
  const rocket = await project("Rocket");
  const apollo = await project("Apollo");
  const notes = await project("Notes");
  const now = Date.now();
  const ago = (days: number, hour = 11) => { const at = new Date(now - days * DAY); at.setUTCHours(hour, 0, 0, 0); return Math.min(at.getTime(), now - 60_000); };
  const wave = (i: number) => Math.round(3 + 2 * Math.sin(i / 3) + (i % 4 === 0 ? 2 : 0));

  const issueFields = { priority: "low", assignedToEmail: "ada@fixture.test", dueDate: new Date(now + 14 * DAY).toISOString().slice(0, 10) };
  for (const title of ["Referral programme", "Dark mode for the dashboard", "Usage-based pricing"]) {
    await o.mutation("tasks:createTask", { projectId: rocket, title, ...issueFields });
  }
  await o.mutation("tasks:createTask", { projectId: notes, title: "A notes app that writes itself", ...issueFields });

  await t.run(async (ctx: any) => {
    const membership = await ctx.db.query("teamMembers").withIndex("by_team", (q: any) => q.eq("teamId", teamId)).first();
    const columns = async (projectId: string) => {
      const rows = await ctx.db.query("columns").withIndex("by_project", (q: any) => q.eq("projectId", projectId)).collect();
      return { todo: rows.find((row: any) => !row.isDraft && !row.isDone)._id, done: rows.find((row: any) => row.isDone)?._id ?? rows.find((row: any) => !row.isDraft)._id };
    };
    const issues = async (projectId: string, count: number, doneEvery: number) => {
      const { todo, done } = await columns(projectId);
      let open = 0;
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const createdAt = ago(29 - (i * 29) / count, 9);
        const finished = i % doneEvery !== 0;
        const completedAt = Math.min(now - 60_000, createdAt + (1 + (i % 5)) * DAY / 2);
        const id = await ctx.db.insert("tasks", { teamId, projectId, columnId: finished ? done : todo, title: `Issue ${i + 1}`, priority: "medium", done: finished, order: i, createdAt, updatedAt: finished ? completedAt : createdAt, ...(finished ? { completedAt } : {}) });
        if (finished) await ctx.db.insert("taskCompletions", { teamId, projectId, taskId: id, completedAt });
        else open += 1;
        ids.push(id);
      }
      const project = await ctx.db.get(projectId);
      await ctx.db.patch(projectId, { openIssueCount: (project.openIssueCount ?? 0) + open });
      return ids;
    };
    const rocketIssues = await issues(rocket, 34, 3);
    const apolloIssues = await issues(apollo, 6, 2);

    const pull = (projectId: string, taskId: string, number: number, state: string, review: string) => ctx.db.insert("taskPullRequests", { projectId, taskId, requesterUserId: ownerId, number, url: `https://github.com/fixture/app/pull/${number}`, branch: `issue-${number}`, state, checks: "success", review, updatedAt: now });
    await pull(rocket, rocketIssues[0], 41, "open", "approved");
    await pull(rocket, rocketIssues[3], 42, "open", "unknown");
    for (const n of [37, 38, 39]) await pull(rocket, rocketIssues[n - 36], n, "merged", "approved");
    await pull(apollo, apolloIssues[0], 12, "open", "changes_requested");

    const canvasId = await ctx.db.insert("canvases", { teamId, projectId: rocket, name: "Site", archived: false, createdAt: now, updatedAt: now });
    const page = (slug: string, title: string, views: number) => ctx.db.insert("publishedPages", { teamId, projectId: rocket, canvasId, frameId: slug, site: "fixture", slug, title, description: "", body: "", background: "#000", fonts: [], leadForms: 1, views, publishedBy: "ada", publishedAt: ago(20), updatedAt: ago(20) });
    await page("home", "Rocket", 1_820);
    await page("pricing", "Pricing", 344);
    for (let i = 1; i < 30; i++) await ctx.db.insert("pulseDays", { projectId: rocket, day: new Date(now - i * DAY).toISOString().slice(0, 10), pageViews: 40 + wave(i) * 18 + (i < 9 ? 60 : 0) });

    const posts: string[] = [];
    for (const [days, channel] of [[27, "x"], [22, "bluesky"], [16, "x"], [12, "linkedin"], [8, "x"], [5, "bluesky"], [3, "x"], [1, "x"]] as const) {
      posts.push(await ctx.db.insert("broadcastPosts", { projectId: rocket, variants: [{ channel, text: "Rocket update", result: "published", publishedAt: ago(days, 15) }], assetIds: [], status: "published", authorUserId: ownerId, createdAt: ago(days, 10), updatedAt: ago(days, 15) }));
    }
    await ctx.db.insert("broadcastPosts", { projectId: rocket, variants: [{ channel: "x", text: "Coming soon" }], assetIds: [], status: "scheduled", scheduledAt: now + DAY, authorUserId: ownerId, createdAt: now, updatedAt: now });
    await ctx.db.insert("campaigns", {
      projectId: rocket, name: "Spring launch", slug: "spring-launch", goal: "", audience: "", channels: ["x"], status: "running", postIds: posts.slice(-3), generationIds: [], leadIds: [], taskIds: [],
      metrics: [{ postId: posts.at(-1), channel: "x", likes: 128, reposts: 31, replies: 12, impressions: 9_400, at: now }, { postId: posts.at(-2), channel: "x", likes: 64, reposts: 9, replies: 4, impressions: 3_100, at: now }],
      createdBy: ownerId, createdAt: ago(10), updatedAt: ago(1),
    });

    const stages = ["New", "New", "Contacted", "Contacted", "Qualified", "Proposal", "Won", "Lost", "New", "Contacted", "Won", "Qualified"];
    for (let i = 0; i < 26; i++) {
      const stage = stages[i % stages.length];
      const createdAt = ago(29 - i, 13);
      const id = await ctx.db.insert("pipelineLeads", { projectId: rocket, name: `Lead ${i + 1}`, source: i % 3 ? "page" : "import", stage, order: i, value: 400 + (i % 5) * 350, tags: [], ...(i === 24 || i === 25 ? { unreadReplies: i === 25 ? 2 : 1, lastReplyAt: now } : {}), stageChangedAt: createdAt + DAY, createdAt, updatedAt: createdAt + DAY });
      if (i === 23) await ctx.db.insert("pipelineActivities", { projectId: rocket, leadId: id, kind: "email", status: "pending", actor: { kind: "agent", name: "Atlas" }, subject: "Following up", body: "Hi", createdAt: now, updatedAt: now });
    }

    const agent = (projectId: string, name: string) => ctx.db.insert("workspaceAgents", { teamId, createdBy: ownerId, name, avatarSeed: name, avatarColor: "green", instructions: "", engine: "claude", model: "claude-haiku-5-5", effort: "low", skills: [], approvalMode: "ask", destructiveMode: "ask", disabled: false, kind: "chief", projectId, createdAt: now, updatedAt: now });
    const run = (projectId: string, agentId: string, createdAt: number, status: string, costUsd: number) => ctx.db.insert("workspaceAgentRuns", {
      teamId, projectId, requesterUserId: ownerId, requesterMembershipId: membership._id, actorAgentId: agentId, status, task: "Work on an issue", engine: "claude", model: "claude-haiku-5-5", effort: "low",
      depth: 0, eventSequence: 0, lastEventAt: createdAt, usage: { input: 1_000, output: 400, costUsd }, ...(status === "running" ? {} : { endedAt: createdAt + 600_000 }), createdAt, updatedAt: createdAt + 600_000,
    });
    const atlas = await agent(rocket, "Atlas");
    const kai = await agent(rocket, "Kai");
    for (let i = 0; i < 30; i++) for (let k = 0; k < wave(i) - 1; k++) await run(rocket, k % 2 ? kai : atlas, ago(i, 8 + k), "succeeded", 0.35 + (k % 3) * 0.2);
    await run(rocket, kai, ago(0, 9), "running", 0);
    const iris = await agent(apollo, "Iris");
    for (let i = 0; i < 6; i++) await run(apollo, iris, ago(i * 2, 10), i === 1 ? "failed" : "succeeded", 2.4);
    const month = new Date(now).toISOString().slice(0, 7);
    await ctx.db.insert("agentBudgets", { teamId, projectId: rocket, monthlyUsd: 120, updatedBy: ownerId, updatedAt: now });
    await ctx.db.insert("budgetSpend", { teamId, projectId: rocket, month, costUsd: 71.4, runs: 120, updatedAt: now });
    await ctx.db.insert("agentBudgets", { teamId, projectId: apollo, monthlyUsd: 10, updatedBy: ownerId, updatedAt: now });
    await ctx.db.insert("budgetSpend", { teamId, projectId: apollo, month, costUsd: 14.4, runs: 6, updatedAt: now });
  });
  for (let i = 0; i < 37; i++) await t.mutation(ref("pages:viewed"), { site: "fixture", slug: i % 4 ? "home" : "pricing" });
  return { token, teamId, rocket, apollo, notes };
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const fixture = await launchVerificationServer();
const cloud = fileURLToPath(new URL("./testing/origin-pulse-cloud.ts", import.meta.url));
const links = fileURLToPath(new URL("./testing/origin-pulse-links.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-pulse-preview.tsx", route: "/__origin-pulse.html", title: "Isolated Origin Pulse",
    extraRoutes: [{ path: "/__origin-pulse.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, ...seeded })); } }],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: /^@\/lib\/origin-cloud-links$/, replacement: links },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await convex.close(); }
