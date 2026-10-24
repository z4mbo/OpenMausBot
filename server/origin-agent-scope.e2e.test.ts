import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { startFakeConvex, type FakeConvex } from "../scripts/testing/origin-convex-backend.ts";
import { encryptSecret } from "../src/components/origin-pages/vaultCrypto.ts";

type Json = Record<string, any>;

async function seed(convex: FakeConvex) {
  const { createSession } = await convex.load<{ createSession(ctx: unknown, id: string): Promise<string> }>("convex/lib/auth.ts");
  const sessionToken = await convex.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Scope Tester", email: "scope@fixture.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const mutate = (name: string, args: Json) => convex.t.mutation(convex.ref(name), { sessionToken, ...args }) as Promise<any>;
  const { teamId } = await mutate("workspaces:create", { name: "Scope Fixture" });
  const projectIds: string[] = [];
  const taskIds: string[] = [];
  for (const name of ["Alpha", "Beta", "Elsewhere"]) {
    const projectId = String(await mutate("projects:create", { teamId, name }));
    projectIds.push(projectId);
    taskIds.push(String(await mutate("tasks:createTask", { projectId, title: `${name} private issue`, priority: "medium", assignedToEmail: "scope@fixture.test", dueDate: "2030-01-01" })));
  }
  await mutate("issueRelations:connect", { fromTaskId: taskIds[0], toTaskId: taskIds[1], kind: "blocks" });
  await mutate("issueRelations:connect", { fromTaskId: taskIds[0], toTaskId: taskIds[2], kind: "blocks" });
  return { sessionToken, projectIds, taskIds };
}

function scriptedEngine(dataDir: string) {
  const planPrefix = join(dataDir, "scope-plan-");
  const wrapper = join(dataDir, "scope-cli.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'const at = process.argv.indexOf("--mcp-config");',
    'const env = at < 0 ? undefined : JSON.parse(readFileSync(process.argv[at + 1], "utf8")).mcpServers?.agents?.env;',
    "if (env?.OMB_BOT_ID) {",
    `const planFile = ${JSON.stringify(planPrefix)} + env.OMB_BOT_ID + ".json";`,
    'const turns = existsSync(planFile) ? JSON.parse(readFileSync(planFile, "utf8")) : [];',
    'const turn = turns.shift() ?? { replies: ["Project report delivered."], tools: [] };',
    'writeFileSync(planFile, JSON.stringify(turns));',
    'process.env.FAKE_CLAUDE_REPLIES = JSON.stringify(turn.replies);',
    'process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify(turn.tools);',
    'process.env.FAKE_CLAUDE_EXIT_AFTER_TURN = "1";',
    "}",
    `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`,
  ].join("\n"), { mode: 0o700 });
  return { wrapper, plan(botId: string, turns: Json[]) {
    writeFileSync(`${planPrefix}${botId}.json`, JSON.stringify(turns));
  } };
}

it("confines a project Chief and lets its workspace head coordinate projects, inspect work and delete a managed issue", async () => {
  const convex = await startFakeConvex();
  const fixture = await launchVerificationServer(process.env);
  const { url, dataDir, logPath } = fixture.info;
  const evidence: Json = { fixture: fixture.info };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json", origin: url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json() as Json;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(200);
    return value;
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", url]) as Promise<Json>;
  const query = (name: string, args: Json) => convex.t.query(convex.ref(name), args) as Promise<any>;
  const tool = (name: string, input: Json) => ({ name, server: "agents", input });
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as Json[];
  try {
    const { sessionToken, projectIds, taskIds } = await seed(convex);
    const chiefs: Json[] = [];
    for (const name of ["Alpha", "Beta", "Elsewhere"]) {
      const bot = (await control(["new-bot", "--name", `${name} Chief`, "--section", name])).bot;
      await api("PATCH", `/api/bots/${bot.id}`, { chiefOfStaff: true });
      chiefs.push(bot);
    }
    const alpha = chiefs[0]!;
    const beta = chiefs[1]!;
    const head = (await control(["new-bot", "--name", "Workspace Head", "--section", "Workspace: Scope"])).bot;
    await api("PATCH", `/api/bots/${head.id}`, { chiefOfStaff: true, managedSections: ["Alpha", "Beta"], acknowledgePeerScope: true });
    await api("PATCH", `/api/bots/${alpha.id}`, { managedSections: ["Beta", "Elsewhere"], acknowledgePeerScope: true });
    writeFileSync(join(dataDir, "origin-cloud.json"), JSON.stringify({ url: convex.url, sessionToken, projects: Object.fromEntries(chiefs.map((chief, index) => [chief.id, projectIds[index]])) }), { mode: 0o600 });
    const work = join(dataDir, "alpha-work");
    mkdirSync(work);
    const encrypted = await encryptSecret("fixture-api-value-for-alpha", "fixture-passphrase");
    writeFileSync(join(work, "key.json"), JSON.stringify(encrypted));
    await api("PATCH", `/api/bots/${alpha.id}`, { cwd: work });
    const engine = scriptedEngine(dataDir);
    await api("PATCH", "/api/instances/claude", { cli: engine.wrapper });
    engine.plan(alpha.id, [{ replies: ["Alpha scoped work verified."], tools: [
      tool("origin_list_projects", {}),
      tool("origin_get_issue", { issue_id: taskIds[0] }),
      tool("origin_get_issue", { project: projectIds[1], issue_id: taskIds[1] }),
      tool("origin_delete_issue", { issue_id: taskIds[1] }),
      tool("coordinate_bots", { bot_ids: [beta.id], message: "Forbidden cross-project work" }),
      tool("origin_vault_store", { title: "Fixture API", path: join(work, "key.json") }),
    ] }]);
    evidence.projectSend = await control(["send", "--bot", alpha.id, "--text", "Verify only Alpha's scope."]);
    evidence.projectWait = await control(["wait", "--bot", alpha.id, "--timeout", "45"]);
    expect(evidence.projectWait.status).toBe("settled");
    evidence.projectMessages = await messages(alpha.activeTaskId);
    const activity = evidence.projectMessages.filter((m: Json) => m.tool?.itemId);
    const ran = (name: string) => activity.filter((m: Json) => m.tool.name.endsWith(name));
    expect(ran("origin_list_projects")[0]?.tool.ok).toBe(true);
    expect(ran("origin_list_projects")[0]?.tool.output).not.toContain("Beta Chief");
    expect(ran("origin_get_issue").map((m: Json) => m.tool.ok)).toEqual([true, false]);
    expect(ran("origin_get_issue")[0]?.tool.output).not.toContain("Beta private issue");
    expect(ran("origin_get_issue")[0]?.tool.output).not.toContain("Elsewhere private issue");
    expect(ran("origin_delete_issue")[0]?.tool.ok).toBe(false);
    expect(ran("coordinate_bots")[0]?.tool.ok).toBe(false);
    expect(ran("origin_vault_store")[0]?.tool.ok).toBe(true);
    const vault = await query("credentials:list", { sessionToken, projectId: projectIds[0] });
    expect(vault).toEqual([expect.objectContaining({ title: "Fixture API", ciphertext: encrypted.ciphertext })]);
    expect(vault[0].agentUse).toBeUndefined();
    expect((await query("tasks:details", { sessionToken, projectId: projectIds[1], taskId: taskIds[1] })).task._id).toBe(taskIds[1]);

    engine.plan(head.id, [{ replies: ["Waiting for project reports."], tools: [
      tool("origin_list_projects", {}), tool("list_bots", {}), tool("list_threads", {}),
      tool("read_agent_transcript", { bot_id: alpha.id, thread_id: alpha.activeTaskId }),
      tool("origin_get_issue", { project: projectIds[0], issue_id: taskIds[0] }),
      tool("origin_delete_issue", { project: projectIds[1], issue_id: taskIds[1] }),
      tool("coordinate_bots", { bot_ids: [alpha.id, beta.id], message: "Return your project report.", reason: "Workspace scope acceptance" }),
    ] }, { replies: ["Workspace reports verified."], tools: [tool("assignment_status", {})] }]);
    evidence.headSend = await control(["send", "--bot", head.id, "--text", "Read Alpha's transcript, remove Beta's disposable issue and collect both Chiefs' reports."]);
    evidence.headWait = await control(["wait", "--bot", head.id, "--timeout", "60"]);
    expect(evidence.headWait.status).toBe("settled");
    evidence.headMessages = await messages(head.activeTaskId);
    const headActivity = evidence.headMessages.filter((m: Json) => m.tool?.itemId);
    for (const name of ["origin_list_projects", "list_bots", "list_threads", "read_agent_transcript", "origin_delete_issue", "coordinate_bots"]) {
      expect(headActivity.find((m: Json) => m.tool.name.endsWith(name))?.tool.ok, name).toBe(true);
    }
    const outputOf = (name: string) => headActivity.find((m: Json) => m.tool.name.endsWith(name))?.tool.output;
    expect(outputOf("read_agent_transcript")).toContain("Alpha scoped work verified.");
    expect(outputOf("origin_get_issue")).toContain("Beta private issue");
    expect(outputOf("origin_get_issue")).not.toContain("Elsewhere private issue");
    expect(outputOf("list_bots")).toContain("Alpha Chief");
    expect(outputOf("list_bots")).toContain("Beta Chief");
    expect(outputOf("list_bots")).not.toContain("Elsewhere Chief");
    expect(JSON.stringify(evidence.headMessages)).toContain("Workspace reports verified.");
    const betaBoard = await query("tasks:board", { sessionToken, projectId: projectIds[1] });
    expect(betaBoard.tasks).toEqual([]);
    const outside = await query("tasks:details", { sessionToken, projectId: projectIds[2], taskId: taskIds[2] });
    expect(outside.task.title).toBe("Elsewhere private issue");
    evidence.backend = { vault: vault.map((item: Json) => ({ title: item.title, agentUse: item.agentUse === true, encrypted: item.ciphertext === encrypted.ciphertext })), betaIssueCount: betaBoard.tasks.length, outsideIssue: outside.task.title };
    evidence.result = "passed";
  } finally {
    const evidencePath = `${logPath}.scope.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath, logPath }));
    await fixture.close();
    await convex.close();
  }
}, 180_000);
