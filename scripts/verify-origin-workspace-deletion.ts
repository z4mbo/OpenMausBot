// Two Origin workspaces in disposable fake-engine harnesses backed by the real Convex functions in memory: the owner's
// computer switches to the second and talks to its project agent, then deletes the first and checks nothing of it is
// left, in Origin or there; a member's computer then removes its own copy of the first and keeps the second.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { startFakeConvex } from "./testing/origin-convex-backend.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";
import type { WireBot, WireMessage } from "../shared/wire.ts";

type Deletion = typeof import("../src/lib/origin-workspace-deletion.ts");
type MemberCleanup = typeof import("../src/lib/origin-deleted-workspaces.ts");
type DeletedWorkspace = import("../src/lib/origin-deleted-workspaces.ts").DeletedWorkspace;
type Workspaces = typeof import("../src/lib/origin-workspaces.ts");

const backend = await startFakeConvex();
const evidence = { checks: [] as string[], harness: { url: "", logPath: "" }, leftovers: [] as string[], memberNotice: "" };
const mutation = <T>(name: string, args: Record<string, unknown>) => backend.t.mutation(backend.ref(name), args) as Promise<T>;
const query = <T>(name: string, args: Record<string, unknown>) => backend.t.query(backend.ref(name), args) as Promise<T>;
const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Workspace deletion fixture timed out");
};
const ANSWER = "Bakery's pre-orders are next.";
const lead = { title: "Project lead", description: "Runs this project.", soul: "You run this project." };

const fixture = await launchVerificationServer({ ...process.env, OMB_TEST_PORTS: "27310-27380", FAKE_CLAUDE_REPLIES: JSON.stringify([ANSWER]) });
let memberFixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
try {
  evidence.harness = { url: fixture.info.url, logPath: fixture.info.logPath };
  const { localWorkspaceContents, deleteLocalWorkspace } = await backend.load<Deletion>("../src/lib/origin-workspace-deletion.ts");
  const { switchableWorkspaceHeads, inWorkspace } = await backend.load<Workspaces>("../src/lib/origin-workspaces.ts");
  const { removeDeletedWorkspaces, takeUnnoticed, deletedNoticeText } = await backend.load<MemberCleanup>("../src/lib/origin-deleted-workspaces.ts");
  const { createSession } = await backend.load<{ createSession(ctx: unknown, id: string): Promise<string> }>("convex/lib/auth.ts");
  const person = (name: string) => backend.t.run(async ctx => {
    const now = Date.now();
    const id = await ctx.db.insert("users", { name, email: `${name.toLowerCase()}@deletion.example.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
    return { id, token: await createSession(ctx, id) };
  });
  const ada = await person("Ada");
  const bea = await person("Bea");
  const sessionToken = ada.token;
  const workspace = async (name: string, project: string) => {
    const { teamId } = await mutation<{ teamId: string }>("workspaces:create", { sessionToken, name });
    const projectId = await mutation<string>("projects:create", { sessionToken, teamId, name: project });
    const columns = (await query<{ columns: { _id: string }[] }>("tasks:board", { sessionToken, projectId })).columns;
    await mutation("tasks:createTask", { sessionToken, projectId, columnId: columns[1]!._id, title: `${project} launch`, priority: "high", assignedToEmail: "ada@deletion.example.test", dueDate: "2026-12-31" });
    await mutation("credentials:create", { sessionToken, projectId, title: "Vault entry", ciphertext: "c", iv: "i", salt: "s", iterations: 600000, kdf: "PBKDF2" });
    await mutation("agents:setSharedAgents", { sessionToken, teamId, enabled: true });
    await mutation("agents:publishProjectTeam", { sessionToken, teamId, projectId, agents: [{ roleKey: "chief", kind: "chief", name: project }] });
    return { teamId, projectId };
  };
  const studio = await workspace("Studio", "Walkies");
  const shop = await workspace("Shop", "Bakery");

  const api = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
  await api("PUT", "/api/origin/cloud-session", { url: backend.url, sessionToken });
  const heads: Record<string, WireBot> = {};
  const chiefs: Record<string, WireBot> = {};
  for (const [name, cloud, project] of [["Studio", studio, "Walkies"], ["Shop", shop, "Bakery"]] as const) {
    heads[name] = (await api("POST", "/api/origin/import/workspaces", { cloudTeamId: cloud.teamId }) as { bot: WireBot }).bot;
    chiefs[project] = (await api("POST", "/api/origin/import/projects", { cloudProjectId: cloud.projectId, cloudTeamId: cloud.teamId, workspaceId: heads[name].id, ...lead }) as { bot: WireBot }).bot;
  }
  const agent = async (name: string, section: string) => (await api("POST", "/api/bots", { name, section, memoryEnabled: false, memoryUpkeep: false, notifications: false }) as { bot: WireBot }).bot;
  const nova = await agent("Nova", chiefs.Walkies.section!);
  const crumb = await agent("Crumb", chiefs.Bakery.section!);
  const scout = await agent("Scout", "Agents");
  const bots = async () => (await api("GET", "/api/bots") as { bots: WireBot[] }).bots;

  for (const cloud of [studio, shop]) {
    const { token } = await mutation<{ token: string }>("workspaces:createInvite", { sessionToken, teamId: cloud.teamId, projectId: cloud.projectId, role: "member" });
    await mutation("workspaces:acceptInvite", { sessionToken: bea.token, token });
  }
  memberFixture = await launchVerificationServer({ ...process.env, OMB_TEST_PORTS: "27310-27380" });
  const memberUrl = memberFixture.info.url;
  const memberApi = fixtureApi(memberUrl, { headers: { origin: memberUrl } });
  await memberApi("PUT", "/api/origin/cloud-session", { url: backend.url, sessionToken: bea.token });
  const beaHeads: Record<string, WireBot> = {};
  const beaChiefs: Record<string, WireBot> = {};
  for (const [name, cloud, project] of [["Studio", studio, "Walkies"], ["Shop", shop, "Bakery"]] as const) {
    beaHeads[name] = (await memberApi("POST", "/api/origin/import/workspaces", { cloudTeamId: cloud.teamId }) as { bot: WireBot }).bot;
    beaChiefs[project] = (await memberApi("POST", "/api/origin/import/projects", { cloudProjectId: cloud.projectId, cloudTeamId: cloud.teamId, workspaceId: beaHeads[name].id, ...lead }) as { bot: WireBot }).bot;
  }
  const pip = (await memberApi("POST", "/api/bots", { name: "Pip", section: beaChiefs.Walkies.section, memoryEnabled: false, memoryUpkeep: false, notifications: false }) as { bot: WireBot }).bot;
  const huddle = (await memberApi("POST", "/api/groups", { memberIds: [pip.id, beaChiefs.Walkies.id], name: "Huddle", section: beaChiefs.Walkies.section }) as { group: { id: string } }).group;
  const memberCall = async (path: string, init: { method: string }) => {
    const response = await fetch(`${memberUrl}${path}`, { method: init.method, headers: { origin: memberUrl } });
    if (!response.ok) throw Object.assign(new Error(`${init.method} ${path}: ${response.status} ${await response.text()}`), { status: response.status });
  };
  const memberRound = async () => {
    const deleted = await query<DeletedWorkspace[]>("workspaces:deleted", { sessionToken: bea.token });
    const listed = new Set((await query<{ _id: string }[]>("workspaces:list", { sessionToken: bea.token })).map(row => row._id));
    const links = await memberApi("GET", "/api/origin/cloud-links") as { workspaces: Record<string, string> };
    const local = await memberApi("GET", "/api/bots") as { bots: WireBot[]; groups: { id: string; name: string; section?: string }[] };
    return { deleted, outcome: await removeDeletedWorkspaces({ deleted, listed, workspaceLinks: links.workspaces, bots: local.bots, groups: local.groups, call: memberCall }) };
  };
  const memberBots = async () => new Set((await memberApi("GET", "/api/bots") as { bots: WireBot[] }).bots.map(bot => bot.id));

  const shopMembership = await backend.t.run(async ctx => {
    const db = ctx.db as unknown as { query(table: string): { collect(): Promise<Array<{ _id: string; teamId: string; email: string }>> } };
    return (await db.query("teamMembers").collect()).find(row => row.teamId === shop.teamId && row.email === "bea@deletion.example.test")!._id;
  });
  await mutation("teams:removeMember", { sessionToken, teamId: shop.teamId, memberId: shopMembership });
  const removedOnly = await memberRound();
  assert.deepEqual([removedOnly.deleted, removedOnly.outcome.found], [[], []]);
  const beforeDeletion = await memberBots();
  for (const stays of [beaHeads.Shop.id, beaChiefs.Bakery.id, beaHeads.Studio.id, pip.id]) assert.ok(beforeDeletion.has(stays));
  evidence.checks.push("Bea, removed from Shop but not deleted from anything, keeps every local copy on her computer: Origin reports no deleted workspace for her");

  const switchable = switchableWorkspaceHeads((await bots()).map(bot => bot.id === heads.Shop.id ? { ...bot, pinned: true } : bot));
  assert.deepEqual(new Set(switchable.map(bot => bot.id)), new Set([heads.Studio.id, heads.Shop.id]));
  assert.deepEqual(await api("PUT", "/api/workspaces/active", { id: heads.Shop.id }), { active: heads.Shop.id });
  const shopHead = (await bots()).find(bot => bot.id === heads.Shop.id)!;
  assert.ok(inWorkspace(shopHead, chiefs.Bakery) && !inWorkspace(shopHead, chiefs.Walkies));
  evidence.checks.push("Both imported workspaces stay switchable (Shop's head pinned); after switching to Shop its project is listed and Studio's is not");

  await api("POST", `/api/bots/${crumb.id}/messages`, { text: "What is next for Bakery?", sendId: randomUUID() });
  await runControlOmb(["wait", "--bot", crumb.id, "--timeout", "30", "--url", fixture.info.url]);
  const reply = await eventually(async () => (await api("GET", `/api/threads/${crumb.threadId}/messages?limit=50`) as { messages: WireMessage[] }).messages,
    rows => rows.some(row => row.role === "bot" && row.text === ANSWER));
  assert.ok(reply.some(row => row.role === "user" && row.text === "What is next for Bakery?"));
  evidence.checks.push(`After switching, Shop's project agent Crumb answers the question: ${JSON.stringify(ANSWER)}`);

  const contents = localWorkspaceContents(heads.Studio.id, await bots(), [], studio.teamId);
  assert.deepEqual(new Set(contents.bots.map(bot => bot.id)), new Set([nova.id, chiefs.Walkies.id]));
  await deleteLocalWorkspace(contents, (path, init) => api(init.method, path), async () => {
    await mutation("workspaces:remove", { sessionToken, teamId: studio.teamId, confirmName: "Studio" });
  });
  assert.deepEqual((await query<{ name: string }[]>("workspaces:list", { sessionToken })).map(row => row.name), ["Shop"]);
  evidence.checks.push("Deleting Studio removed it from the account's workspace list at once");

  await eventually(() => backend.t.run(ctx => (ctx.db as unknown as { get(id: string): Promise<unknown> }).get(studio.teamId)), team => team === null);
  const { default: schema } = await backend.load<{ default: { tables: Record<string, unknown> } }>("convex/schema.ts");
  const naming = (ids: string[]) => backend.t.run(async ctx => {
    const found: string[] = [];
    const db = ctx.db as unknown as { query(table: string): { collect(): Promise<Array<Record<string, unknown>>> } };
    for (const table of Object.keys(schema.tables)) {
      for (const row of await db.query(table).collect()) {
        const fields = JSON.stringify({ ...row, _id: undefined });
        if (ids.some(id => row._id === id || fields.includes(`"${id}"`))) found.push(`${table}:${String(row._id)}`);
      }
    }
    return found;
  });
  const named = await naming([studio.teamId, studio.projectId]);
  evidence.leftovers = named.filter(row => !row.startsWith("deletedWorkspaces:"));
  assert.deepEqual(evidence.leftovers, []);
  assert.equal(named.length, 2);
  const kept = await naming([shop.teamId, shop.projectId]);
  assert.ok(kept.some(row => row.startsWith("tasks:")) && kept.some(row => row.startsWith("credentials:")) && kept.some(row => row.startsWith("workspaceAgents:")));
  evidence.checks.push(`No Origin row names Studio or Walkies after the scheduled purge except the deletion notices for its two members, Ada and Bea; Shop keeps ${kept.length} rows`);

  const left = new Set((await bots()).map(bot => bot.id));
  for (const gone of [heads.Studio.id, chiefs.Walkies.id, nova.id]) assert.ok(!left.has(gone));
  for (const stays of [heads.Shop.id, chiefs.Bakery.id, crumb.id, scout.id]) assert.ok(left.has(stays));
  const links = await api("GET", "/api/origin/cloud-links") as { workspaces: Record<string, string>; projects: Record<string, string> };
  assert.deepEqual(links.workspaces, { [heads.Shop.id]: shop.teamId });
  assert.deepEqual(links.projects, { [chiefs.Bakery.id]: shop.projectId });
  const sections = (await api("GET", "/api/sidebar-sections") as { sections: string[] }).sections;
  assert.ok(!sections.includes(chiefs.Walkies.section!) && !sections.includes(heads.Studio.section!));
  evidence.checks.push("On this computer Studio's head, the Walkies Chief and Nova, their links and teams are gone; Shop, Bakery, Crumb and the standalone Scout remain");

  const [adaDeleted] = await query<DeletedWorkspace[]>("workspaces:deleted", { sessionToken });
  assert.equal(adaDeleted?.byYou, true);
  const { deleted, outcome } = await memberRound();
  assert.deepEqual(deleted.map(row => [row.teamId, row.name, row.deletedBy, row.byYou]), [[studio.teamId, "Studio", "Ada", false]]);
  assert.deepEqual(outcome.failures, []);
  assert.deepEqual(outcome.found.map(row => row.teamId), [studio.teamId]);
  const afterDeletion = await memberBots();
  for (const gone of [beaHeads.Studio.id, beaChiefs.Walkies.id, pip.id]) assert.ok(!afterDeletion.has(gone));
  for (const stays of [beaHeads.Shop.id, beaChiefs.Bakery.id]) assert.ok(afterDeletion.has(stays));
  const memberLocal = await memberApi("GET", "/api/bots") as { groups: { id: string }[] };
  assert.ok(!memberLocal.groups.some(group => group.id === huddle.id));
  const memberLinks = await memberApi("GET", "/api/origin/cloud-links") as { workspaces: Record<string, string> };
  assert.deepEqual(memberLinks.workspaces, { [beaHeads.Shop.id]: shop.teamId });
  const memberSections = (await memberApi("GET", "/api/sidebar-sections") as { sections: string[] }).sections;
  assert.ok(!memberSections.includes(beaChiefs.Walkies.section!) && !memberSections.includes(beaHeads.Studio.section!));
  evidence.checks.push("After Ada deleted Studio, Bea's computer removed Studio's head, the Walkies Chief, Pip and the Huddle chat with their links and teams; the Shop copy she was only removed from stays");

  const rerun = await memberRound();
  assert.deepEqual([rerun.outcome.found, rerun.outcome.failures], [[], []]);
  const browserStorage = new Map<string, string>();
  globalThis.localStorage ??= { getItem: (key: string) => browserStorage.get(key) ?? null, setItem: (key: string, value: string) => { browserStorage.set(key, value); } } as Storage;
  const [notice] = takeUnnoticed(outcome.found, deleted);
  assert.deepEqual(takeUnnoticed(outcome.found, deleted), []);
  evidence.memberNotice = deletedNoticeText(notice!, true);
  assert.equal(evidence.memberNotice, "Studio was deleted by Ada. Its agents, chats and teams on this computer were removed too.");
  evidence.checks.push(`A second round on Bea's computer finds nothing left to remove, and she is told once: ${JSON.stringify(evidence.memberNotice)}`);
} finally {
  await memberFixture?.close();
  await fixture.close();
  await backend.close();
}
assert.ok(!existsSync(fixture.info.dataDir) && !existsSync(memberFixture!.info.dataDir));
evidence.checks.push("Both temporary harness data directories and the in-memory backend are closed and removed");
const folder = fileURLToPath(new URL("../docs/verification/evidence/origin-workspace-deletion-cascade/", import.meta.url));
await mkdir(folder, { recursive: true });
await writeFile(new URL("report.json", `file:///${folder.replaceAll("\\", "/")}`), `${JSON.stringify({ ...evidence, harness: { logPath: "(temporary)" } }, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
