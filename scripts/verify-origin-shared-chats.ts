import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "./control-omb.ts";
import { startFakeConvex } from "./testing/origin-convex-backend.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";
import type { WireBot, WireMessage } from "../shared/wire.ts";

const backend = await startFakeConvex({ subscriptions: true });
const fixtures: VerificationServer[] = [];
const evidence = { checks: [] as string[], harnesses: [] as { url: string; logPath: string }[], backend: backend.url };
const folder = fileURLToPath(new URL("../.omb-scratch/shared-chats/", import.meta.url));
const mutation = <T>(name: string, args: Record<string, unknown>) => backend.t.mutation(backend.ref(name), args) as Promise<T>;
const query = <T>(name: string, args: Record<string, unknown>) => backend.t.query(backend.ref(name), args) as Promise<T>;
const eventually = async <T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Shared-chat fixture timed out");
};

try {
  const { createSession } = await backend.load<{ createSession(ctx: unknown, id: string): Promise<string> }>("convex/lib/auth.ts");
  const people = await backend.t.run(async ctx => {
    const out = [];
    for (const name of ["Ada", "Bob"]) {
      const email = `${name.toLowerCase()}@shared-chat.example.test`, now = Date.now();
      const id = await ctx.db.insert("users", { name, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      out.push({ id, email, name, token: await createSession(ctx, id) });
    }
    return out;
  });
  const [ada, bob] = people;
  const { teamId } = await mutation<{ teamId: string }>("workspaces:create", { sessionToken: ada.token, name: "Shared conversation fixture" });
  await backend.t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: bob.id, email: bob.email, name: bob.name, role: "member", status: "active", createdAt: Date.now(), updatedAt: Date.now() }));
  const projectId = await mutation<string>("projects:create", { sessionToken: ada.token, teamId, name: "Project fixture" });
  await mutation("members:addWorkspaceMember", { sessionToken: ada.token, projectId, email: bob.email, role: "member" });
  await mutation("agents:setSharedAgents", { sessionToken: ada.token, teamId, enabled: true });
  const [{ agentId }] = await mutation<{ agentId: string }[]>("agents:publishProjectTeam", { sessionToken: ada.token, teamId, projectId, agents: [{ roleKey: "chief", kind: "chief", name: "Shared agent" }] });
  const [{ agentId: headId }] = await mutation<{ agentId: string }[]>("agents:publishProjectTeam", { sessionToken: ada.token, teamId, agents: [{ roleKey: "head", kind: "head", name: "Workspace agent" }] });
  const clients = [];
  await mkdir(folder, { recursive: true });
  for (const [i, person] of people.entries()) {
    const counter = join(folder, `turns-${randomUUID()}.txt`);
    const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR,
      OMB_TEST_PORTS: i ? "27110-27180" : "27010-27080", FAKE_CLAUDE_MODE: "stream", FAKE_CLAUDE_STEP_MS: "900", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_TURN_STATE: counter });
    fixtures.push(fixture);
    evidence.harnesses.push({ url: fixture.info.url, logPath: fixture.info.logPath });
    const api = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
    const { bot } = await api("POST", "/api/bots", { name: "Shared agent", memoryEnabled: false, memoryUpkeep: false, notifications: false }) as { bot: WireBot };
    const { bot: head } = await api("POST", "/api/bots", { name: "Workspace agent", memoryEnabled: false, memoryUpkeep: false, notifications: false }) as { bot: WireBot };
    const privateTask = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Explicit private" }) as { bot: WireBot };
    await api("PUT", `/api/bots/${bot.id}/shared-private`, { threadId: privateTask.bot.threadId, private: true });
    const history = await api("POST", `/api/bots/${bot.id}/tasks`, { title: `${person.name} history` }) as { bot: WireBot };
    if (i === 0) {
      await api("POST", `/api/bots/${bot.id}/messages`, { threadId: history.bot.threadId, text: "A conversation created before cloud binding", sendId: randomUUID() });
      await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30", "--url", fixture.info.url]);
    }
    await api("PUT", "/api/origin/cloud-session", { url: backend.url, sessionToken: person.token });
    for (const [botId, cloudAgent] of [[bot.id, agentId], [head.id, headId]]) await api("PUT", "/api/origin/shared-agents/bind", { botId, agentId: backend.wireId(cloudAgent), teamId: backend.wireId(teamId), version: 1, canEdit: true });
    clients.push({ api, counter, botId: bot.id, headId: head.id, historyThread: history.bot.threadId, privateThread: privateTask.bot.threadId });
  }
  const [a, b] = clients;
  const botFor = async (client: typeof a, botId = client.botId) => (await client.api("GET", "/api/bots") as { bots: WireBot[] }).bots.find(bot => bot.id === botId)!;
  const messages = async (client: typeof a, threadId: string) => (await client.api("GET", `/api/threads/${threadId}/messages?limit=200`) as { messages: WireMessage[] }).messages;
  const source = await eventually(() => botFor(a), bot => Boolean(bot.tasks?.find(task => task.threadId === a.historyThread)?.shared));
  const cloudThread = source.tasks!.find(task => task.threadId === a.historyThread)!.shared!.cloudThreadId;
  const watching = await eventually(() => botFor(b), bot => Boolean(bot.tasks?.some(task => task.shared?.cloudThreadId === cloudThread)));
  const bThread = watching.tasks!.find(task => task.shared?.cloudThreadId === cloudThread)!.threadId;
  await eventually(() => messages(b, bThread), rows => rows.some(row => row.text === "A conversation created before cloud binding"));
  evidence.checks.push("Pre-binding history from A is automatically imported and appears in B's real harness");
  assert.ok(!(await botFor(a)).tasks!.find(task => task.threadId === a.privateThread)!.shared);
  evidence.checks.push("Explicit private conversation remains unbound");
  const sent = { threadId: a.historyThread, text: "Live shared message from Ada", sendId: randomUUID() };
  await a.api("POST", `/api/bots/${a.botId}/messages`, sent);
  const streaming = await eventually(() => messages(b, bThread), rows => rows.some(row => row.remote?.status === "streaming" && row.text?.includes("hello from")));
  assert.ok(streaming.some(row => row.text === sent.text));
  evidence.checks.push("A's message and an in-progress streaming answer appear in B before completion");
  await runControlOmb(["wait", "--bot", a.botId, "--timeout", "30", "--url", fixtures[0].info.url]);
  const turnsBeforeRetry = await readFile(a.counter, "utf8");
  await a.api("POST", `/api/bots/${a.botId}/messages`, sent);
  const userSeq = streaming.find(row => row.text === sent.text)!.sharedMessage!.seq;
  const final = await eventually(() => messages(b, bThread), rows => rows.some(row => row.remote?.status === "final" && row.text === "hello from fake claude" && row.sharedMessage!.seq > userSeq));
  assert.equal(await readFile(a.counter, "utf8"), turnsBeforeRetry);
  assert.ok(!existsSync(b.counter));
  assert.equal(final.filter(row => row.text === sent.text).length, 1);
  const seqs = final.flatMap(row => row.sharedMessage ? [row.sharedMessage.seq] : []);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
  evidence.checks.push("Repeated sendId produces one user row and no second engine turn; B only watches and reads canonical order");
  const hostId = await mutation<string>("agents:publishHost", { sessionToken: ada.token, teamId, name: "Ada fixture", engines: ["claudeAgent"], models: [], computers: [] });
  await mutation("agentHosts:setRunsOn", { sessionToken: ada.token, agentId, hostId });
  await b.api("POST", `/api/bots/${b.botId}/messages`, { threadId: bThread, text: "Bob asks Ada's computer", sendId: randomUUID() });
  await eventually(() => messages(b, bThread), rows => rows.some(row => row.role === "bot" && row.remote?.name === "Ada" && row.sharedMessage && row.sharedMessage.seq > seqs.at(-1)! && row.remote.status === "final" && row.text === "hello from fake claude"));
  evidence.checks.push("B's request runs on A's fake engine and returns to B");
  backend.setOffline(bob.token, true);
  const missed = { threadId: a.historyThread, text: "Catch up after Bob reconnects", sendId: randomUUID() };
  await a.api("POST", `/api/bots/${a.botId}/messages`, missed);
  await runControlOmb(["wait", "--bot", a.botId, "--timeout", "30", "--url", fixtures[0].info.url]);
  assert.equal((await messages(b, bThread)).filter(row => row.text === missed.text).length, 0);
  backend.setOffline(bob.token, false);
  await eventually(() => messages(b, bThread), rows => rows.filter(row => row.text === missed.text).length === 1);
  evidence.checks.push("B catches up after an actual subscription transport disconnect without duplicate rows");
  const head = await eventually(() => botFor(a, a.headId), bot => Boolean(bot.tasks?.some(task => task.shared)));
  await eventually(() => botFor(b, b.headId), bot => Boolean(bot.tasks?.some(task => task.shared?.cloudThreadId === head.tasks!.find(task => task.shared)!.shared!.cloudThreadId)));
  evidence.checks.push("Workspace main-agent threads are discovered by both members");
  const members = await query<{ _id: string; email: string }[]>("members:list", { sessionToken: ada.token, projectId });
  await mutation("members:remove", { sessionToken: ada.token, projectId, memberId: members.find(member => member.email === bob.email)!._id });
  await assert.rejects(query("agentThreads:messagesSince", { sessionToken: bob.token, threadId: backend.nativeId(cloudThread), afterSeq: 0 }), /Thread not found/);
  evidence.checks.push("Removing B's project membership denies cloud chat reads");
  const canonical = await query<{ messages: { clientId: string }[] }>("agentThreads:messagesSince", { sessionToken: ada.token, threadId: backend.nativeId(cloudThread), afterSeq: 0 });
  assert.equal(canonical.messages.filter(row => row.clientId === `send:${sent.sendId}`).length, 1);
} finally {
  for (const fixture of fixtures.reverse()) await fixture.close();
  await backend.close();
}
assert.ok(fixtures.every(fixture => !existsSync(fixture.info.dataDir)));
evidence.checks.push("Both temporary harness data directories and the in-memory backend are closed and removed");
await writeFile(join(folder, "report.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
