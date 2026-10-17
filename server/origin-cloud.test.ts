import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import { cloudProjectFor, createOriginCloudRoutes, readOriginCloud, runOriginTool, writeOriginCloud, type OriginCloudClient } from "./origin-cloud.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";
import type { BotRecord } from "./store.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function tempFile() {
  const folder = mkdtempSync(join(tmpdir(), "omb-origin-cloud-"));
  folders.push(folder);
  return join(folder, "origin-cloud.json");
}

const BOTS = [
  { id: "chief", name: "Chief", section: "Apollo", chiefOfStaff: true },
  { id: "coder", name: "Coder", section: "Apollo" },
  { id: "designer", name: "Designer", section: " Apollo " },
  { id: "loner", name: "Loner", section: "Other" },
  { id: "managed", name: "Managed", section: "Side" },
  { id: "lead2", name: "Lead 2", section: "Hermes", chiefOfStaff: true, managedSections: ["Side"] },
] as unknown as BotRecord[];

type Call = { kind: "query" | "mutation"; name: string; args: Record<string, unknown> };

function fakeConvex(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = [];
  const answer = (kind: Call["kind"]) => async (name: string, args: Record<string, unknown>) => {
    calls.push({ kind, name, args });
    const value = answers[name];
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(args) : value ?? null;
  };
  const client: OriginCloudClient = { query: answer("query"), mutation: answer("mutation") };
  return { client, calls };
}

const BOARD = {
  columns: [
    { _id: "col1", title: "Idea" },
    { _id: "col2", title: "Todo" },
    { _id: "col3", title: "Done", isDone: true },
  ],
  tasks: [
    { _id: "t1", columnId: "col2", title: "Fix login", priority: "high", done: false, assignedToEmail: "a@x.dev", assignedToName: "Ana", labels: ["bug"] },
    { _id: "t2", columnId: "col3", title: "Ship v1", priority: "low", done: true },
  ],
};

describe("origin-cloud store", () => {
  it("round-trips the session and links, and reads a missing or corrupt file as empty", () => {
    const file = tempFile();
    expect(readOriginCloud(file)).toEqual({ projects: {} });
    writeOriginCloud(file, { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { coder: "p1" } });
    expect(readOriginCloud(file)).toEqual({ url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { coder: "p1" } });
    writeOriginCloud(file, { projects: { coder: "p1", bad: 3 as unknown as string } });
    expect(readOriginCloud(file)).toEqual({ projects: { coder: "p1" } });
    rmSync(file);
    expect(readOriginCloud(file)).toEqual({ projects: {} });
  });
});

describe("cloudProjectFor", () => {
  it("prefers the bot's own link, then its section's Chief, then a Chief managing its section", () => {
    expect(cloudProjectFor(BOTS, { chief: "apollo", coder: "own" }, "coder")).toBe("own");
    expect(cloudProjectFor(BOTS, { chief: "apollo" }, "coder")).toBe("apollo");
    expect(cloudProjectFor(BOTS, { chief: "apollo" }, "designer")).toBe("apollo");
    expect(cloudProjectFor(BOTS, { chief: "apollo" }, "chief")).toBe("apollo");
    expect(cloudProjectFor(BOTS, { chief: "apollo" }, "loner")).toBeNull();
    expect(cloudProjectFor(BOTS, { lead2: "hermes" }, "managed")).toBe("hermes");
    expect(cloudProjectFor(BOTS, { coder: "own" }, "chief")).toBeNull();
    expect(cloudProjectFor(BOTS, { chief: "apollo" }, "ghost")).toBeNull();
  });
});

describe("runOriginTool", () => {
  const state = { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "proj" } };

  it("explains a missing connection or project link", async () => {
    const { client } = fakeConvex({});
    const offline = await runOriginTool("origin_list_issues", {}, "coder", { bots: BOTS, state: { projects: { chief: "proj" } }, connect: () => client });
    expect(offline).toMatchObject({ isError: true, text: expect.stringContaining("Origin is not connected") });
    const unlinked = await runOriginTool("origin_list_issues", {}, "loner", { bots: BOTS, state, connect: () => client });
    expect(unlinked).toMatchObject({ isError: true, text: expect.stringContaining("no linked Origin project") });
  });

  it("lists open issues of the inherited project with the stored session", async () => {
    const { client, calls } = fakeConvex({ "tasks:board": BOARD });
    const result = await runOriginTool("origin_list_issues", {}, "coder", { bots: BOTS, state, connect: () => client });
    expect(calls).toEqual([{ kind: "query", name: "tasks:board", args: { projectId: "proj", sessionToken: "tok" } }]);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("t1 [Todo] Fix login · priority high · assignee Ana <a@x.dev> · labels bug");
    expect(result.text).not.toContain("Ship v1");
  });

  it("creates an issue in Todo assigned to the signed-in user, then sets labels", async () => {
    const { client, calls } = fakeConvex({ "tasks:board": BOARD, "auth:me": { email: "me@x.dev" }, "tasks:createTask": "t9" });
    const result = await runOriginTool("origin_create_issue", { title: "New", labels: ["ui"], due_date: "2026-11-01" }, "coder", { bots: BOTS, state, connect: () => client });
    expect(result.text).toBe('Created issue t9 "New" in column "Todo".');
    expect(calls.find((call) => call.name === "tasks:createTask")?.args).toEqual({
      projectId: "proj", sessionToken: "tok", columnId: "col2", title: "New", priority: "medium", assignedToEmail: "me@x.dev", dueDate: "2026-11-01",
    });
    expect(calls.at(-1)).toEqual({ kind: "mutation", name: "issueRelations:labels", args: { sessionToken: "tok", taskId: "t9", labels: ["ui"] } });
  });

  it("moving to a done column marks the issue done", async () => {
    const { client, calls } = fakeConvex({ "tasks:board": BOARD });
    const result = await runOriginTool("origin_update_issue", { issue_id: "t1", column: "done" }, "coder", { bots: BOTS, state, connect: () => client });
    expect(result.text).toBe('Updated issue t1: column "Done", done true.');
    expect(calls.filter((call) => call.kind === "mutation").map((call) => [call.name, call.args])).toEqual([
      ["tasks:moveTask", { projectId: "proj", sessionToken: "tok", taskId: "t1", columnId: "col3" }],
      ["tasks:updateTask", { projectId: "proj", sessionToken: "tok", taskId: "t1", done: true }],
    ]);
  });

  it("never shows vault ciphertext", async () => {
    const { client } = fakeConvex({ "credentials:list": [{ title: "Stripe", kind: "api_key", url: "https://stripe.com", username: "ops", ciphertext: "SECRET", iv: "IV", salt: "SALT", notes: "n" }] });
    const result = await runOriginTool("origin_vault_list", {}, "coder", { bots: BOTS, state, connect: () => client });
    expect(result.text).toContain("Stripe · api_key · username ops · https://stripe.com");
    expect(result.text).not.toMatch(/SECRET|SALT|IV\b/);
  });

  it("reports Convex errors and an expired sign-in", async () => {
    const { client } = fakeConvex({ "tasks:board": new Error("[CONVEX Q(tasks:board)] Server Error\nUncaught Error: Login required\n    at handler") });
    const result = await runOriginTool("origin_list_issues", {}, "coder", { bots: BOTS, state, connect: () => client });
    expect(result).toEqual({ isError: true, text: "Origin refused origin_list_issues: Login required. The Origin sign-in has expired; ask the person to sign in to Origin again." });
    const invalid = fakeConvex({ "tasks:details": new Error('Server Error\nArgumentValidationError: Value does not match validator.\nPath: .taskId\nValue: "nope"\nValidator: v.id("tasks").') });
    expect(await runOriginTool("origin_get_issue", { issue_id: "nope" }, "coder", { bots: BOTS, state, connect: () => invalid.client })).toEqual({
      isError: true, text: 'Origin refused origin_get_issue: taskId "nope" is not a valid id or value; copy ids exactly from the list tools.',
    });
  });
});

async function serve(options: { auth?: RequestAuth; agentBotId?: (header: string | string[] | undefined) => string | null; answers?: Record<string, unknown> } = {}) {
  const file = tempFile();
  const fake = fakeConvex(options.answers ?? { "auth:me": { email: "me@x.dev" }, "tasks:board": BOARD });
  const store = { bots: BOTS, bot: (id: string) => BOTS.find((bot) => bot.id === id) ?? null };
  const routes = [createOriginCloudRoutes({
    store: store as never,
    agentBotId: options.agentBotId ?? ((header) => (header === "Bearer cap-coder" ? "coder" : null)),
    file,
    connect: () => fake.client,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, {
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: options.auth ?? { kind: "loopback", scopes: ["admin", "client"] }, json, readBody,
    });
    if (!handled) json(res, 404, { from: "next" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return [response.status, await response.json()] as const;
  };
  return { call, file, fake };
}

describe("origin-cloud routes", () => {
  it("sets, reports and clears the session without ever returning the token", async () => {
    const { call, file } = await serve();
    expect(await call("GET", "/api/origin/cloud-session")).toEqual([200, { url: null, connected: false }]);
    expect(await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210/", sessionToken: "tok" })).toEqual([200, { url: "http://127.0.0.1:3210", connected: true }]);
    const [, status] = await call("GET", "/api/origin/cloud-session");
    expect(status).toEqual({ url: "http://127.0.0.1:3210", connected: true });
    expect(JSON.stringify(status)).not.toContain("tok");
    expect(readOriginCloud(file).sessionToken).toBe("tok");
    expect(await call("DELETE", "/api/origin/cloud-session")).toEqual([200, { url: null, connected: false }]);
    expect(readOriginCloud(file)).toEqual({ projects: {} });
  });

  it("refuses a bad address or a token Origin does not accept", async () => {
    const { call } = await serve({ answers: { "auth:me": null } });
    expect((await call("PUT", "/api/origin/cloud-session", { url: "ftp://x", sessionToken: "tok" }))[0]).toBe(400);
    expect(await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "bad" })).toEqual([400, { error: "Origin did not accept this session token" }]);
  });

  it("links and unlinks a bot's project and lists only existing bots", async () => {
    const { call } = await serve();
    expect(await call("PUT", "/api/bots/chief/cloud-project", { cloudProjectId: "proj123" })).toEqual([200, { cloudProjectId: "proj123" }]);
    expect(await call("PUT", "/api/bots/ghost/cloud-project", { cloudProjectId: "proj123" })).toEqual([404, { error: "No such bot" }]);
    expect((await call("PUT", "/api/bots/coder/cloud-project", { cloudProjectId: "../x" }))[0]).toBe(400);
    expect(await call("GET", "/api/origin/cloud-projects")).toEqual([200, { projects: { chief: "proj123" } }]);
    expect(await call("PUT", "/api/bots/chief/cloud-project", { cloudProjectId: null })).toEqual([200, { cloudProjectId: null }]);
    expect(await call("GET", "/api/origin/cloud-projects")).toEqual([200, { projects: {} }]);
  });

  it("needs the admin scope to change the connection or a link", async () => {
    const { call } = await serve({ auth: { kind: "loopback", scopes: ["client"] } });
    expect((await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "tok" }))[0]).toBe(403);
    expect((await call("DELETE", "/api/origin/cloud-session"))[0]).toBe(403);
    expect((await call("PUT", "/api/bots/chief/cloud-project", { cloudProjectId: "p" }))[0]).toBe(403);
    expect((await call("GET", "/api/origin/cloud-session"))[0]).toBe(200);
  });

  it("runs a tool only for an agents capability, as the bot it belongs to", async () => {
    const { call, file, fake } = await serve();
    writeOriginCloud(file, { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "proj" } });
    const tool = { name: "origin_list_issues", arguments: { status: "all" } };
    expect(await call("POST", "/api/internal/origin/tool", tool)).toEqual([401, { error: "unauthorized" }]);
    expect(await call("POST", "/api/internal/origin/tool", tool, { authorization: "Bearer forged" })).toEqual([401, { error: "unauthorized" }]);
    expect((await call("POST", "/api/internal/origin/tool", { name: "list_bots" }, { authorization: "Bearer cap-coder" }))[0]).toBe(400);
    const [status, body] = await call("POST", "/api/internal/origin/tool", tool, { authorization: "Bearer cap-coder" });
    expect(status).toBe(200);
    expect((body as { text: string }).text).toContain("2 all issue(s)");
    expect(fake.calls.at(-1)?.args).toEqual({ projectId: "proj", sessionToken: "tok" });
    expect(readFileSync(file, "utf8")).toContain("proj");
  });

  it("leaves other paths to the next handler", async () => {
    const { call } = await serve();
    expect(await call("GET", "/api/bots")).toEqual([404, { from: "next" }]);
  });
});
