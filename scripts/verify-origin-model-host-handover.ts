import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ownTurnText } from "../server/testing/room-handoff-agent.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const folder = join(root, ".omb-scratch/model-host-native-044");
const pair = JSON.parse(await readFile(join(folder, "handover-native-hosts.json"), "utf8"));
assert.equal(pair.foundation.stage, "passed");
assert.equal(pair.stoppedAt, undefined);
assert.equal(pair.backend, "http://127.0.0.1:54851");
const accounts = JSON.parse(await readFile(join(folder, "private/model-host-accounts.json"), "utf8"));
const selectedCase = process.argv[2];
assert.ok(["configure", "remote-local", "local-remote", "remote-remote", "offline", "partial", "stop", "cap", "revoke"].includes(selectedCase));
const evidenceFile = join(folder, "handover.json");
let record: any;
try { record = JSON.parse(await readFile(evidenceFile, "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; record = { baseCommit: pair.baseCommit, startedAt: new Date().toISOString(), backend: pair.backend, nativeClients: pair.clients, cases: {}, limitations: ["Repository fake CLI and controlled synthetic accounts only", "Additional source accounts are distinct synthetic profiles on one native owner computer", "Controlled offline host presence is not a third running native server", "No real provider, invoice, desktop UI or production acceptance"] }; }
const save = () => writeFile(evidenceFile, JSON.stringify(record, null, 2));
const client = new ConvexHttpClient(pair.backend, { logger: false });
const query = <T,>(name: string, args: Record<string, unknown>) => client.query(makeFunctionReference<"query">(name), args) as Promise<T>;
const mutation = <T,>(name: string, args: Record<string, unknown>) => client.mutation(makeFunctionReference<"mutation">(name), args) as Promise<T>;
const api = async (who: "owner" | "requester", method: string, path: string, body?: unknown) => {
  const local = pair.clients[who]; const url = new URL(local.url);
  assert.equal(url.hostname, "127.0.0.1"); assert.ok(![3210, 3211, 5199, 8799, 54851, 54852].includes(Number(url.port)));
  assert.ok(basename(local.dataDir).startsWith("openmausbot-verify-data-")); process.kill(local.pid, 0);
  const response = await fetch(`${url.origin}${path}`, { method, headers: { "content-type": "application/json", origin: url.origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  const result = await response.json() as any;
  if (!response.ok) throw new Error(`Isolated ${who} ${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
};
const waitFor = async <T,>(read: () => Promise<T | null | false | undefined>, label: string, ms = 65_000): Promise<T> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(done => setTimeout(done, 250)); }
  throw new Error(`Timed out: ${label}`);
};
const model = pair.source.model as string;
const localModel = (id: string) => ({ instanceId: record.instances?.[id]?.instanceId ?? id, model });
const remoteModel = (source: any) => ({ instanceId: "origin-remote", model, source: { hostId: source.hostId, sourceId: source.sourceId } });
const profiles: Record<string, { who: "owner" | "requester"; mode: string; billing?: string }> = {
  ownerQuota: { who: "owner", mode: "usage-limit" }, ownerGood: { who: "owner", mode: "happy" },
  ownerPartial: { who: "owner", mode: "usage-limit-after-text" }, ownerMetered: { who: "owner", mode: "happy", billing: "metered" },
  localQuota: { who: "requester", mode: "usage-limit" }, localGood: { who: "requester", mode: "happy" },
};
const promptRows = async (id: string, marker: string) => {
  const profile = profiles[id];
  try { return (await readFile(join(pair.clients[profile.who].dataDir, "handover", `${id}-prompts.jsonl`), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(prompt => ownTurnText(prompt).includes(marker)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
};
const counts = async (marker: string) => Object.fromEntries(await Promise.all(Object.keys(profiles).map(async id => [id, (await promptRows(id, marker)).length])));
const canonical = async (threadId: string, sendId: string) => {
  const status = await query<any>("modelHosts:requestStatus", { sessionToken: accounts.requester, threadId, clientId: `send:${sendId}`, now: Date.now() });
  const rows = await query<any>("agentThreads:messagesSince", { sessionToken: accounts.requester, threadId, afterSeq: 0, limit: 200 });
  return { status, ...rows };
};
const start = async (name: string, primary: any, fallback: any[], quota = true, options?: { gated?: boolean; beforeSend?(): Promise<void> }) => {
  assert.equal(record.cases[name], undefined, "An accepted or uncertain request cannot be replayed by this verifier");
  const marker = `HANDOVER_044_${name}_${randomUUID()}`, sendId = randomUUID(), botId = pair.clients.requester.botId;
  const row = record.cases[name] = { startedAt: new Date().toISOString(), marker, sendId, stage: "preparing", primary, fallback };
  await save();
  await api("requester", "PATCH", `/api/bots/${botId}`, { quotaFallback: quota, fallback, fallbackApiAllowed: true });
  const made = await api("requester", "POST", `/api/bots/${botId}/tasks`, { title: `Handover · ${name}` });
  row.localThreadId = made.bot.threadId;
  const currentBot = (await api("requester", "GET", "/api/bots")).bots.find((candidate: any) => candidate.id === botId);
  row.startedWithInheritedProjectFolder = made.task?.cwd === undefined && typeof currentBot.cwd === "string" && currentBot.cwd.length > 0;
  await api("requester", "PATCH", `/api/bots/${botId}/tasks/${row.localThreadId}`, { modelSelection: primary, resetApprovalToAsk: true, requireAvailableModel: true });
  const reply = `COMPLETED_${marker}`;
  if (options?.gated) {
    row.readyFile = join(pair.clients.owner.dataDir, "handover", `${name}-${sendId}-ready`);
    row.gateFile = join(pair.clients.owner.dataDir, "handover", `${name}-${sendId}-gate`);
  }
  for (const who of ["owner", "requester"] as const) await writeFile(join(pair.clients[who].dataDir, "room-plan.json"), JSON.stringify({ [pair.clients[who].botId]: { reply, steps: [], ...(who === "owner" && options?.gated ? { readyFile: row.readyFile, gateFile: row.gateFile } : {}) } }));
  row.reply = reply; row.stage = "sending"; await save();
  await options?.beforeSend?.();
  const sent = await api("requester", "POST", `/api/bots/${botId}/messages`, { threadId: row.localThreadId, text: marker, sendId });
  row.localMessageId = sent.message?.id; row.stage = "accepted"; await save();
  const bot = (await api("requester", "GET", "/api/bots")).bots.find((candidate: any) => candidate.id === botId);
  row.cloudThreadId = bot.tasks.find((task: any) => task.threadId === row.localThreadId)?.shared?.cloudThreadId;
  assert.ok(row.cloudThreadId);
  const begun = await canonical(row.cloudThreadId, sendId); row.firstExecutionId = begun.status?.currentExecutionId;
  await save(); return row;
};
const complete = async (row: any, expected: Record<string, number>, sourceId?: string) => {
  const final = await waitFor(async () => { const data = await canonical(row.cloudThreadId, row.sendId); return data.status && data.status.runStatus === "succeeded" && data.messages.some((line: any) => line.role === "bot" && line.kind === "text" && line.text === row.reply) ? data : null; }, `${row.marker} completes once`);
  assert.equal(final.messages.filter((line: any) => line.clientId === `send:${row.sendId}`).length, 1);
  const replies = final.messages.filter((line: any) => line.role === "bot" && line.kind === "text" && line.text === row.reply);
  assert.equal(replies.length, 1); if (sourceId) assert.equal(replies[0].sourceId, sourceId);
  const actual = await counts(row.marker); for (const id of Object.keys(profiles)) assert.equal(actual[id], expected[id] ?? 0, `Unexpected ${id} invocation count`);
  row.counts = actual; row.runStatus = final.status.runStatus; row.canonicalUserRows = 1; row.canonicalReplyRows = 1;
  row.finalModel = final.status.model; row.finalProvider = final.status.provider; row.stage = "passed"; row.finishedAt = new Date().toISOString(); await save();
};
const ownerProviderPids = (): number[] => {
  assert.equal(process.platform, "win32"); assert.ok(Number.isSafeInteger(pair.clients.owner.pid));
  const command = `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pair.clients.owner.pid}" | Where-Object { $_.CommandLine -like '*fake-claude-cli.ts*' -and $_.CommandLine -like '*stream-json*' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`;
  const value = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true }).trim();
  return value ? [JSON.parse(value)].flat() : [];
};
const acceptedGate = async (name: "stop" | "revoke") => {
  const before = ownerProviderPids();
  const row = await start(name, remoteModel(record.sources.ownerGood), [localModel("localGood")], true, { gated: true });
  await waitFor(async () => { try { return await readFile(row.readyFile, "utf8") === "ready"; } catch { return false; } }, "owner fake CLI has accepted gated work");
  const accepted = await canonical(row.cloudThreadId, row.sendId);
  assert.equal(accepted.status.executionStatus, "running"); assert.equal(accepted.status.safeToRetry, false);
  row.acceptedProviderPids = ownerProviderPids().filter(pid => !before.includes(pid)); assert.equal(row.acceptedProviderPids.length, 1);
  row.acceptedExecutionId = accepted.status.currentExecutionId; await save();
  if (name === "stop") await api("requester", "POST", `/api/bots/${pair.clients.requester.botId}/interrupt`, { threadId: row.localThreadId });
  else await api("owner", "POST", "/api/origin/model-host/revoke", { teamId: accounts.teamId });
  const final = await waitFor(async () => { const data = await canonical(row.cloudThreadId, row.sendId); return data.status?.runStatus === (name === "stop" ? "cancelled" : "interrupted") ? data : null; }, "accepted hosted work is cancelled without fallback");
  await waitFor(async () => row.acceptedProviderPids.every((pid: number) => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; throw error; } }), "exact accepted owner fake CLI exits after cancellation", 25_000);
  await writeFile(row.gateFile, "released after cancellation");
  await new Promise(done => setTimeout(done, 750));
  const settled = await canonical(row.cloudThreadId, row.sendId);
  assert.equal(settled.messages.filter((line: any) => line.clientId === `send:${row.sendId}`).length, 1);
  assert.equal(settled.messages.filter((line: any) => line.text === row.reply).length, 0);
  row.counts = await counts(row.marker); assert.equal(row.counts.ownerGood, 1); assert.equal(row.counts.localGood, 0);
  row.runStatus = final.status.runStatus; row.exactAcceptedProviderExited = true; row.noReplyAfterGateRelease = true; row.stage = "passed"; row.finishedAt = new Date().toISOString(); await save();
};
try {
  if (selectedCase === "configure") {
    assert.equal(record.configuredAt, undefined);
    assert.ok(record.instances);
    record.fixtureSource = await Promise.all(["server/testing/fake-claude-cli.ts", "server/testing/native-model-host-profile.ts", "scripts/verify-origin-model-host-handover.ts"].map(async path => ({ path, sha256: createHash("sha256").update(await readFile(join(root, path))).digest("hex") })));
    for (const who of ["owner", "requester"] as const) {
      const local = pair.clients[who];
      assert.equal((await api(who, "GET", "/api/origin/model-host")).ready, true);
      assert.ok(basename(local.dataDir).startsWith("openmausbot-verify-data-"));
      for (const [id] of Object.entries(profiles).filter(([, value]) => value.who === who)) assert.equal(record.instances[id].instanceId, id);
    }
    record.sources = {};
    for (const id of ["ownerQuota", "ownerGood", "ownerPartial", "ownerMetered"]) {
      const grant = await api("owner", "PUT", "/api/origin/model-host/sources", { teamId: accounts.teamId, instanceId: record.instances[id].instanceId, label: `Synthetic ${id}`, models: [model], enabled: true, projectIds: [accounts.projectId], workspaceHead: false, capacity: 1 });
      const settings = await api("owner", "GET", "/api/origin/model-host");
      const host = settings.hosts.find((host: any) => host.teamId === accounts.teamId);
      record.sources[id] = { sourceId: grant.source.sourceId, hostId: host.hostId, billing: grant.source.billing };
      assert.equal(grant.source.billing, profiles[id].billing ?? "subscription");
    }
    await waitFor(async () => { const catalog = await api("requester", "GET", `/api/origin/model-host/catalog?botId=${pair.clients.requester.botId}`); return Object.values(record.sources).every((source: any) => catalog.sources.some((row: any) => row.sourceId === source.sourceId)); }, "all controlled owner sources online");
    record.configuredAt = new Date().toISOString(); record.factoryVersion = "2.1.300 / token-sealed profile v1"; delete record.failure; await save();
  } else {
    assert.ok(record.configuredAt, "Configure the synthetic profiles first");
    if (selectedCase === "remote-local") await complete(await start(selectedCase, remoteModel(record.sources.ownerQuota), [localModel("localGood")]), { ownerQuota: 1, localGood: 1 });
    if (selectedCase === "local-remote") await complete(await start(selectedCase, localModel("localQuota"), [remoteModel(record.sources.ownerGood)]), { localQuota: 1, ownerGood: 1 }, record.sources.ownerGood.sourceId);
    if (selectedCase === "remote-remote") await complete(await start(selectedCase, remoteModel(record.sources.ownerQuota), [remoteModel(record.sources.ownerGood)]), { ownerQuota: 1, ownerGood: 1 }, record.sources.ownerGood.sourceId);
    if (selectedCase === "partial") {
      const row = await start(selectedCase, remoteModel(record.sources.ownerPartial), [localModel("localGood")]);
      const final = await waitFor(async () => { const data = await canonical(row.cloudThreadId, row.sendId); return data.status?.runStatus === "failed" ? data : null; }, "partial work refuses automatic fallback");
      assert.ok(final.messages.some((line: any) => line.text?.includes("A partial response already exists.")));
      row.counts = await counts(row.marker); assert.equal(row.counts.ownerPartial, 1); assert.equal(row.counts.localGood, 0);
      row.stage = "passed"; row.runStatus = final.status.runStatus; row.finishedAt = new Date().toISOString(); await save();
    }
    if (selectedCase === "offline") {
      const privatePath = join(folder, "private/handover-offline-host.json");
      let offline: any;
      try { offline = JSON.parse(await readFile(privatePath, "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const host = await mutation<any>("modelHosts:register", { sessionToken: accounts.owner, teamId: accounts.teamId, deviceId: randomUUID(), name: "Controlled offline synthetic host", capacity: 1 });
        assert.ok(host.hostToken);
        const sourceId = await mutation<string>("modelHosts:setSource", { sessionToken: accounts.owner, hostId: host.hostId, sourceKey: randomUUID(), provider: "claudeAgent", label: "Offline synthetic subscription", billing: "subscription", models: [model], enabled: true, projectIds: [accounts.projectId], workspaceHead: false, capacity: 1 });
        offline = { ...host, sourceId }; await writeFile(privatePath, JSON.stringify(offline), { flag: "wx", mode: 0o600 });
      }
      const online = (value: boolean) => mutation("modelHosts:heartbeat", { hostId: offline.hostId, hostToken: offline.hostToken, online: value, sources: [{ sourceId: offline.sourceId, available: value, models: [model] }] });
      const fallback = [remoteModel(offline), localModel("localGood")];
      await online(true);
      const control = await start("offline-nonquota-control", localModel("localGood"), fallback, true, { beforeSend: async () => { await online(false); } });
      await complete(control, { localGood: 1 });
      await online(true);
      const row = await start("offline", localModel("localQuota"), fallback, true, { beforeSend: async () => { await online(false); } });
      await complete(row, { localQuota: 1, localGood: 1 });
      row.controlledOfflineSourceId = offline.sourceId; row.offlineCandidateSkippedAfterTypedQuota = true; await save();
    }
    if (selectedCase === "stop" || selectedCase === "revoke") await acceptedGate(selectedCase);
    if (selectedCase === "cap") {
      const before = await api("owner", "GET", "/api/daily-api-budget");
      assert.equal(before.spentUsd, 0); assert.equal(before.reservedUsd, 0);
      await api("owner", "PUT", "/api/config", { dailyApiBudget: { limitUsd: 0, timeZone: "Europe/Rome" } });
      assert.equal((await api("owner", "GET", "/api/origin/model-host")).ready, true);
      const row = await start("cap", remoteModel(record.sources.ownerMetered), [localModel("localGood")]);
      const refused = await waitFor(async () => { const data = await canonical(row.cloudThreadId, row.sendId); return data.status?.currentExecutionId && data.status.executionStatus === "refused" ? data : null; }, "owner refuses metered CLI under zero API cap");
      const execution = await query<any>("modelHosts:executionStatus", { sessionToken: accounts.requester, executionId: refused.status.currentExecutionId });
      assert.equal(execution.refusal, "configuration");
      await new Promise(done => setTimeout(done, 750));
      row.counts = await counts(row.marker); for (const value of Object.values(row.counts)) assert.equal(value, 0);
      const after = await api("owner", "GET", "/api/daily-api-budget");
      assert.equal(after.spentUsd, 0); assert.equal(after.reservedUsd, 0); assert.equal(after.global.exceeded, true);
      await api("requester", "POST", `/api/bots/${pair.clients.requester.botId}/interrupt`, { threadId: row.localThreadId });
      await api("owner", "PUT", "/api/config", { dailyApiBudget: null });
      row.ownerLedger = { spentUsd: after.spentUsd, reservedUsd: after.reservedUsd }; row.failClosedBeforeProviderDispatch = true;
      row.scope = "Opaque metered Claude CLI preflight; no positive HTTP API cost acceptance"; row.stage = "passed"; row.finishedAt = new Date().toISOString(); await save();
    }
  }
  console.log(JSON.stringify({ case: selectedCase, result: "passed", receipt: ".omb-scratch/model-host-native-044/handover.json" }));
} catch (error) {
  const redact = (value: string) => [accounts.owner, accounts.requester].reduce((text, token) => text.replaceAll(token, "[synthetic-session]"), value);
  record.failure = { case: selectedCase, message: redact(error instanceof Error ? error.message : String(error)), at: new Date().toISOString() }; await save();
  console.error(redact(String(error))); process.exitCode = 1;
}
