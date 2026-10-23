import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { definitionHash, definitionOf } from "../shared/origin-shared-agents.ts";
import type { WireBot } from "../shared/wire.ts";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "./control-omb.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";
import { createModelHostResponseProxy } from "./testing/model-host-response-proxy.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const folder = join(root, ".omb-scratch/model-host-native-044");
if (process.argv.length === 2 || process.argv[2] === "--plan") {
  console.log(JSON.stringify({ mode: "plan", backend: "http://127.0.0.1:54851", purpose: "Two native fake-engine servers, distinct homes, shared canonical agent, private conversations retained", launchArgument: "--launch", productionMutation: false }));
  process.exit(0);
}
assert.deepEqual(process.argv.slice(2), ["--launch"]);
const backendRecord = join(folder, "reconciled-backend/fixture.json");
const backend = JSON.parse(await readFile(backendRecord, "utf8"));
assert.equal(backend.url, "http://127.0.0.1:54851");
assert.equal(backend.siteUrl, "http://127.0.0.1:54852");
assert.equal(backend.pushExit, 0);
const instance = await fetch(`${backend.url}/instance_name`, { signal: AbortSignal.timeout(2_000) }).then(response => response.text());
assert.equal(instance.replaceAll('"', "").trim(), backend.instance);
process.kill(backend.nativePid, 0);
const client = new ConvexHttpClient(backend.url, { logger: false });
const query = <T,>(name: string, args: Record<string, unknown>) => client.query(makeFunctionReference<"query">(name), args) as Promise<T>;
const mutation = <T,>(name: string, args: Record<string, unknown>) => client.mutation(makeFunctionReference<"mutation">(name), args) as Promise<T>;
const action = <T,>(name: string, args: Record<string, unknown>) => client.action(makeFunctionReference<"action">(name), args) as Promise<T>;
const privateFolder = join(folder, "private");
await mkdir(privateFolder, { recursive: true });
const privateFile = join(privateFolder, "model-host-accounts.json");
type Accounts = { owner: string; requester: string; teamId: string; projectId: string; agentId: string };
let accounts: Accounts;
try { accounts = JSON.parse(await readFile(privateFile, "utf8")); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const suffix = randomBytes(5).toString("hex"), password = `Synthetic-${randomBytes(18).toString("hex")}`;
  const owner = await action<{ sessionToken: string }>("auth:signup", { email: `host-owner-${suffix}@example.test`, password, name: "Host Fixture Owner", workspaceName: "Hosted model fixture" });
  const [team] = await query<Array<{ _id: string }>>("workspaces:list", { sessionToken: owner.sessionToken }); assert.ok(team);
  const requesterEmail = `host-requester-${suffix}@example.test`;
  const invitation = await mutation<{ token: string }>("workspaces:createInvite", { sessionToken: owner.sessionToken, teamId: team._id, email: requesterEmail, role: "member" });
  const requester = await action<{ sessionToken: string }>("auth:signup", { email: requesterEmail, password, name: "Host Fixture Requester", inviteToken: invitation.token });
  await mutation("workspaces:acceptInvite", { sessionToken: requester.sessionToken, token: invitation.token });
  const projectId = await mutation<string>("projects:create", { sessionToken: owner.sessionToken, teamId: team._id, name: "Model host native fixture", githubRepo: "later" });
  await mutation("members:addWorkspaceMember", { sessionToken: owner.sessionToken, projectId, email: requesterEmail, role: "member" });
  await mutation("agents:setSharedAgents", { sessionToken: owner.sessionToken, teamId: team._id, enabled: true });
  const [published] = await mutation<Array<{ agentId: string }>>("agents:publishProjectTeam", { sessionToken: owner.sessionToken, teamId: team._id, projectId, agents: [{ roleKey: "researcher", kind: "agent", name: "Atlas", title: "Researcher", description: "Synthetic shared model verification", soul: "", color: "blue" }] }); assert.ok(published);
  accounts = { owner: owner.sessionToken, requester: requester.sessionToken, teamId: team._id, projectId, agentId: published.agentId };
  await writeFile(privateFile, JSON.stringify(accounts), { flag: "wx", mode: 0o600 });
}
const owner = { sessionToken: accounts.owner }, requester = { sessionToken: accounts.requester }, team = { _id: accounts.teamId }, projectId = accounts.projectId, published = { agentId: accounts.agentId };
const definition = await query<{ name: string; title: string; description: string; soul: string; color: string; soulVersion: number }>("agents:get", { sessionToken: owner.sessionToken, agentId: published.agentId });
try { await copyFile(join(folder, "native-hosts.json"), join(folder, `native-hosts-retained-${Date.now()}.json`)); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

const observations: Array<{ client: string; method: string; path: string; status: number }> = [];
const fixtures: Partial<Record<"owner" | "requester", VerificationServer>> = {};
let responseProxy: Awaited<ReturnType<typeof createModelHostResponseProxy>> | undefined;
type LocalState = { url: string; pid: number; dataDir: string; logPath: string; botId: string; privateThreadId: string; privateSnapshot: unknown; sharedThreadId?: string };
const states: Partial<Record<"owner" | "requester", LocalState>> = {};
const receipt: Record<string, unknown> = { startedAt: new Date().toISOString(), backend: backend.url, backendPid: backend.nativePid, backendSourceSnapshot: relative(root, join(dirname(backendRecord), "source")), baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(), workspaceId: team._id, projectId, agentId: published.agentId, stage: "seeding-native-servers", acceptedCases: [], limitations: ["No production data, email, GitHub or real provider calls", "Foundation is not remote execution acceptance", "No packaged desktop or browser acceptance", "Fake CLI permission requests and emitted native arguments do not prove a real provider CLI or operating system sandbox"] };
const save = () => writeFile(join(folder, "native-hosts.json"), JSON.stringify({ ...receipt, clients: states, observations, responseFaults: responseProxy?.observations }, null, 2));
const sourceNames = [...new Set(["package.json", "pnpm-lock.yaml", "scripts/control-omb.ts", "scripts/testing/model-host-response-proxy.ts", "scripts/verify-origin-model-host-native.ts", ...execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "server", "shared", "enterprise"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\n").filter(path => /\.(?:ts|tsx|mjs|cjs)$/.test(path) && !path.includes(".test."))])].sort();
receipt.runtimeSource = await Promise.all(sourceNames.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") })));
await save();
const requestFor = (name: "owner" | "requester") => fixtureApi(states[name]!.url, { headers: { origin: states[name]!.url }, observe: call => observations.push({ client: name, ...call }) });
const botFor = async (name: "owner" | "requester") => ((await requestFor(name)("GET", "/api/bots")).bots as WireBot[]).find(bot => bot.id === states[name]!.botId)!;
const waitFor = async <T,>(read: () => Promise<T | null | undefined | false>, label: string, ms = 30_000): Promise<T> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(done => setTimeout(done, 200)); }
  throw new Error(`Timed out: ${label}`);
};
const transcripts = async (name: "owner" | "requester", threadId: string) => requestFor(name)("GET", `/api/threads/${threadId}/messages?limit=200`);
let input: ReturnType<typeof createInterface> | undefined;
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true; input?.close();
  for (const name of ["requester", "owner"] as const) {
    if (!fixtures[name]) continue;
    try { await copyFile(fixtures[name]!.info.logPath, join(folder, "logs", `${name}-server.log`)); } catch {}
    try { await copyFile(join(fixtures[name]!.info.dataDir, "room-plan.json.evidence.jsonl"), join(privateFolder, `${name}-turn-evidence.jsonl`)); } catch {}
    await fixtures[name]!.close();
  }
  await responseProxy?.close();
  receipt.stoppedAt = new Date().toISOString(); await save();
};
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
try {
  responseProxy = await createModelHostResponseProxy(backend.url);
  receipt.requesterBackendProxy = responseProxy.url;
  for (const name of ["owner", "requester"] as const) {
    const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, OMB_TEST_PORTS: name === "owner" ? "26710-26780" : "26790-26860", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_VERSION: "2.1.300" }, undefined, undefined, undefined, undefined, { scripted: true, modelHosting: true });
    fixtures[name] = fixture;
    const request = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url }, observe: call => observations.push({ client: name, ...call }) });
    const created = await request("POST", "/api/bots", { name: definition.name, title: definition.title, description: definition.description, soul: definition.soul, color: definition.color, section: "Model hosting fixture", notifications: false, memoryEnabled: false, memoryUpkeep: false });
    const botId = created.bot.id as string;
    await request("PATCH", `/api/bots/${botId}`, { name: definition.name, title: definition.title, description: definition.description, soul: definition.soul, color: definition.color, mascotExpression: null, memoryEnabled: false, memoryUpkeep: false });
    const privateTask = await request("POST", `/api/bots/${botId}/tasks`, { title: `${name} independent B` });
    const privateThreadId = privateTask.bot.threadId as string;
    states[name] = { ...fixture.info, botId, privateThreadId, privateSnapshot: null };
    if (name === "owner") {
      await request("PUT", `/api/bots/${botId}/memory`, { text: "- 2026-10-19 · OWNER_PRIVATE_MEMORY_CANARY_044 kumquat protocol" });
      await request("PATCH", `/api/bots/${botId}`, { memoryEnabled: true });
    }
    await writeFile(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [botId]: { reply: name === "owner" ? "OWNER_PRIVATE_THREAD_CANARY_044 kumquat protocol" : "Requester private fixture reply", steps: [] } }));
    await request("POST", `/api/bots/${botId}/messages`, { threadId: privateThreadId, text: name === "owner" ? "OWNER_PRIVATE_THREAD_CANARY_044 kumquat protocol is private to B" : "Requester private conversation B remains local", sendId: randomUUID() });
    await runControlOmb(["wait", "--bot", botId, "--timeout", "30", "--url", fixture.info.url]);
    states[name]!.privateSnapshot = await transcripts(name, privateThreadId);
    if (name === "owner") {
      const baselineDump = await readFile(fixture.fixtureDumpPath);
      const localContext = JSON.parse(baselineDump.toString());
      assert.ok(JSON.stringify({ prompt: localContext.prompt, systemPrompt: localContext.systemPrompt }).includes("OWNER_PRIVATE_MEMORY_CANARY_044"), "Private memory canary was not present in the normal owner control turn");
      await writeFile(join(privateFolder, `owner-private-control-cli-dump-${fixture.info.pid}.json`), baselineDump, { flag: "wx", mode: 0o600 });
      receipt.ownerPrivateControl = { memoryEnabled: true, memoryCanaryReachedOwnLocalPrompt: true, dumpSha256: createHash("sha256").update(baselineDump).digest("hex") };
    }
    await request("PUT", "/api/origin/cloud-session", { url: name === "owner" ? backend.url : responseProxy.url, sessionToken: name === "owner" ? owner.sessionToken : requester.sessionToken });
    await request("PUT", `/api/bots/${botId}/cloud-project`, { cloudProjectId: projectId });
    const projectsRoot = join(fixture.info.dataDir, "fixture-projects");
    await mkdir(projectsRoot, { recursive: true });
    await request("PUT", "/api/origin/projects-root", { root: projectsRoot });
    const localBot = await botFor(name);
    assert.equal(definitionHash(definitionOf(localBot)), definitionHash(definitionOf(definition)));
    await request("PUT", "/api/origin/shared-agents/bind", { botId, agentId: published.agentId, teamId: team._id, version: definition.soulVersion, hash: definitionHash(definitionOf(definition)), canEdit: true });
    const settings = await request("GET", "/api/origin/model-host");
    assert.equal(settings.ready, true);
    assert.equal((await botFor(name)).threadId, privateThreadId);
    await save();
  }
  assert.notEqual(states.owner!.botId, states.requester!.botId);
  assert.notEqual(states.owner!.dataDir, states.requester!.dataDir);
  const ownSettings = await requestFor("owner")("GET", "/api/origin/model-host");
  const account = ownSettings.instances.find((entry: { instanceId: string }) => entry.instanceId === "claude");
  assert.ok(account?.available && account.models.length);
  const model = account.models.includes("sonnet") ? "sonnet" : account.models[0];
  const shared = await requestFor("owner")("PUT", "/api/origin/model-host/sources", { teamId: team._id, instanceId: "claude", label: "Owner fixture Claude", models: [model], enabled: true, projectIds: [projectId], workspaceHead: false, capacity: 1 });
  const source = await waitFor(async () => {
    const catalog = await requestFor("requester")("GET", `/api/origin/model-host/catalog?botId=${states.requester!.botId}`);
    for (const entry of catalog.sources) for (const field of ["hostToken", "credentialHash", "sessionToken", "sourceKey", "instanceId"]) assert.equal(Object.hasOwn(entry, field), false);
    for (const token of [owner.sessionToken, requester.sessionToken]) assert.ok(!JSON.stringify(catalog).includes(token));
    return catalog.sources.find((entry: { sourceId: string }) => entry.sourceId === shared.source.sourceId);
  }, "owner source advertised to requester");
  receipt.source = { hostId: source.hostId, sourceId: source.sourceId, model, billing: source.billing };
  receipt.stage = "foundation-ready-remote-send-not-run";
  receipt.acceptedCases = ["Two native isolated fake-only servers", "Exact canonical shared agent bound to distinct local bot IDs", "Independent B created and answered locally before sharing", "Owner explicitly grants one local subscription model to this project", "Requester catalog sees owner source without credentials or local instance ID"];
  for (const name of ["owner", "requester"] as const) assert.deepEqual(await transcripts(name, states[name]!.privateThreadId), states[name]!.privateSnapshot);
  await save();
  console.log(JSON.stringify({ ready: true, stage: receipt.stage, backend: backend.url, owner: { url: states.owner!.url, pid: states.owner!.pid }, requester: { url: states.requester!.url, pid: states.requester!.pid }, receipt: ".omb-scratch/model-host-native-044/native-hosts.json", privateFile: ".omb-scratch/model-host-native-044/private/model-host-accounts.json", remoteSendRun: false }));
  const remotePrimary = async (caseKey: "remotePrimary" | "unknownBegin" = "remotePrimary") => {
    assert.equal(receipt[caseKey], undefined, "An accepted or uncertain hosted request must never be replayed by the fixture");
    const text = `Tell me about the kumquat protocol in shared project conversation A. HOST_REQUEST_044_${randomUUID()}`;
    const reply = "HOST_REPLY_044 Shared synthetic work completed on the owner's computer.";
    const sendId = randomUUID();
    receipt[caseKey] = { startedAt: new Date().toISOString(), sendId, stage: "preparing" }; await save();
    const requesterApi = requestFor("requester"), ownerApi = requestFor("owner");
    const ownerMemoryBefore = await ownerApi("GET", `/api/bots/${states.owner!.botId}/memory`);
    const task = await requesterApi("POST", `/api/bots/${states.requester!.botId}/tasks`, { title: "Shared A · hosted fixture" });
    const threadId = task.bot.threadId as string;
    states.requester!.sharedThreadId = threadId;
    await requesterApi("PATCH", `/api/bots/${states.requester!.botId}/tasks/${threadId}`, { modelSelection: { instanceId: "origin-remote", model, source: { hostId: source.hostId, sourceId: source.sourceId } }, resetApprovalToAsk: true, requireAvailableModel: true });
    const privateMessage = (states.owner!.privateSnapshot as { messages: Array<{ id: string; role: string }> }).messages.find(row => row.role === "user");
    assert.ok(privateMessage);
    const outsideFile = join(states.owner!.dataDir, "owner-private-file-canary-044.txt");
    try { await writeFile(outsideFile, "OWNER_PRIVATE_FILE_CANARY_044", { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; assert.equal(await readFile(outsideFile, "utf8"), "OWNER_PRIVATE_FILE_CANARY_044"); }
    await writeFile(join(states.owner!.dataDir, "room-plan.json"), JSON.stringify({ [states.owner!.botId]: { reply, replyIfDenied: reply, approve: { tool_name: "Read", input: { file_path: outsideFile } }, steps: [
      { tool: "session_search", arguments: { query: "kumquat protocol", scope: "all" }, expectError: true },
      { tool: "session_read", arguments: { thread_id: states.owner!.privateThreadId, message_id: privateMessage.id }, expectError: true },
      { tool: "list_threads", arguments: {}, expectError: true },
    ] } }));
    if (caseKey === "unknownBegin") responseProxy!.arm("modelHosts:begin", "drop");
    const sendBody = { threadId, text, sendId };
    const sendResponse = await fetch(`${states.requester!.url}/api/bots/${states.requester!.botId}/messages`, { method: "POST", headers: { "content-type": "application/json", origin: states.requester!.url }, body: JSON.stringify(sendBody), signal: AbortSignal.timeout(20_000) });
    observations.push({ client: "requester", method: "POST", path: `/api/bots/${states.requester!.botId}/messages`, status: sendResponse.status });
    const sent = await sendResponse.json() as { message?: { id?: string } };
    assert.ok(sendResponse.ok || caseKey === "unknownBegin" && sendResponse.status === 503, "Unexpected native shared send response");
    const remoteReceipt = receipt[caseKey] as Record<string, unknown>;
    remoteReceipt.stage = "accepted-waiting-for-execution"; remoteReceipt.localMessageId = sent.message?.id; remoteReceipt.initialHttpStatus = sendResponse.status; await save();
    const canonical = await waitFor(async () => {
      const threads = await query<Array<{ _id: string }>>("agentThreads:list", { sessionToken: requester.sessionToken, agentId: published.agentId });
      for (const thread of threads) {
        const rows = await query<{ activeRun: unknown; messages: Array<{ clientId: string; role: string; kind: string; text?: string; executedByName?: string; sourceId?: string }> }>("agentThreads:messagesSince", { sessionToken: requester.sessionToken, threadId: thread._id, afterSeq: 0, limit: 200 });
        if (rows.messages.some(row => row.clientId === `send:${sendId}`) && rows.messages.some(row => row.role === "bot" && row.kind === "text" && row.text === reply) && !rows.activeRun) return { threadId: thread._id, ...rows };
      }
      return null;
    }, "one owner-hosted canonical reply", 60_000);
    assert.equal(canonical.messages.filter(row => row.clientId === `send:${sendId}`).length, 1);
    const replies = canonical.messages.filter(row => row.role === "bot" && row.kind === "text" && row.text === reply);
    assert.equal(replies.length, 1); assert.equal(replies[0]!.sourceId, source.sourceId);
    assert.equal(replies[0]!.executedByName, "Host Fixture Owner");
    const ownerThreadId = await waitFor(async () => {
      const ownerBot = await botFor("owner");
      return ownerBot.tasks?.find(local => local.shared?.cloudThreadId === canonical.threadId)?.threadId;
    }, "owner native shared transcript discovery");
    states.owner!.sharedThreadId = ownerThreadId;
    for (const name of ["owner", "requester"] as const) {
      await waitFor(async () => JSON.stringify(await transcripts(name, states[name]!.sharedThreadId!)).includes(reply), `${name} native mirror receives canonical reply`);
      assert.deepEqual(await transcripts(name, states[name]!.privateThreadId), states[name]!.privateSnapshot);
    }
    assert.equal((await botFor("owner")).threadId, states.owner!.privateThreadId);
    const dumpBytes = await readFile(fixtures.owner!.fixtureDumpPath);
    await writeFile(join(privateFolder, `owner-hosted-cli-dump-${caseKey}.json`), dumpBytes, { flag: "wx", mode: 0o600 });
    const dump = JSON.parse(dumpBytes.toString());
    const context = JSON.stringify({ systemPrompt: dump.systemPrompt, prompt: dump.prompt });
    assert.ok(context.includes(text));
    for (const canary of ["OWNER_PRIVATE_THREAD_CANARY_044", "OWNER_PRIVATE_MEMORY_CANARY_044", "owner independent B"]) assert.ok(!context.includes(canary), `Hosted provider context exposed ${canary}`);
    const folders = await ownerApi("GET", "/api/origin/projects-root");
    assert.equal(dump.cwd, folders.folders[projectId]);
    assert.equal(dump.settings?.permissions?.blockReadsOutsideWorkingDirectories, true);
    for (const tool of ["Bash", "PowerShell", "WebFetch"]) assert.ok(dump.settings?.permissions?.deny?.includes(tool));
    const nativeTools = String(dump.argv[dump.argv.indexOf("--tools") + 1]).split(",");
    assert.ok(dump.argv.includes("--tools") && nativeTools.includes("Read"));
    for (const tool of ["Bash", "PowerShell", "WebFetch"]) assert.ok(!nativeTools.includes(tool));
    const turns = async (name: "owner" | "requester") => (await readFile(join(states[name]!.dataDir, "room-plan.json.evidence.jsonl"), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(row => JSON.stringify(row.prompt).includes(text));
    const ownerTurns = await turns("owner");
    assert.equal(ownerTurns.length, 1); assert.equal((await turns("requester")).length, 0);
    const deniedTools = ownerTurns[0].evidence.filter((entry: { step?: { tool?: string }; response?: { error?: unknown; result?: { isError?: boolean } } }) => entry.step && ["session_search", "session_read", "list_threads"].includes(entry.step.tool ?? "") && Boolean(entry.response?.error || entry.response?.result?.isError));
    assert.equal(deniedTools.length, 3);
    for (const entry of deniedTools) assert.ok(JSON.stringify(entry.response).includes("Shared model execution cannot access"), "The privacy check must reach the actual internal route guard");
    assert.equal(ownerTurns[0].approval?.behavior, "deny", "An owner approval must not widen the hosted project folder");
    assert.deepEqual(await ownerApi("GET", `/api/bots/${states.owner!.botId}/memory`), ownerMemoryBefore);
    await requesterApi("POST", `/api/bots/${states.requester!.botId}/messages`, sendBody);
    await new Promise(done => setTimeout(done, 600));
    assert.equal((await turns("owner")).length, 1);
    if (caseKey === "unknownBegin") assert.equal(responseProxy!.observations.filter(row => row.path === "modelHosts:begin" && row.outcome === "dropped").length, 1);
    Object.assign(remoteReceipt, { stage: "passed", finishedAt: new Date().toISOString(), canonicalThreadId: canonical.threadId, ownerCliInvocations: 1, requesterCliInvocations: 0, duplicateSendReused: true, ownerSelectedPrivateBRetained: true, privateTranscriptsUnchanged: true, privateMemoryAndThreadExcludedFromPrompt: true, privateMemorySearchReadAndThreadListDeniedViaActualMcp: 3, outsideProjectReadDeniedThroughFakeCliPermissionPath: true, nativeGuestConfinementArgumentsVerified: true, ownerMemoryAndLogUnchanged: true, ownerProjectFolderUsed: true, dumpSha256: createHash("sha256").update(dumpBytes).digest("hex") });
    receipt.stage = caseKey === "unknownBegin" ? "unknown-begin-verified" : "remote-primary-verified";
    (receipt.acceptedCases as string[]).push("Actual requester remote-primary send executes once on owner fake CLI and appears on both native mirrors", "Repeated exact send ID reuses accepted work", "Owner's selected private B and both private transcripts remain unchanged", "Owner private MEMORY and prior conversation canaries absent from hosted provider prompt");
    await save(); console.log(JSON.stringify({ case: caseKey, result: "passed", ownerCliInvocations: 1, requesterCliInvocations: 0, privateContextExcluded: true, receipt: ".omb-scratch/model-host-native-044/native-hosts.json" }));
  };
  const stopSetup = async () => {
    assert.equal(receipt.stopSetup, undefined, "A stopped setup must never be replayed by the fixture");
    const requesterApi = requestFor("requester"), sendId = randomUUID();
    const task = await requesterApi("POST", `/api/bots/${states.requester!.botId}/tasks`, { title: "Stop before shared setup" });
    const threadId = task.bot.threadId as string;
    await requesterApi("PATCH", `/api/bots/${states.requester!.botId}/tasks/${threadId}`, { modelSelection: { instanceId: "origin-remote", model, source: { hostId: source.hostId, sourceId: source.sourceId } }, resetApprovalToAsk: true, requireAvailableModel: true });
    const faultStart = responseProxy!.observations.length;
    receipt.stopSetup = { startedAt: new Date().toISOString(), sendId, threadId, stage: "setup-unconfirmed" }; await save();
    responseProxy!.arm("agentThreads:create", "hold");
    const pendingSend = fetch(`${states.requester!.url}/api/bots/${states.requester!.botId}/messages`, { method: "POST", headers: { "content-type": "application/json", origin: states.requester!.url }, body: JSON.stringify({ threadId, text: `STOP_SETUP_044_${sendId}`, sendId }), signal: AbortSignal.timeout(25_000) }).then(async response => ({ status: response.status, body: await response.json() })).catch(() => ({ status: 0, body: { transportError: true } }));
    await waitFor(async () => responseProxy!.held()?.path === "agentThreads:create", "actual cloud thread setup response held");
    const stop = await fetch(`${states.requester!.url}/api/bots/${states.requester!.botId}/interrupt`, { method: "POST", headers: { "content-type": "application/json", origin: states.requester!.url }, body: JSON.stringify({ threadId }), signal: AbortSignal.timeout(8_000) });
    observations.push({ client: "requester", method: "POST", path: `/api/bots/${states.requester!.botId}/interrupt`, status: stop.status });
    assert.ok(stop.ok); assert.equal((await stop.json() as { ok?: boolean }).ok, true);
    responseProxy!.release();
    const sent = await pendingSend;
    assert.ok(sent.status >= 400, "A send stopped during setup must not report an accepted execution");
    await new Promise(done => setTimeout(done, 500));
    assert.equal(responseProxy!.observations.slice(faultStart).filter(row => row.path === "modelHosts:begin").length, 0);
    const threads = await query<Array<{ _id: string }>>("agentThreads:list", { sessionToken: requester.sessionToken, agentId: published.agentId });
    for (const thread of threads) assert.equal(await query("modelHosts:requestStatus", { sessionToken: requester.sessionToken, threadId: thread._id, clientId: `send:${sendId}`, now: Date.now() }), null);
    for (const name of ["owner", "requester"] as const) assert.deepEqual(await transcripts(name, states[name]!.privateThreadId), states[name]!.privateSnapshot);
    Object.assign(receipt.stopSetup as Record<string, unknown>, { stage: "passed", finishedAt: new Date().toISOString(), acceptedHostedMutations: 0, nativeSendStatus: sent.status, privateTranscriptsUnchanged: true });
    await save(); console.log(JSON.stringify({ case: "stopSetup", result: "passed", acceptedHostedMutations: 0 }));
  };
  input = createInterface({ input: process.stdin });
  let commandError: unknown;
  await new Promise<void>(done => { let pending = Promise.resolve(); input!.on("line", line => { pending = pending.then(async () => {
    const command = line.trim();
    if (command === "stop") { done(); return; }
    if (command === "remote-primary") await remotePrimary();
    if (command === "unknown-begin") await remotePrimary("unknownBegin");
    if (command === "stop-setup") await stopSetup();
    if (command === "snapshot") {
      receipt.lastSnapshotAt = new Date().toISOString();
      for (const name of ["owner", "requester"] as const) assert.deepEqual(await transcripts(name, states[name]!.privateThreadId), states[name]!.privateSnapshot);
      await save(); console.log(JSON.stringify({ stage: receipt.stage, privateConversationsUnchanged: true }));
    }
  }).catch(error => { commandError = error; done(); }); }); });
  if (commandError) throw commandError;
} catch (error) {
  receipt.failure = error instanceof Error ? error.message : String(error); await save();
  throw error;
} finally { await stop(); }
