// The fake CLI plays the frames Claude Code 2.1.295 sent past its weekly limit.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { runControlOmb, verificationServerArgs, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";
import { freePortBlock } from "./testing/ports.ts";
import type { InstanceConfig } from "./contracts.ts";

const LIMITED = "Limited Claude";
const BACKUP = "Backup Claude";
const FAKE_CLI = fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url));
const jsonLines = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

async function withQuotaFixture(
  options: { env?: Record<string, string>; primary?: (dataDir: string) => InstanceConfig; backup?: (dataDir: string, prompts: string) => InstanceConfig },
  check: (fixture: {
    api: (method: string, path: string, body?: unknown) => Promise<any>;
    control: (...args: string[]) => Promise<any>;
    respond: (threadId: string, body: unknown) => Promise<{ status: number; body: any }>;
    backupPrompts: () => any[];
    dataDir: string;
  }) => Promise<void>,
) {
  const port = await freePortBlock([0, 1]);
  const url = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "openmausbot-quota-switch-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  const evidenceDir = join(tmpdir(), "openmausbot-verification-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const logPath = join(evidenceDir, `quota-switch-${Date.now()}-${process.pid}.log`);
  const backupFile = join(dataDir, "backup-prompts.jsonl");
  const engine = (displayName: string, environment: Record<string, string>) =>
    ({ driver: "claudeAgent", displayName, config: { cli: FAKE_CLI }, environment });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    instances: {
      claude: options.primary?.(dataDir) ?? engine(LIMITED, { FAKE_CLAUDE_MODE: "usage-limit" }),
      backup: options.backup?.(dataDir, backupFile) ?? engine(BACKUP, { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_PROMPTS: backupFile, FAKE_CLAUDE_TOOL_CALLS: "[]" }),
    },
  }));
  const evidence: unknown[] = [{ url, options }];
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  const control = async (...args: string[]) => {
    const result = await runControlOmb([...args, "--url", url]) as any;
    evidence.push({ command: args, result });
    return result;
  };
  /** A card answer as a client posts it, with the status it got. */
  const respond = async (threadId: string, body: unknown) => {
    const response = await fetch(`${url}/api/threads/${threadId}/respond`, {
      method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const answer = { status: response.status, body: await response.json() };
    evidence.push({ respond: body, answer });
    return answer;
  };
  try {
    const env = { ...verificationServerEnvironment({}, dataDir, port), ...options.env };
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, verificationServerArgs(env), {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 90_000 }).toBe(true);
    await check({ api, control, respond, backupPrompts: () => jsonLines(backupFile), dataDir });
  } finally {
    evidence.push({ backupPrompts: jsonLines(backupFile), roots: readHandoffs(dataDir) });
    const evidencePath = `${logPath}.quota-switch.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await waitForExit(server, { signal: "SIGTERM" });
    await removeTempDir(dataDir);
    console.info(JSON.stringify({ logPath, evidencePath, fixtureRemoved: !existsSync(dataDir) }));
  }
}

it.each(["claude", "codex", "grok"] as const)("automatically continues one explicitly refused %s request on its ranked backup", async driver => {
  await withQuotaFixture({ primary: (dataDir): InstanceConfig => {
    if (driver === "claude") return { driver: "claudeAgent", config: { cli: FAKE_CLI }, environment: { FAKE_CLAUDE_MODE: "usage-limit" } };
    if (driver === "codex") return { driver: "codex", config: { cli: fileURLToPath(new URL("./testing/fake-codex-app-server.ts", import.meta.url)) }, environment: { FAKE_CODEX_MODE: "usage-limit" } };
    const failure = join(dataDir, "grok-quota.json"), home = join(dataDir, "grok");
    mkdirSync(home);
    writeFileSync(join(home, "auth.json"), "{}");
    writeFileSync(failure, JSON.stringify({ code: -32000, message: "Provider allowance exhausted", data: { code: "usage_limit_reached" } }));
    return { driver: "grokAgent", config: { cli: fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url)) },
      environment: { GROK_HOME: home, FAKE_ACP_RPC_FAILURE_FILE: failure, FAKE_ACP_RPC_FAILURE_METHOD: "session/prompt" } };
  } }, async ({ api, control, backupPrompts, dataDir }) => {
    const descriptions = (await api("GET", "/api/instances")).instances as any[];
    const primary = descriptions.find(instance => instance.instanceId === "claude"), backup = descriptions.find(instance => instance.instanceId === "backup");
    expect(primary.snapshot.billing).toBe("subscription");
    await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: 0, timeZone: "Europe/Rome" } });
    const { bot } = await control("new-bot", "--name", "Ranked quota backup");
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: { instanceId: "claude", model: primary.models.default }, updateBotDefault: true });
    await api("PATCH", `/api/bots/${bot.id}`, { quotaFallback: true, fallback: [{ instanceId: "backup", model: backup.models.default }] });
    const { task: sibling } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Sibling unchanged" });
    const text = "QUOTA_FALLBACK_ONCE_8K";
    await control("send", "--bot", bot.id, "--task", threadId, "--text", text);
    expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30")).status).toBe("settled");
    expect(backupPrompts()).toHaveLength(1);
    const messages = (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
    expect(messages.filter(message => message.role === "user" && message.text === text)).toHaveLength(1);
    expect(messages.filter(message => message.card?.quotaSwitch)).toHaveLength(0);
    expect(messages.findLast(message => message.role === "bot" && message.kind === "text")).toMatchObject({ text: "hello from fake claude", turnSucceeded: true });
    const after = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    expect(after.modelSelection.instanceId).toBe("claude");
    expect(after.tasks.find((entry: any) => entry.threadId === sibling.threadId).modelSelection.instanceId).toBe("claude");
    expect(after.tasks.find((entry: any) => entry.threadId === threadId).modelSelection.instanceId).toBe("backup");
    const roots = readHandoffs(dataDir);
    expect(roots.filter(root => !root.parentId && root.status === "completed")).toHaveLength(1);
  });
}, 90_000);

it.each(["usage-limit-after-text", "usage-limit-after-tool"])("does not automatically replay after %s", async mode => {
  await withQuotaFixture({ primary: () => ({ driver: "claudeAgent", config: { cli: FAKE_CLI }, environment: { FAKE_CLAUDE_MODE: mode } }) }, async ({ api, control, respond, backupPrompts }) => {
    const instances = (await api("GET", "/api/instances")).instances as any[];
    const { bot } = await control("new-bot", "--name", "Partial work must not replay");
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: { instanceId: "claude", model: instances.find(row => row.instanceId === "claude").models.default }, updateBotDefault: true });
    await api("PATCH", `/api/bots/${bot.id}`, { quotaFallback: true, fallback: [{ instanceId: "backup", model: instances.find(row => row.instanceId === "backup").models.default }] });
    await control("send", "--bot", bot.id, "--task", threadId, "--text", "DO_NOT_REPEAT_PARTIAL_WORK");
    expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30")).job.state).toBe("failed");
    expect(backupPrompts()).toHaveLength(0);
    let messages: any[] = [];
    await expect.poll(async () => {
      messages = (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages;
      return messages.filter(message => message.card?.quotaSwitch).length;
    }, { timeout: 10_000 }).toBe(1);
    const offer = messages.find(message => message.card?.quotaSwitch);
    expect(offer.card.subtitle).toContain("nothing will be sent again");
    expect(offer.card.quotaSwitch.messageId).toBeUndefined();
    expect((await respond(threadId, { requestId: offer.card.requestId, behavior: "answer", message: BACKUP })).body.outcome).toBe("answered");
    expect(backupPrompts()).toHaveLength(0);
    expect((await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages.filter((message: any) => message.role === "user")).toHaveLength(1);
  });
}, 90_000);

it("terminates an exhausted ranked chain without cycling back to an account", async () => {
  await withQuotaFixture({ backup: (_dir, prompts) => ({ driver: "claudeAgent", displayName: BACKUP, config: { cli: FAKE_CLI },
    environment: { FAKE_CLAUDE_MODE: "usage-limit", FAKE_CLAUDE_PROMPTS: prompts } }) }, async ({ api, control, backupPrompts, dataDir }) => {
    const instances = (await api("GET", "/api/instances")).instances as any[];
    const selection = (instanceId: string) => ({ instanceId, model: instances.find(row => row.instanceId === instanceId).models.default });
    const { bot } = await control("new-bot", "--name", "Finite ranked fallback");
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { modelSelection: selection("claude"), updateBotDefault: true });
    await api("PATCH", `/api/bots/${bot.id}`, { quotaFallback: true, fallback: [selection("backup"), selection("claude"), selection("backup")] });
    await control("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "NO_QUOTA_CYCLE");
    expect((await control("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("failed");
    expect(backupPrompts()).toHaveLength(1);
    const messages = (await api("GET", `/api/threads/${bot.activeTaskId}/messages?limit=100`)).messages as any[];
    expect(messages.filter(message => message.role === "user")).toHaveLength(1);
    expect(messages.filter(message => message.tool?.name?.startsWith("recovery:"))).toHaveLength(1);
    expect(readHandoffs(dataDir).filter(row => !row.parentId && row.status === "failed")).toHaveLength(2);
  });
}, 90_000);

it.each([{ apiAllowed: false }, { apiAllowed: true, cap: 0 }])("does not silently use a paid CLI backup with $apiAllowed and cap $cap", async ({ apiAllowed, cap }) => {
  await withQuotaFixture({ backup: (_dir, prompts) => ({ driver: "claudeAgent", displayName: BACKUP, config: { cli: FAKE_CLI, requireApiKey: true },
    environment: { ANTHROPIC_API_KEY: "synthetic-fixture-only", FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_PROMPTS: prompts } }) }, async ({ api, control, backupPrompts }) => {
    const instances = (await api("GET", "/api/instances")).instances as any[];
    expect(instances.find(row => row.instanceId === "backup").snapshot.billing).toBe("metered");
    if (cap !== undefined) await api("PUT", "/api/config", { dailyApiBudget: { limitUsd: cap, timeZone: "Europe/Rome" } });
    const { bot } = await control("new-bot", "--name", "Paid fallback consent");
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { modelSelection: { instanceId: "claude", model: instances.find(row => row.instanceId === "claude").models.default }, updateBotDefault: true });
    await api("PATCH", `/api/bots/${bot.id}`, { quotaFallback: true, fallbackApiAllowed: apiAllowed, fallback: [{ instanceId: "backup", model: instances.find(row => row.instanceId === "backup").models.default }] });
    await control("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "NO_UNAPPROVED_API_SPEND");
    expect((await control("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("failed");
    expect(backupPrompts()).toHaveLength(0);
    const after = (await api("GET", "/api/bots")).bots.find((row: any) => row.id === bot.id);
    expect(after.tasks.find((task: any) => task.threadId === bot.activeTaskId).modelSelection.instanceId).toBe("claude");
  });
}, 90_000);

it("returns the HTTP send while the model is silent and Stop cancels the pending quota gate", async () => {
  await withQuotaFixture({ primary: () => ({ driver: "claudeAgent", config: { cli: FAKE_CLI }, environment: { FAKE_CLAUDE_MODE: "hang" } }) }, async ({ api, control, backupPrompts, dataDir }) => {
    const instances = (await api("GET", "/api/instances")).instances as any[];
    const { bot } = await control("new-bot", "--name", "Stop silent model");
    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.activeTaskId}`, { modelSelection: { instanceId: "claude", model: instances.find(row => row.instanceId === "claude").models.default }, updateBotDefault: true });
    await api("PATCH", `/api/bots/${bot.id}`, { quotaFallback: true, fallback: [{ instanceId: "backup", model: instances.find(row => row.instanceId === "backup").models.default }] });
    const sent = await Promise.race([control("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "STOP_THE_SILENT_MODEL"),
      new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("HTTP send waited for model output")), 5_000); timer.unref?.(); })]);
    expect(sent).toBeTruthy();
    await control("interrupt", "--bot", bot.id, "--task", bot.activeTaskId);
    await expect.poll(async () => (await api("GET", "/api/bots")).bots.find((row: any) => row.id === bot.id).busy, { timeout: 10_000 }).toBe(false);
    expect(backupPrompts()).toHaveLength(0);
    expect(readHandoffs(dataDir).filter(row => row.status === "cancelled")).toHaveLength(1);
  });
}, 90_000);

it("delivers a quota-recovered specialist result to its Chief exactly once", async () => {
  await withQuotaFixture({ backup: (dataDir, prompts) => ({ driver: "claudeAgent", displayName: BACKUP, config: { cli: FAKE_CLI },
    environment: { FAKE_CLAUDE_ROOM_PLAN: join(dataDir, "room-plan.json"), FAKE_CLAUDE_PROMPTS: prompts, FAKE_CLAUDE_TOOL_CALLS: "[]" } }) }, async ({ api, control, dataDir }) => {
    const instances = (await api("GET", "/api/instances")).instances as any[];
    const selection = (instanceId: string) => ({ instanceId, model: instances.find(row => row.instanceId === instanceId).models.default });
    const { bot: chief } = await control("new-bot", "--name", "Quota Chief", "--section", "Leadership");
    const { bot: specialist } = await control("new-bot", "--name", "Quota specialist", "--section", "Engineering");
    await api("PATCH", `/api/bots/${chief.id}/tasks/${chief.activeTaskId}`, { modelSelection: selection("backup"), updateBotDefault: true });
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true });
    await api("PATCH", `/api/bots/${specialist.id}/tasks/${specialist.activeTaskId}`, { modelSelection: selection("claude"), updateBotDefault: true });
    await api("PATCH", `/api/bots/${specialist.id}`, { quotaFallback: true, fallback: [selection("backup")] });
    const brief = "VERIFY_QUOTA_SPECIALIST_ONCE", result = "QUOTA_SPECIALIST_VERIFIED", final = "Chief received one quota specialist result";
    const planPath = join(dataDir, "room-plan.json");
    writeFileSync(planPath, JSON.stringify({
      [chief.id]: { turns: [{ steps: [{ arguments: { bot_ids: [specialist.id], request_key: "quota-check", message: brief } }], reply: "Assigned quota check" },
        { expectContextIncludes: [result], reply: final }] },
      [specialist.id]: { turns: [{ expectContextIncludes: [brief], reply: result }] },
    }));
    await control("send", "--bot", chief.id, "--task", chief.activeTaskId, "--text", "Ask Engineering to verify and return one result.");
    expect((await control("wait", "--bot", chief.id, "--task", chief.activeTaskId, "--timeout", "30")).status).toBe("settled");
    const nodes = readHandoffs(dataDir);
    expect(nodes).toHaveLength(2);
    expect(nodes.every(row => row.status === "completed" && row.reported)).toBe(true);
    const child = nodes.find(row => row.botId === specialist.id)!;
    expect(child.result).toBe(result);
    expect(jsonLines(`${planPath}.evidence.jsonl`).filter(row => row.botId === specialist.id)).toHaveLength(1);
    const messages = (await api("GET", `/api/threads/${chief.activeTaskId}/messages?limit=100`)).messages as any[];
    expect(messages.filter(row => row.text === final)).toHaveLength(1);
    expect(messages.filter(row => row.roomRequest?.id === child.id && row.roomRequest.phase === "result")).toHaveLength(1);
    const after = (await api("GET", "/api/bots")).bots.find((row: any) => row.id === specialist.id);
    expect(after.modelSelection.instanceId).toBe("claude");
    expect(after.tasks.find((row: any) => row.threadId === child.threadId).modelSelection.instanceId).toBe("backup");
  });
}, 90_000);

/** A bot whose conversation runs on the limited engine, and the turn that
 * meets the limit. */
async function meetTheLimit(api: (method: string, path: string, body?: unknown) => Promise<any>, control: (...args: string[]) => Promise<any>, text: string) {
  const { bot } = await control("new-bot", "--name", "Out of quota");
  const threadId = bot.activeTaskId as string;
  const limited = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id).modelSelection;
  await api("PATCH", `/api/bots/${bot.id}/tasks/${threadId}`, { modelSelection: { ...limited, instanceId: "claude" }, updateBotDefault: true });
  await control("send", "--bot", bot.id, "--task", threadId, "--text", text);
  expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30")).status).toBe("failed");
  const messages = async () => (await api("GET", `/api/threads/${threadId}/messages?limit=100`)).messages as any[];
  const state = async () => (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
  return { bot, threadId, messages, state };
}

it("offers the working engine once, and on the person's answer switches this conversation and resends the exact message", async () => {
  await withQuotaFixture({}, async ({ api, control, respond, backupPrompts, dataDir }) => {
    const text = "SUMMARISE_THE_QUARTER_4K";
    const { bot, threadId, messages, state } = await meetTheLimit(api, control, text);
    const { task: sibling } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Sibling keeps its engine" });

    // One account of the failure, and one offer: the engine that works, by name.
    await expect.poll(async () => (await messages()).filter((message) => message.card?.quotaSwitch).length, { timeout: 20_000 }).toBe(1);
    const before = await messages();
    const failures = before.filter((message) => message.tool?.name?.startsWith("error:"));
    expect(failures).toHaveLength(1);
    expect(failures[0].tool.name).toMatch(/This Claude account has reached its usage limit/);
    const offer = before.find((message) => message.card?.quotaSwitch);
    expect(offer.card).toMatchObject({
      title: `${LIMITED} is out of quota`,
      subtitle: "Continue this conversation on another engine?",
      options: [BACKUP, "Not now"],
      fixedOptions: true,
      quotaSwitch: { engines: [{ instanceId: "backup", name: BACKUP }], messageId: before.find((message) => message.role === "user").id },
    });
    expect(offer.card.tool).toBeUndefined();
    // Nothing moved without the answer: same engine, the failed turn's root settled, nothing else begun.
    expect((await state()).tasks.find((task: any) => task.threadId === threadId)).toMatchObject({ busy: false });
    expect((await state()).modelSelection.instanceId).toBe("claude");
    expect(backupPrompts()).toHaveLength(0);
    const rootsBefore = readHandoffs(dataDir).filter((node) => node.threadId === threadId);
    expect(rootsBefore.map((node) => [node.status, node.outcome, node.executions])).toEqual([["failed", "provider_error", 1]]);
    // The card names that root: the answer asks the runtime about the request that ran out, not about the thread.
    expect(offer.card.quotaSwitch.rootId).toBe(rootsBefore[0]!.id);

    expect(await respond(threadId, { requestId: offer.card.requestId, behavior: "answer", message: BACKUP }))
      .toEqual({ status: 200, body: { ok: true, outcome: "answered" } });
    await expect.poll(() => backupPrompts().length, { timeout: 20_000 }).toBe(1);
    expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30")).status).toBe("settled");

    const after = await messages();
    // The message whose turn failed, sent once more: twice in the conversation, once to the engine that works.
    expect(after.filter((message) => message.role === "user" && message.text === text)).toHaveLength(2);
    expect(backupPrompts()).toHaveLength(1);
    expect(JSON.stringify(backupPrompts()[0])).toContain(text);
    expect(after.findLast((message) => message.role === "bot" && message.kind === "text")).toMatchObject({ text: "hello from fake claude", turnSucceeded: true });
    expect(after.filter((message) => message.tool?.name === `notice: continuing on ${BACKUP} after hitting quota`)).toHaveLength(1);
    // Settled only once the switch went through, inside the answer's own request: so who answered is on the card.
    expect(after.find((message) => message.id === offer.id).card).toMatchObject({ answered: "answer", answeredText: BACKUP, answeredBy: { kind: "loopback" } });
    expect(after.filter((message) => message.card?.quotaSwitch)).toHaveLength(1);
    expect(after.filter((message) => message.tool?.name?.startsWith("error:"))).toHaveLength(1);

    // This conversation moved; the bot's own engine and its other conversation did not.
    const bots = await state();
    const instances = (await api("GET", "/api/instances")).instances as any[];
    expect(bots.tasks.find((task: any) => task.threadId === threadId)).toMatchObject({
      modelSelection: { instanceId: "backup", model: instances.find((instance) => instance.instanceId === "backup").models.default }, busy: false,
    });
    expect(bots.modelSelection.instanceId).toBe("claude");
    expect(bots.tasks.find((task: any) => task.threadId === sibling.threadId).modelSelection?.instanceId ?? bots.modelSelection.instanceId).toBe("claude");

    // No job twice: the failed turn's root stayed settled, and the resend is one new root that completed.
    const roots = readHandoffs(dataDir).filter((node) => node.threadId === threadId);
    expect(roots.map((node) => [node.status, node.executions])).toEqual([["failed", 1], ["completed", 1]]);
    expect(roots[0]!.id).toBe(rootsBefore[0]!.id);

    // A second press on the settled card is refused as already answered: it
    // switches nothing, and its words never reach the bot as a message.
    const again = await respond(threadId, { requestId: offer.card.requestId, behavior: "answer", message: BACKUP });
    expect(again).toEqual({ status: 409, body: { error: "this question has already been answered" } });
    expect((await messages()).filter((message) => message.role === "user")).toHaveLength(2);
    expect(backupPrompts()).toHaveLength(1);
    expect(readHandoffs(dataDir).filter((node) => node.threadId === threadId)).toHaveLength(2);
  });
}, 240_000);

it.each([
  { name: "Not now", behavior: "answer", message: "Not now", outcome: "answered" },
  { name: "typed words that name no offered engine", behavior: "answer", message: "use whichever is fastest", outcome: "answered" },
  // Decline-only service trust (hosted, Cloud home, OMB_LOOPBACK_TRUST=service): a decline naming an engine chooses nothing.
  { name: "a decline that carries the offered engine's label", behavior: "deny", message: BACKUP, outcome: "rejected" },
  { name: "an allow that carries the offered engine's label", behavior: "allow", message: BACKUP, outcome: "rejected" },
])("changes nothing on $name", async ({ behavior, message, outcome }) => {
  await withQuotaFixture({}, async ({ api, control, respond, backupPrompts, dataDir }) => {
    const text = "LEAVE_THIS_WHERE_IT_IS_7M";
    const { threadId, messages, state } = await meetTheLimit(api, control, text);
    await expect.poll(async () => (await messages()).filter((entry) => entry.card?.quotaSwitch).length, { timeout: 20_000 }).toBe(1);
    const offer = (await messages()).find((entry) => entry.card?.quotaSwitch);

    expect(await respond(threadId, { requestId: offer.card.requestId, behavior, message }))
      .toEqual({ status: 200, body: { ok: true, outcome } });

    const after = await messages();
    expect(after.find((entry) => entry.id === offer.id).card).toMatchObject({ answered: "answer", answeredText: "Not now" });
    expect(after.filter((entry) => entry.role === "user")).toHaveLength(1);
    expect(after.some((entry) => entry.tool?.name?.startsWith("notice:"))).toBe(false);
    expect((await state()).tasks.find((task: any) => task.threadId === threadId)).toMatchObject({ busy: false });
    expect((await state()).modelSelection.instanceId).toBe("claude");
    // Nothing was switched and nothing was sent again: asked once more, the settled
    // card is refused, and the working engine was never run.
    expect(await respond(threadId, { requestId: offer.card.requestId, behavior: "answer", message: BACKUP }))
      .toEqual({ status: 409, body: { error: "this question has already been answered" } });
    expect((await state()).tasks.find((task: any) => task.threadId === threadId).modelSelection?.instanceId ?? "claude").toBe("claude");
    expect(backupPrompts()).toHaveLength(0);
    expect(readHandoffs(dataDir).filter((node) => node.threadId === threadId).map((node) => node.status)).toEqual(["failed"]);
  });
}, 240_000);

it("raises no card when OMB_QUOTA_SWITCH=0 switches it off", async () => {
  await withQuotaFixture({ env: { OMB_QUOTA_SWITCH: "0" } }, async ({ api, control, backupPrompts }) => {
    const { bot, threadId, messages } = await meetTheLimit(api, control, "NO_OFFER_WHEN_OFF_2B");
    // A second failed turn is the event that proves the first one's offer was never coming.
    await control("send", "--bot", bot.id, "--task", threadId, "--text", "STILL_NO_OFFER_3C");
    expect((await control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30")).status).toBe("failed");
    const after = await messages();
    expect(after.filter((message) => message.tool?.name?.startsWith("error:"))).toHaveLength(2);
    expect(after.some((message) => message.kind === "options")).toBe(false);
    expect(backupPrompts()).toHaveLength(0);
  });
}, 240_000);
