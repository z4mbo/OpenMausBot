// Every core project section in the full renderer, in a disposable workspace: the real Convex functions in memory,
// a fake-engine server with a Chief and two agents, and the project bar of a seeded launch project.
// Without --park it runs scripts/testing/check-origin-core-sections.mjs against the preview and exits.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";
import { encryptSecret } from "../src/components/origin-pages/vaultCrypto.ts";

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
  const projectId = String(await as("projects:create", { teamId, name: "Walkies", repoUrl: "https://github.com/fixture/walkies" }));
  await insert("members", { projectId, userId: ben.userId, email: "ben@fixture.test", name: "Ben Okafor", role: "member", status: "active", createdAt: now, updatedAt: now });
  await as("tasks:ensureDefaultColumns", { projectId });
  const issue = (title: string, extra: Json = {}) => as("tasks:createTask", { projectId, title, priority: "medium", assignedToEmail: "ada@fixture.test", dueDate: day(10), ...extra }).then(String);
  const mvp = [
    await issue("Walker sign-up and vetting", { priority: "high", description: "Collect ID, references and a short video intro before a walker can accept bookings." }),
    await issue("Book a walk for today", { priority: "high", dueDate: day(1) }),
    await issue("Live walk map", { assignedToEmail: "ben@fixture.test" }),
    await issue("Pay in the app", { priority: "low", dueDate: day(-1) }),
  ];
  const launch = [await issue("Launch landing page"), await issue("Launch week posts", { priority: "low", assignedToEmail: "ben@fixture.test" })];
  await issue("Pick a name for the push notifications", { priority: "low" });
  const { columns } = await t.query(ref("tasks:board"), { sessionToken: ada.token, projectId }) as { columns: { _id: string; title: string }[] };
  const column = (title: string) => columns.find((item) => item.title.toLowerCase() === title)?._id;
  const doing = column("in progress");
  const todo = column("todo");
  if (doing) await as("tasks:moveTask", { projectId, taskId: mvp[1], columnId: doing });
  if (todo) for (const taskId of [mvp[2], mvp[3], launch[0]]) await as("tasks:moveTask", { projectId, taskId, columnId: todo });
  await t.run((ctx) => ctx.db.patch(mvp[0] as never, { done: true, updatedAt: now }));
  await as("tasks:addComment", { projectId, taskId: mvp[1], body: "The booking sheet works on phones; the calendar picker still needs a pass." });
  const milestone = (title: string, targetDate: string) => as("projectMilestones:save", { projectId, title, targetDate }).then(String);
  await as("projectMilestones:assign", { projectId, milestoneId: await milestone("MVP", day(14)), taskIds: mvp });
  await as("projectMilestones:assign", { projectId, milestoneId: await milestone("Launch", day(30)), taskIds: launch });
  const swatch = (fill: string, label: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/><circle cx="440" cy="160" r="100" fill="white" fill-opacity="0.18"/><text x="24" y="370" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`)}`;
  await insert("designAssets", { projectId, type: "image", name: "Launch hero.png", url: swatch("#3b5bdb", "hero"), contentType: "image/svg+xml", folder: "Brand", createdAt: now, updatedAt: now });
  await insert("designAssets", { projectId, type: "image", name: "App icon", url: swatch("#2b8a3e", "icon"), contentType: "image/svg+xml", folder: "Brand", createdAt: now - 1, updatedAt: now - 1 });
  await insert("designAssets", { projectId, type: "image", name: "Walker onboarding", url: swatch("#a61e4d", "onboarding"), contentType: "image/svg+xml", createdAt: now - 2, updatedAt: now - 2 });
  await insert("designAssets", { projectId, type: "document", name: "Press kit.pdf", url: "https://cdn.fixture.test/press-kit.pdf", createdAt: now - 3, updatedAt: now - 3 });
  const secret = await encryptSecret("sk_test_fixture_only", "fixture-passphrase");
  await insert("credentials", { projectId, title: "Stripe test key", kind: "api_key", agentUse: true, username: "billing@fixture.test", ...secret, createdAt: now, updatedAt: now });
  await insert("credentials", { projectId, title: "App Store login", kind: "password", username: "ada@fixture.test", url: "https://appstoreconnect.apple.com", ...secret, createdAt: now - 1, updatedAt: now - 1 });
  await as("feedback:configure", { teamId, projectId, title: "Walkies feedback", description: "Tell us what to fix", enabled: true });
  const portal = await t.run((ctx) => ctx.db.query("feedbackPortals").first());
  await insert("feedbackEntries", { portalId: portal!._id, title: "Walk map freezes on older Android phones", body: "The map stops updating after about two minutes on a Pixel 4a.", kind: "bug", status: "new", createdAt: now - 60_000 });
  await insert("feedbackEntries", { portalId: portal!._id, title: "Let me tip my walker", body: "Our walker went the extra mile in the rain. A tip button would be lovely.", kind: "idea", status: "new", createdAt: now - 120_000 });
  await insert("githubPullRequests", { projectId, number: 12, title: "Booking sheet for today's walks", state: "open", url: "https://github.com/fixture/walkies/pull/12", author: "nova-bot", branch: "book-today", createdAt: now, updatedAt: now, syncedAt: now });
  await insert("commits", { projectId, sha: "9f3c2a1b7d", message: "Walker vetting form", author: "ada", committedAt: now - 7_200_000, createdAt: now });
  await insert("githubBranchProtections", { projectId, repoUrl: "https://github.com/fixture/walkies", branch: "main", state: "on", checkedAt: now });
  await as("callNotes:record", {
    projectId, callName: "Kickoff", startedAt: now - 3_600_000, minutes: 24,
    keyPoints: ["Ten walkers signed up for the pilot"], decisions: ["Launch in one neighbourhood first"],
    actionItems: [{ title: "Draft the walker agreement", owner: "Ada" }],
  });
  return { token: ada.token, benToken: ben.token, teamId, projectId };
}

const park = process.argv.includes("--park");
const convex = await startFakeConvex();
const seeded = await seed(convex);
const live = await launchVerificationServer({
  ...process.env,
  FAKE_CLAUDE_REPLIES: JSON.stringify(["Walkies is on track. Book a walk for today is in progress with Nova, and the MVP milestone is one issue in. I suggest we finish the walk map before the landing page."]),
});
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const api = fixtureApi(live.info.url);
  const bot = async (name: string, patch: Json) => {
    const created = (await runControlOmb(["new-bot", "--name", name, "--url", live.info.url]) as { bot: { id: string; activeTaskId: string } }).bot;
    await api("PATCH", `/api/bots/${created.id}`, { section: "Walkies", ...patch });
    return created;
  };
  const chief = await bot("Atlas", { title: "Chief" });
  await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Walkies"], acknowledgePeerScope: true });
  await bot("Nova", { title: "Developer", color: "blue" });
  await bot("Echo", { title: "Designer", color: "pink" });
  writeFileSync(join(live.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.token, projects: { [chief.id]: seeded.projectId }, workspaces: {} }), { mode: 0o600 });
  await api("PATCH", "/api/config", { language: "en" });
  await api("POST", `/api/bots/${chief.id}/messages`, { text: "Where does Walkies stand?", threadId: chief.activeTaskId });
  const chat = { teamId: seeded.teamId, conversation: `project:${seeded.projectId}` };
  const post = (token: string, text: string) => fetch(`${live.info.url}/api/local-chat/messages?${new URLSearchParams(chat)}`, {
    method: "POST", headers: { "content-type": "application/json", "x-origin-session": token }, body: JSON.stringify({ body: text }),
  }).then(async (response) => { if (!response.ok) throw new Error(`team chat seed: ${await response.text()}`); });
  await post(seeded.benToken, "Pilot walkers are booked for Saturday. Can someone check the map on Android?");
  await post(seeded.token, "On it. Nova is on the booking sheet, I'll take the map after lunch.");

  const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
  preview = await mountPreview(live, {
    entry: "/scripts/testing/threads-preview.tsx", route: "/__origin-core-sections.html", title: "Isolated Origin core sections",
    extraRoutes: [{ path: "/__origin-campaigns.json", handler: (_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ url: convex.url, token: seeded.token, viewerToken: seeded.benToken, projectId: seeded.projectId })); } }],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$|^\.\/origin-cloud\/client$/, replacement: cloud },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  const info = { ...live.info, previewUrl: preview.previewUrl, convexUrl: convex.url, chiefId: chief.id };
  console.log(JSON.stringify(info));
  if (park) await parkUntilSignal();
  else {
    const check = spawn(process.execPath, [join(REPO_ROOT, "scripts", "testing", "check-origin-core-sections.mjs"), preview.previewUrl], { stdio: "inherit", env: process.env });
    process.exitCode = await new Promise<number>((resolve) => check.on("exit", (code) => resolve(code ?? 1)));
  }
} finally {
  await preview?.close();
  await live.close();
  await convex.close();
}
