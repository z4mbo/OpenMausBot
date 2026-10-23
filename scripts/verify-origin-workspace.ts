// The workspace-level pages in the full renderer, in a disposable workspace: the real Convex functions in memory,
// a fake-engine server with a workspace head, two projects with Chiefs, a standalone agent, routines and a scheduled call.
// Without --park it runs scripts/testing/check-origin-workspace.mjs against the preview and exits.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const day = (offset: number) => { const at = new Date(); at.setDate(at.getDate() + offset); return at.toISOString().slice(0, 10); };

async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const now = Date.now();
  const user = (name: string, email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const ada = await user("Ada Lovelace", "ada@fixture.test");
  const ben = await user("Ben Okafor", "ben@fixture.test");
  const as = (name: string, args: Json) => t.mutation(ref(name), { sessionToken: ada.token, ...args });
  const insert = (table: string, row: Json) => t.run((ctx) => ctx.db.insert(table as never, row as never));
  const { teamId } = await as("workspaces:create", { name: "Fixture studio" }) as { teamId: string };
  await insert("teamMembers", { teamId, userId: ben.userId, email: "ben@fixture.test", name: "Ben Okafor", role: "member", status: "active", createdAt: now, updatedAt: now, joinedAt: now });
  const project = async (name: string, issues: [string, Json?][]) => {
    const projectId = String(await as("projects:create", { teamId, name }));
    await as("tasks:ensureDefaultColumns", { projectId });
    for (const [title, extra] of issues) await as("tasks:createTask", { projectId, title, priority: "medium", assignedToEmail: "ada@fixture.test", dueDate: day(7), ...extra });
    return projectId;
  };
  const walkies = await project("Walkies", [["Book a walk for today", { priority: "high", dueDate: day(1) }], ["Live walk map"], ["Launch landing page", { priority: "low" }]]);
  const bakery = await project("Bakery", [["Online pre-orders", { priority: "high" }], ["Weekend menu photos"]]);
  return { token: ada.token, benToken: ben.token, teamId, walkies, bakery };
}

const park = process.argv.includes("--park");
const convex = await startFakeConvex();
const seeded = await seed(convex);
const live = await launchVerificationServer({
  ...process.env,
  FAKE_CLAUDE_REPLIES: JSON.stringify(["Walkies has three open issues and Bakery two; the walk booking is the most urgent."]),
});
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const api = fixtureApi(live.info.url);
  const bot = async (name: string, patch: Json) => {
    const created = (await runControlOmb(["new-bot", "--name", name, "--url", live.info.url]) as { bot: { id: string; activeTaskId: string } }).bot;
    await api("PATCH", `/api/bots/${created.id}`, patch);
    return created;
  };
  const head = (await api("POST", "/api/workspaces", { name: "Fixture studio" }) as { bot: { id: string } }).bot;
  const atlas = await bot("Atlas", { section: "Walkies" });
  await api("PATCH", `/api/bots/${atlas.id}`, { chiefOfStaff: true, managedSections: ["Walkies"], acknowledgePeerScope: true });
  const nova = await bot("Nova", { section: "Walkies", title: "Developer", color: "blue" });
  const bea = await bot("Bea", { section: "Bakery" });
  await api("PATCH", `/api/bots/${bea.id}`, { chiefOfStaff: true, managedSections: ["Bakery"], acknowledgePeerScope: true });
  const scout = await bot("Scout", { section: "Agents", title: "Researcher", color: "pink" });
  await api("PATCH", `/api/bots/${head.id}`, { managedSections: ["Walkies", "Bakery"], acknowledgePeerScope: true });
  writeFileSync(join(live.info.dataDir, "origin-cloud.json"), JSON.stringify({
    url: convex.url, sessionToken: seeded.token, projects: { [atlas.id]: seeded.walkies, [bea.id]: seeded.bakery }, workspaces: { [head.id]: seeded.teamId },
  }), { mode: 0o600 });
  await api("PUT", "/api/origin/cloud-links", { workspaces: { [head.id]: seeded.teamId } });
  await api("PATCH", "/api/config", { language: "en" });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 30, 0, 0);
  await api("POST", "/api/routines", { name: "Morning stand-up", prompt: "Summarise yesterday's progress on Walkies.", botId: atlas.id, schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] } });
  await api("POST", "/api/routines", { name: "Competitor scan", prompt: "Scan bakery competitors for new offers.", botId: scout.id, schedule: { type: "cron", expression: "0 8 * * 1", timeZone: "UTC" } });
  await api("POST", "/api/calendar-calls", { name: "Launch review", description: "Walk through the launch checklist.", botIds: [atlas.id, nova.id], schedule: { type: "once", at: tomorrow.getTime() }, durationMinutes: 30 });
  const chat = { teamId: seeded.teamId, conversation: `project:${seeded.walkies}` };
  const post = (token: string, text: string) => fetch(`${live.info.url}/api/local-chat/messages?${new URLSearchParams(chat)}`, {
    method: "POST", headers: { "content-type": "application/json", "x-origin-session": token }, body: JSON.stringify({ body: text }),
  }).then(async (response) => { if (!response.ok) throw new Error(`team chat seed: ${await response.text()}`); });
  await post(seeded.token, "Pilot walkers are booked for Saturday.");
  await api("POST", `/api/bots/${head.id}/messages`, { text: "What needs me today?" });

  const cloud = fileURLToPath(new URL("./testing/origin-workspace-cloud.ts", import.meta.url));
  preview = await mountPreview(live, {
    entry: "/scripts/testing/threads-preview.tsx", route: "/__origin-workspace.html", title: "Isolated Origin workspace",
    extraRoutes: [{ path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.token, viewerToken: seeded.benToken, projectId: seeded.walkies })); } }],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$|^\.\/origin-cloud\/client$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  const info = { ...live.info, previewUrl: preview.previewUrl, convexUrl: convex.url, headId: head.id, scoutId: scout.id };
  console.log(JSON.stringify(info));
  if (park) await parkUntilSignal();
  else {
    const check = spawn(process.execPath, [join(REPO_ROOT, "scripts", "testing", "check-origin-workspace.mjs"), preview.previewUrl, live.info.url, head.id, scout.id], { stdio: "inherit", env: process.env });
    process.exitCode = await new Promise<number>((resolve) => check.on("exit", (code) => resolve(code ?? 1)));
  }
} finally {
  await preview?.close();
  await live.close();
  await convex.close();
}
