import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { definitionHash, definitionOf } from "../shared/origin-shared-agents.ts";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "./control-omb.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";

const afterBusyFix = process.argv[2] === "--after-busy-fix";
const afterFix = afterBusyFix || process.argv[2] === "--after-fix";
assert.deepEqual(process.argv.slice(2), [afterBusyFix ? "--after-busy-fix" : afterFix ? "--after-fix" : "--launch"]);
const root = fileURLToPath(new URL("..", import.meta.url));
const folder = join(root, ".omb-scratch/model-host-native-044");
const previous = JSON.parse(await readFile(join(folder, "native-hosts.json"), "utf8"));
for (const key of ["remotePrimary", "unknownBegin", "stopSetup"]) assert.equal(previous[key].stage, "passed");
assert.ok(previous.stoppedAt);
const backend = JSON.parse(await readFile(join(folder, "reconciled-backend/fixture.json"), "utf8"));
assert.equal(backend.url, "http://127.0.0.1:54851"); assert.equal(backend.pushExit, 0); process.kill(backend.nativePid, 0);
assert.equal((await fetch(`${backend.url}/instance_name`).then(response => response.text())).replaceAll('"', "").trim(), backend.instance);
const accounts = JSON.parse(await readFile(join(folder, "private/model-host-accounts.json"), "utf8"));
const client = new ConvexHttpClient(backend.url, { logger: false });
const definition = await client.query(makeFunctionReference<"query">("agents:get"), { sessionToken: accounts.owner, agentId: accounts.agentId });
const path = join(folder, "handover-native-hosts.json");
try {
  const priorBytes = await readFile(path, "utf8");
  if (!afterFix) throw new Error("The bounded handover pair already exists; reconcile it instead of relaunching");
  const prior = JSON.parse(priorBytes); assert.ok(prior.stoppedAt);
  const priorHandoverBytes = await readFile(join(folder, "handover.json"), "utf8"), priorHandover = JSON.parse(priorHandoverBytes);
  if (afterBusyFix) {
    assert.equal(prior.afterFolderFix, true); assert.equal(prior.afterSenderBusyFix, undefined);
    assert.equal(priorHandover.cases["remote-local"].stoppedAfterFailure, true);
  } else {
    assert.equal(prior.afterFolderFix, undefined);
    for (const name of ["remote-remote", "local-remote", "partial", "offline-nonquota-control", "offline", "stop", "cap", "revoke"]) assert.equal(priorHandover.cases[name].stage, "passed");
  }
  const backupPath = afterBusyFix ? "server/origin-shared-agents.ts" : "server/host/shared-model-backups.ts";
  assert.notEqual(prior.runtimeSource.find((row: any) => row.path === backupPath).sha256, createHash("sha256").update(await readFile(join(root, backupPath))).digest("hex"));
  const phase = afterBusyFix ? "sender-busy" : "folder";
  await writeFile(join(folder, `handover-native-before-${phase}-fix.json`), priorBytes, { flag: "wx" });
  await writeFile(join(folder, `handover-before-${phase}-fix.json`), priorHandoverBytes, { flag: "wx" });
}
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || afterFix) throw error; }
try { await copyFile(join(folder, "handover.json"), join(folder, `handover-preconfigure-retained-${Date.now()}.json`)); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const profiles = {
  owner: [{ id: "ownerQuota", mode: "usage-limit" }, { id: "ownerGood", mode: "happy" }, { id: "ownerPartial", mode: "usage-limit-after-text" }, { id: "ownerMetered", mode: "happy", metered: true }],
  requester: [{ id: "localQuota", mode: "usage-limit" }, { id: "localGood", mode: "happy" }],
} as const;
const names = [...new Set(["package.json", "pnpm-lock.yaml", "scripts/control-omb.ts", "scripts/verify-origin-model-host-handover-native.ts", "scripts/verify-origin-model-host-handover.ts", ...execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "server", "shared", "enterprise"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\n").filter(name => /\.(?:ts|tsx|mjs|cjs)$/.test(name) && !name.includes(".test."))])].sort();
const receipt: any = { startedAt: new Date().toISOString(), backend: backend.url, backendPid: backend.nativePid, baseCommit: previous.baseCommit, ...(afterFix ? { afterFolderFix: true } : {}), ...(afterBusyFix ? { afterSenderBusyFix: true } : {}),
  profiles, clients: {}, foundation: { stage: "preparing" }, source: {}, earlierEvidence: "docs/verification/evidence/origin-model-host-native-044/receipt.json",
  runtimeSource: await Promise.all(names.map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") }))),
  limitations: ["Two isolated native servers and repository fake providers only", "Aliases model distinct synthetic accounts on one owner computer", "No production, real provider, email or GitHub calls", "No packaged UI, real CLI sandbox or positive metered API acceptance"] };
const save = () => writeFile(path, JSON.stringify(receipt, null, 2));
const fixtures: Partial<Record<"owner" | "requester", VerificationServer>> = {};
let input: ReturnType<typeof createInterface> | undefined;
let stopped = false;
const stop = async () => {
  if (stopped) return; stopped = true; input?.close();
  for (const who of ["requester", "owner"] as const) if (fixtures[who]) {
    try { await copyFile(fixtures[who]!.info.logPath, join(folder, "logs", `${who}-handover-server.log`)); } catch {}
    const raw = join(folder, "private", `handover-${who}-${fixtures[who]!.info.pid}`); await mkdir(raw, { recursive: true });
    for (const name of await readdir(join(fixtures[who]!.info.dataDir, "handover"))) if (name.endsWith("-prompts.jsonl") || name.endsWith("-dump.json")) {
      await copyFile(join(fixtures[who]!.info.dataDir, "handover", name), join(raw, name));
    }
    try { await copyFile(join(fixtures[who]!.info.dataDir, "room-plan.json.evidence.jsonl"), join(raw, "turn-evidence.jsonl")); } catch {}
    receipt.clients[who].retainedPrivateRawEvidence = raw;
    await fixtures[who]!.close();
  }
  receipt.stoppedAt = new Date().toISOString(); await save();
};
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
try {
  await save();
  for (const who of ["owner", "requester"] as const) {
    const fixture = await launchVerificationServer({ SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR,
      OMB_TEST_PORTS: who === "owner" ? "26710-26780" : "26790-26860", FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_VERSION: "2.1.300" },
      undefined, undefined, undefined, undefined, { scripted: true, modelHosting: true, modelHostProfiles: [...profiles[who]] });
    fixtures[who] = fixture;
    const api = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
    const { bot } = await api("POST", "/api/bots", { name: definition.name, title: definition.title, description: definition.description,
      soul: definition.soul, color: definition.color, notifications: false, memoryEnabled: false, memoryUpkeep: false });
    const made = await api("POST", `/api/bots/${bot.id}/tasks`, { title: `${who} independent handover B` });
    const privateThreadId = made.bot.threadId;
    receipt.clients[who] = { ...fixture.info, botId: bot.id, privateThreadId };
    await writeFile(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [bot.id]: { reply: `${who} private B retained`, steps: [] } }));
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: privateThreadId, text: `${who} private B remains independent`, sendId: randomUUID() });
    await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30", "--url", fixture.info.url]);
    receipt.clients[who].privateSnapshot = await api("GET", `/api/threads/${privateThreadId}/messages?limit=200`);
    await api("PUT", "/api/origin/cloud-session", { url: backend.url, sessionToken: accounts[who] });
    await api("PUT", `/api/bots/${bot.id}/cloud-project`, { cloudProjectId: accounts.projectId });
    const projectsRoot = join(fixture.info.dataDir, "fixture-projects"); await mkdir(projectsRoot, { recursive: true });
    await api("PUT", "/api/origin/projects-root", { root: projectsRoot });
    const local = (await api("GET", "/api/bots")).bots.find((row: any) => row.id === bot.id);
    assert.equal(definitionHash(definitionOf(local)), definitionHash(definitionOf(definition)));
    await api("PUT", "/api/origin/shared-agents/bind", { botId: bot.id, agentId: accounts.agentId, teamId: accounts.teamId,
      version: definition.soulVersion, hash: definitionHash(definitionOf(definition)), canEdit: true });
    const settings = await api("GET", "/api/origin/model-host"); assert.equal(settings.ready, true);
    for (const profile of profiles[who]) assert.ok(settings.instances.some((row: any) => row.instanceId === profile.id && row.available));
    if (who === "owner") {
      const primary = settings.instances.find((row: any) => row.instanceId === "ownerGood");
      receipt.source.model = primary.models.includes("sonnet") ? "sonnet" : primary.models[0];
    }
    await save();
  }
  receipt.foundation.stage = "passed"; receipt.foundation.finishedAt = new Date().toISOString(); await save();
  await writeFile(join(folder, "handover.json"), JSON.stringify({ baseCommit: receipt.baseCommit, startedAt: new Date().toISOString(), backend: receipt.backend,
    nativeClients: receipt.clients, cases: {}, instances: Object.fromEntries(Object.entries(profiles).flatMap(([who, rows]) => rows.map(row => [row.id, { instanceId: row.id, who }]))),
    limitations: receipt.limitations }, null, 2));
  console.log(JSON.stringify({ ready: true, owner: { url: fixtures.owner!.info.url, pid: fixtures.owner!.info.pid }, requester: { url: fixtures.requester!.info.url, pid: fixtures.requester!.info.pid }, receipt: ".omb-scratch/model-host-native-044/handover-native-hosts.json" }));
  input = createInterface({ input: process.stdin, terminal: false });
  input.on("line", async line => { if (line.trim() === "stop") { await stop(); process.exit(0); } });
  input.on("close", () => { if (!stopped) void stop().then(() => process.exit(0)); });
} catch (error) {
  receipt.failure = { message: String(error), at: new Date().toISOString() }; await save(); await stop(); throw error;
}
