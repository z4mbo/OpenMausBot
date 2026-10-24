import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
import { startFakeConvex, type FakeConvex } from "./testing/origin-campaigns-backend.ts";

type Json = Record<string, unknown>;

const day = (offset: number) => { const at = new Date(); at.setDate(at.getDate() + offset); return at.toISOString().slice(0, 10); };

/** Two projects: Walkies with its kickoff issues on the board, and an empty one. */
async function seed(convex: FakeConvex) {
  const { t, ref } = convex;
  const { createSession } = await convex.load<{ createSession(ctx: unknown, userId: string): Promise<string> }>("convex/lib/auth.ts");
  const user = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@fixture.test");
  const query = (name: string, args: Json) => t.query(ref(name), args);
  const mutation = (name: string, args: Json) => t.mutation(ref(name), args);
  const o = { query: (name: string, args: Json) => query(name, { sessionToken: owner.token, ...args }), mutation: (name: string, args: Json) => mutation(name, { sessionToken: owner.token, ...args }) };
  const { teamId } = await o.mutation("workspaces:create", { name: "Fixture" }) as { teamId: string };
  const walkies = String(await o.mutation("projects:create", { teamId, name: "Walkies" }));
  const empty = String(await o.mutation("projects:create", { teamId, name: "Empty idea" }));

  await o.mutation("tasks:ensureDefaultColumns", { projectId: walkies });
  const issue = (title: string) => o.mutation("tasks:createTask", { projectId: walkies, title, priority: "medium", assignedToEmail: "ada@fixture.test", dueDate: day(10) }).then(String);
  const mvp = await Promise.all(["Walker sign-up and vetting", "Book a walk for today", "Live walk map", "Pay in the app"].map(issue));
  await Promise.all(["Launch landing page", "Launch week posts"].map(issue));
  await issue("Pick a name for the push notifications");
  await o.mutation("tasks:updateTask", { projectId: walkies, taskId: mvp[0], done: true });
  return { ownerToken: owner.token, teamId, projects: { walkies, empty } };
}

const convex = await startFakeConvex();
const seeded = await seed(convex);
const fixture = await launchVerificationServer();
writeFileSync(join(fixture.info.dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken: seeded.ownerToken, projects: {} }), { mode: 0o600 });
const cloud = fileURLToPath(new URL("./testing/origin-campaigns-cloud.ts", import.meta.url));
const workspace = fileURLToPath(new URL("./testing/origin-launchpad-workspace.ts", import.meta.url));
const json = (body: unknown) => (_req: unknown, res: { setHeader(name: string, value: string): void; end(body: string): void }) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/origin-launchpad-preview.tsx", route: "/__origin-launchpad.html", title: "Isolated Origin Launchpad",
    extraRoutes: [
      { path: "/__origin-launchpad.json", handler: json({ url: convex.url, teamId: seeded.teamId, projects: seeded.projects }) },
      { path: "/__origin-campaigns.json", handler: json({ url: convex.url, token: seeded.ownerToken }) },
    ],
    aliases: [
      { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
      { find: /^@\/lib\/use-origin-workspace$/, replacement: workspace },
      { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
    ],
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, convexUrl: convex.url, ownerToken: seeded.ownerToken, teamId: seeded.teamId }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); await convex.close(); }
