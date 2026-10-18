/// <reference types="vite/client" />
import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import schema from "../../backend/convex/schema";
import { api, internal } from "../../backend/convex/_generated/api";
import { createSession } from "../../backend/convex/lib/auth";
import { convexOriginClient as oldClient, runOriginTool as oldTool } from "C:/Users/aless/.codex/worktrees/origin-compat-client-030/Origin/server/origin-cloud.ts";
import { convexOriginClient as newClient, runOriginTool as newTool } from "C:/Users/aless/Documents/Origin-bugfix/server/origin-cloud.ts";
import { COMPATIBILITY_COVERAGE, DRAFT_PHASES, validateDraftReceipt } from "../backend-phase-031-contract.mjs";

const modules = import.meta.glob(["../../backend/convex/**/*.ts", "!../../backend/convex/**/*.test.ts"]);
const t = convexTest(schema, modules);
const evidence: Record<string, unknown> = { status: "running", releaseSource: null, baselineSource: "0eb372a94715527931043a1b6d8c02a50194dbb0", observedCandidateSource: "dd5b63ef914c5a546ea99cbef65b29b33078c7e9", backendRuntime: "3b85cb69c0c907a9aa08ba98b664cb5889cbe83a", coverage: COMPATIBILITY_COVERAGE, cases: [], requests: [], migrations: [], externalRequestsBlocked: 0, providerCalls: 0 };
const cases = evidence.cases as Record<string, unknown>[];
const requests = evidence.requests as Record<string, unknown>[];
const migrations = evidence.migrations as Record<string, unknown>[];
let server: Server;
let base: string;
let f: any;
let legacy: any[];
const sessions = new Map<string, string>();
const nativeFetch = globalThis.fetch;
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "sessionToken" ? `[synthetic ${sessions.get(String(item)) ?? "unknown"} session]` : redact(item)]));
  return value;
}
const publicFunctions = new Set(["tasks:board", "tasks:createTask", "tasks:ensureDefaultColumns", "tasks:details", "projects:get", "auth:me", "issueRelations:list", "issueRelations:labels"]);
beforeAll(async () => {
  f = await t.run(async ctx => {
    const people: Record<string, { id: any; token: string; email: string }> = {};
    for (const role of ["owner", "viewer", "foreign"] as const) {
      const email = `${role}-compatibility@example.test`;
      const id = await ctx.db.insert("users", { name: `Synthetic ${role}`, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      const token = await createSession(ctx, id); sessions.set(token, role); people[role] = { id, token, email };
    }
    return people;
  });
  f.teamId = (await t.mutation(api.workspaces.create, { sessionToken: f.owner.token, name: "Synthetic compatibility workspace" })).teamId;
  f.projectId = await t.mutation(api.projects.create, { sessionToken: f.owner.token, teamId: f.teamId, name: "Compatibility main", repoUrl: "https://github.com/fixture/compatibility" });
  f.foreignTeamId = (await t.mutation(api.workspaces.create, { sessionToken: f.foreign.token, name: "Foreign compatibility workspace" })).teamId;
  f.foreignProjectId = await t.mutation(api.projects.create, { sessionToken: f.foreign.token, teamId: f.foreignTeamId, name: "Foreign compatibility project" });
  await t.run(async ctx => {
    await ctx.db.patch(f.projectId, { githubWorkspaceAccess: true });
    await ctx.db.insert("teamMembers", { teamId: f.teamId, userId: f.viewer.id, email: f.viewer.email, name: "Synthetic viewer", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("members", { projectId: f.projectId, userId: f.viewer.id, email: f.viewer.email, name: "Synthetic viewer", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 });
  });
  f.columns = (await t.query(api.tasks.board, { sessionToken: f.owner.token, projectId: f.projectId })).columns;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const call = JSON.parse(raw);
    const args = jsonToConvex(call.args[0]) as Record<string, unknown>;
    const entry = { endpoint: req.url, path: call.path, format: call.format, args: redact(args), wireSha256: hash(raw), registeredHandlerInvoked: false, outcome: "pending" } as Record<string, unknown>;
    requests.push(entry);
    try {
      expect(req.method).toBe("POST"); expect(call.format).toBe("convex_encoded_json");
      expect(publicFunctions.has(call.path)).toBe(true);
      const kind = req.url === "/api/query" ? "query" : req.url === "/api/mutation" ? "mutation" : null;
      expect(kind).not.toBeNull();
      entry.registeredHandlerInvoked = true;
      const result = await t[kind!](makeFunctionReference(call.path), args);
      entry.outcome = "success"; entry.responseSha256 = hash(convexToJson(result));
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "success", value: convexToJson(result), logLines: [] }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry.outcome = "error"; entry.error = message;
      res.writeHead(560, { "Content-Type": "application/json" }); res.end(JSON.stringify({ status: "error", errorMessage: `Uncaught Error: ${message}`, logLines: [] }));
    }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback listener unavailable");
  base = `http://127.0.0.1:${address.port}`;
  expect([3210, 5199, 8799]).not.toContain(address.port);
  evidence.loopback = { host: "127.0.0.1", port: address.port, path: "/api/{query,mutation}", bridge: "Convex encoded-JSON protocol adapter; registered candidate handlers via convex-test" };
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.origin !== base) { evidence.externalRequestsBlocked = Number(evidence.externalRequestsBlocked) + 1; throw new Error("External network disabled in compatibility fixture"); }
    return nativeFetch(input, init);
  }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = nativeFetch;
  if (server) await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  evidence.status = "local-isolated-evidence";
  evidence.verifiedAt = new Date().toISOString();
  evidence.listenerClosed = !server?.listening;
  evidence.requests = requests;
  writeFileSync(resolve(import.meta.dirname, "observations.json"), JSON.stringify(evidence, null, 2) + "\n");
});
function deps(projectId: string, token = f.owner.token, current = false) {
  return { bots: [{ id: "compat-chief", name: "Compatibility Chief", section: "Compatibility", chiefOfStaff: true }], state: { url: base, sessionToken: token, projects: { "compat-chief": projectId } }, connect: current ? newClient : oldClient };
}
function requestFor(title: string) { return requests.find(request => request.path === "tasks:createTask" && (request.args as any).title === title)!; }
async function tasks(projectId: string) { return t.run(ctx => ctx.db.query("tasks").withIndex("by_project", q => q.eq("projectId", projectId as never)).collect()); }

test("baseline actual caller keeps explicit Todo and Draft request destinations", async () => {
  for (const [index, title] of [[1, "Baseline explicit Todo"], [0, "Baseline explicit Draft"]] as const) {
    const result = await oldTool("origin_create_issue", { title, column: f.columns[index]._id, due_date: "2027-01-01" }, "compat-chief", deps(f.projectId));
    expect(result.isError).not.toBe(true);
    const task = (await tasks(f.projectId)).find(task => task.title === title)!;
    expect(task.columnId).toBe(f.columns[index]._id); expect(task.done).toBe(false);
    expect((requestFor(title).args as any).columnId).toBe(f.columns[index]._id);
    expect(requestFor(title).registeredHandlerInvoked).toBe(true);
    cases.push({ name: title, caller: "actual0.2.10 runOriginTool+convexOriginClient", requestedColumnId: f.columns[index]._id, storedColumnId: task.columnId, passed: true });
  }
});
test("candidate actual caller omits destination and candidate registered backend supplies Draft", async () => {
  const title = "Candidate omitted Draft";
  const result = await newTool("origin_create_issue", { title, due_date: "2027-01-01" }, "compat-chief", deps(f.projectId, f.owner.token, true));
  expect(result.isError).not.toBe(true);
  expect(requestFor(title).args).not.toHaveProperty("columnId");
  const task = (await tasks(f.projectId)).find(task => task.title === title)!;
  expect(task.columnId).toBe(f.columns[0]._id); expect(task.done).toBe(false);
  cases.push({ name: title, caller: "actual candidate runOriginTool+convexOriginClient", requestColumnOmitted: true, storedColumnId: task.columnId, passed: true });
});
test("baseline actual transport sends omission unchanged and registered validator accepts Draft default", async () => {
  const title = "Baseline transport omitted Draft";
  const taskId = await oldClient(base).mutation("tasks:createTask", { sessionToken: f.owner.token, projectId: f.projectId, title, priority: "medium", assignedToEmail: f.owner.email, dueDate: "2027-01-01" });
  expect(requestFor(title).args).not.toHaveProperty("columnId");
  expect(await t.run(ctx => ctx.db.get(taskId as never))).toMatchObject({ columnId: f.columns[0]._id, done: false });
  cases.push({ name: title, caller: "actual0.2.10 convexOriginClient", requestColumnOmitted: true, passed: true });
});
test("legacy Idea privacy is held until ordered actual registered repair phases finish; tasks and links remain byte equal", async () => {
  legacy = await t.run(async ctx => {
    const rows = [];
    for (const kind of ["smallIdea", "deepIdea", "deepDraft"] as const) {
      const projectId = await ctx.db.insert("projects", { teamId: f.teamId, name: kind, ownerEmail: f.owner.email, accent: "#123456", status: "active", repoUrl: `https://github.com/fixture/${kind}`, githubWorkspaceAccess: true, createdAt: 1, updatedAt: 1 });
      const columns = [];
      for (let order = 0; order < (kind === "smallIdea" ? 2 : 105); order++) columns.push(await ctx.db.insert("columns", { projectId, title: order === 0 ? "Idea" : order === 104 && kind === "deepDraft" ? "Draft" : "Todo" + (order > 1 ? order : ""), order, createdAt: 1, updatedAt: 1 }));
      const taskId = await ctx.db.insert("tasks", { teamId: f.teamId, projectId, columnId: columns[0], title: `Existing ${kind} private`, priority: "medium", done: false, order: 0, assignedToEmail: f.owner.email, assignedToName: "Synthetic owner", dueDate: "2027-01-01", createdAt: 1, updatedAt: 1 });
      const linkedId = await ctx.db.insert("tasks", { teamId: f.teamId, projectId, columnId: columns[1], title: `Existing ${kind} linked`, priority: "low", done: true, order: 0, githubIssueNumber: 37, githubIssueUrl: `https://github.com/fixture/${kind}/issues/37`, githubIssueState: "closed", createdAt: 1, updatedAt: 1 });
      const pullLinkId = await ctx.db.insert("taskPullRequests", { repository: `fixture/${kind.toLowerCase()}`, projectId, taskId: linkedId, requesterUserId: f.owner.id, number: 43, url: `https://github.com/fixture/${kind}/pull/43`, branch: "fixture-existing", state: "merged", checks: "success", review: "approved", updatedAt: 1 });
      rows.push({ kind, projectId, ideaId: columns[0], todoId: columns[1], deepId: columns.at(-1), taskId, linkedId, pullLinkId });
    }
    for (let i = 0; i < 26; i++) await ctx.db.insert("projects", { teamId: f.teamId, name: `Empty legacy ${i}`, ownerEmail: f.owner.email, accent: "#123456", status: "active", createdAt: 1, updatedAt: 1 });
    return rows;
  });
  const snapshot = () => t.run(async ctx => ({ tasks: await Promise.all(legacy.flatMap(row => [ctx.db.get(row.taskId), ctx.db.get(row.linkedId)])), links: await Promise.all(legacy.map(row => ctx.db.get(row.pullLinkId))) }));
  const before = JSON.stringify(await snapshot());
  const checks = [];
  const inspect = async (stage: string) => {
    for (const row of legacy) {
      let draft: boolean | "held";
      try { draft = JSON.parse(await t.query(internal.integrations.context, { projectId: row.projectId, taskId: row.taskId })).task.draft; }
      catch (error) { expect(String(error)).toContain("Workflow repair required"); draft = "held"; }
      const targets = JSON.parse(await t.query(internal.integrations.unlinkedTasks, { cursor: null })).rows.map((item: any) => item.taskId);
      if (stage === "before") expect(draft).toBe(row.kind === "smallIdea" ? true : "held");
      if (stage === "columns" || stage === "legacyIdeas") expect(draft).toBe(row.kind === "smallIdea" ? true : row.kind === "deepDraft" ? false : "held");
      if (stage === "projects") expect(draft).toBe(row.kind !== "deepDraft");
      if (draft !== false) expect(targets).not.toContain(row.taskId);
      checks.push({ stage, kind: row.kind, contextDraft: draft, consideredForMirror: targets.includes(row.taskId) });
    }
  };
  await inspect("before");
  for (const [phase, reference, bound] of [["columns", internal.tasks.flagDraftColumns, 100], ["legacyIdeas", internal.tasks.selectLegacyDraftCandidates, 100], ["projects", internal.tasks.repairProjectDrafts, 25]] as const) {
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result = await t.mutation(reference, { cursor }); expect(result.phase).toBe(phase); expect(result.scanned).toBeLessThanOrEqual(bound);
      validateDraftReceipt(result, DRAFT_PHASES.find(definition => definition.phase === phase)!);
      migrations.push({ phase, page, receipt: { ...result, cursor: `[opaque synthetic cursor sha256:${hash(result.cursor)}]` }, inputWasNull: cursor === null });
      if (result.isDone) break;
      expect(result.cursor).not.toBe(cursor); cursor = result.cursor;
      if (page === 99) throw new Error("Synthetic migration exceeded finite limit");
    }
    await inspect(phase);
  }
  const after = JSON.stringify(await snapshot()); expect(after).toBe(before);
  expect(migrations.filter(page => page.phase === "columns").length).toBeGreaterThan(1);
  expect(migrations.filter(page => page.phase === "projects").length).toBeGreaterThan(1);
  cases.push({ name: "Legacy transition privacy and byte preservation", checks, existingTaskCount: 6, existingIssueLinks: 3, existingPullRequestLinks: 3, before: JSON.parse(before), after: JSON.parse(after), beforeSha256: hash(before), afterSha256: hash(after), tasksAndLinksByteEqual: before === after, passed: true });
});
test("older default-creation callers observe Draft after every ordered repair phase completes", async () => {
  for (const row of legacy) {
    const title = `Old default after repair ${row.kind}`;
    const board: any = await oldClient(base).query("tasks:board", { sessionToken: f.owner.token, projectId: row.projectId });
    expect(board.columns[0].isDraft).toBe(true);
    const result = await oldTool("origin_create_issue", { title, due_date: "2027-01-01" }, "compat-chief", deps(row.projectId));
    expect(result.isError).not.toBe(true);
    const stored = (await tasks(row.projectId)).find(task => task.title === title)!;
    expect(stored.columnId).toBe(board.columns[0]._id);
    expect((requestFor(title).args as any).columnId).toBe(board.columns[0]._id);
    expect(stored.done).toBe(false);
    cases.push({ name: title, caller: "actual0.2.10 runOriginTool+convexOriginClient", storedColumnId: stored.columnId, firstDraftId: board.columns[0]._id, passed: true });
  }
});
test("viewer and foreign workspace payloads reach actual registered guards and leave no task writes", async () => {
  const before = JSON.stringify(await tasks(f.projectId));
  const client = oldClient(base);
  const args = { projectId: f.projectId, columnId: f.columns[1]._id, title: "Denied request", priority: "medium", assignedToEmail: f.owner.email, dueDate: "2027-01-01" };
  expect(await client.query("tasks:board", { projectId: f.projectId, sessionToken: f.viewer.token })).toHaveProperty("columns");
  await expect(client.mutation("tasks:createTask", { ...args, sessionToken: f.viewer.token })).rejects.toThrow("Edit role required");
  await expect(client.mutation("tasks:createTask", { ...args, sessionToken: f.foreign.token })).rejects.toThrow("No active project access");
  const foreignBoard: any = await client.query("tasks:board", { sessionToken: f.foreign.token, projectId: f.foreignProjectId });
  await expect(client.mutation("tasks:createTask", { ...args, title: "Foreign column denied", columnId: foreignBoard.columns[0]._id, sessionToken: f.owner.token })).rejects.toThrow("Column not found");
  expect(JSON.stringify(await tasks(f.projectId))).toBe(before);
  const denied = requests.filter(request => request.path === "tasks:createTask" && request.outcome === "error");
  expect(denied).toHaveLength(3); expect(denied.every(request => request.registeredHandlerInvoked)).toBe(true);
  cases.push({ name: "Viewer, foreign workspace and foreign column denial", registeredGuardRequests: denied.length, beforeSha256: hash(before), afterSha256: hash(await tasks(f.projectId)), passed: true });
  expect(evidence.externalRequestsBlocked).toBe(0);
});
test("the actual candidate registered argument validator rejects an incompatible protocol payload", async () => {
  const before = JSON.stringify(await tasks(f.projectId));
  await expect(oldClient(base).mutation("tasks:createTask", { sessionToken: f.owner.token, projectId: f.projectId, title: "Validator sentinel", priority: "urgent", assignedToEmail: f.owner.email, dueDate: "2027-01-01" })).rejects.toThrow(/priority|literal|ArgumentValidation/);
  expect(JSON.stringify(await tasks(f.projectId))).toBe(before);
  const request = requestFor("Validator sentinel"); expect(request.registeredHandlerInvoked).toBe(true); expect(request.outcome).toBe("error");
  cases.push({ name: "Registered argument-validator negative control", invalidPriority: "urgent", storedTaskCountUnchanged: true, passed: true });
});
