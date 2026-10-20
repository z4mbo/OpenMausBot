import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "./harness/http.ts";
import {
  cloudProjectFor, createOriginCloudRoutes, reachableCloudProjects, readOriginCloud, runOriginTool, writeOriginCloud, type OriginAgentTurn, type OriginCloudClient,
  type OriginGitHub, type OriginToolDeps,
} from "./origin-cloud.ts";
import type { RequestAuth } from "./request-auth.ts";
import { dispatchRoutes } from "./routes/table.ts";
import type { BotRecord, Message } from "./store.ts";

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
  { id: "coder", name: "Coder", title: "Developer", section: "Apollo" },
  { id: "designer", name: "Designer", section: " Apollo " },
  { id: "loner", name: "Loner", section: "Other" },
  { id: "managed", name: "Managed", section: "Side" },
  { id: "lead2", name: "Lead 2", section: "Hermes", chiefOfStaff: true, managedSections: ["Side"] },
] as unknown as BotRecord[];

const WORKSPACE = [
  { id: "head", name: "Head", section: "Workspace: GGs", chiefOfStaff: true, managedSections: ["Kai", "Yuki", "Gone"] },
  { id: "kai-chief", name: "Kai", section: "Kai", chiefOfStaff: true },
  { id: "kai-dev", name: "Developer", title: "Developer", section: "Kai" },
  { id: "yuki-chief", name: "Yuki", section: "Yuki", chiefOfStaff: true },
  { id: "yuki-dev", name: "Developer", section: "Yuki" },
  { id: "gone-chief", name: "Gone", section: "Gone", chiefOfStaff: true, hidden: true },
  { id: "outsider", name: "Outsider", section: "Mars", chiefOfStaff: true },
] as unknown as BotRecord[];
const WORKSPACE_LINKS = { "kai-chief": "kai", "yuki-chief": "yuki", "gone-chief": "gone", outsider: "mars" };

type Call = { kind: "query" | "mutation" | "upload"; name: string; args: Record<string, unknown> };

function fakeConvex(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = [];
  const answer = (kind: "query" | "mutation") => async (name: string, args: Record<string, unknown>) => {
    calls.push({ kind, name, args });
    const value = answers[name];
    if (value instanceof Error) throw value;
    return typeof value === "function" ? value(args) : value ?? null;
  };
  const client: OriginCloudClient = {
    query: answer("query"),
    mutation: answer("mutation"),
    upload: async (uploadUrl, data, contentType) => {
      calls.push({ kind: "upload", name: uploadUrl, args: { bytes: data.byteLength, contentType } });
      return "storage1";
    },
  };
  return { client, calls };
}

const mutations = (calls: Call[]) => calls.filter((call) => call.kind === "mutation").map((call) => [call.name, call.args]);

const BOARD = {
  columns: [
    { _id: "col1", title: "Draft", isDraft: true },
    { _id: "col2", title: "Todo" },
    { _id: "col3", title: "Done", isDone: true },
  ],
  tasks: [
    { _id: "t1", columnId: "col2", title: "Fix login", priority: "high", done: false, assignedToEmail: "a@x.dev", assignedToName: "Ana", labels: ["bug"] },
    { _id: "t2", columnId: "col3", title: "Ship v1", priority: "low", done: true },
  ],
};

const KAI_BOARD = {
  columns: [{ _id: "k1", title: "Todo" }, { _id: "k2", title: "In progress" }, { _id: "k3", title: "Review" }, { _id: "k4", title: "Done", isDone: true }],
  tasks: [
    { _id: "kaitaskab12", columnId: "k1", title: "Set up CI", priority: "high", done: false, dueDate: "2026-11-02" },
    { _id: "kaitaskcd34", columnId: "k1", title: "Write notes", priority: "low", done: false },
  ],
};
const YUKI_BOARD = {
  columns: [{ _id: "y1", title: "Todo", isDone: false }, { _id: "y4", title: "Done", isDone: false }],
  tasks: [{ _id: "yukitaskef56", columnId: "y1", title: "Ship mobile", priority: "high", done: false }],
};

/** A fake deployment with two projects; queries answer from the project they name. */
function workspaceConvex(extra: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {}) {
  const boards: Record<string, typeof KAI_BOARD> = { kai: KAI_BOARD, yuki: YUKI_BOARD };
  return fakeConvex({
    "projects:get": (args: Record<string, unknown>) => ({ _id: args.projectId, name: args.projectId === "kai" ? "Kai" : args.projectId === "yuki" ? "Yuki" : "Mars" }),
    "tasks:board": (args: Record<string, unknown>) => boards[String(args.projectId)] ?? { columns: [], tasks: [] },
    "tasks:details": (args: Record<string, unknown>) => {
      const found = boards[String(args.projectId)]?.tasks.find((task) => task._id === args.taskId);
      if (!found) throw new Error("Uncaught Error: Task not found");
      return { task: found, columns: boards[String(args.projectId)]!.columns, comments: [], assets: [] };
    },
    "issueRelations:list": { labels: ["ci"], relations: [] },
    ...extra,
  });
}

const workspaceDeps = (client: OriginCloudClient, more: Partial<OriginToolDeps> = {}): OriginToolDeps => ({
  bots: WORKSPACE, state: { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: WORKSPACE_LINKS }, connect: () => client, ...more,
});

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

describe("reachableCloudProjects", () => {
  it("gives a workspace head its managed projects, a project only its own, and nobody a hidden or unmanaged one", () => {
    expect(reachableCloudProjects(WORKSPACE, WORKSPACE_LINKS, "head")).toEqual([
      { projectId: "kai", section: "Kai", own: false },
      { projectId: "yuki", section: "Yuki", own: false },
    ]);
    expect(reachableCloudProjects(WORKSPACE, WORKSPACE_LINKS, "kai-chief")).toEqual([{ projectId: "kai", section: "Kai", own: true }]);
    expect(reachableCloudProjects(WORKSPACE, WORKSPACE_LINKS, "kai-dev")).toEqual([{ projectId: "kai", section: "Kai", own: true }]);
    expect(reachableCloudProjects(WORKSPACE, WORKSPACE_LINKS, "gone-chief")).toEqual([]);
    expect(reachableCloudProjects(WORKSPACE, WORKSPACE_LINKS, "ghost")).toEqual([]);
  });
});

describe("runOriginTool", () => {
  const state = { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "proj" } };

  it("explains a missing connection or project link", async () => {
    const { client } = fakeConvex({});
    const offline = await runOriginTool("origin_list_issues", {}, "coder", { bots: BOTS, state: { projects: { chief: "proj" } }, connect: () => client });
    expect(offline).toMatchObject({ isError: true, text: expect.stringContaining("Origin account is not connected") });
    const unlinked = await runOriginTool("origin_list_issues", {}, "loner", { bots: BOTS, state, connect: () => client });
    expect(unlinked).toMatchObject({ isError: true, text: expect.stringContaining("no linked Origin project") });
  });

  it("lists open issues of the inherited project with the stored session, as text and cards", async () => {
    const { client, calls } = fakeConvex({ "tasks:board": BOARD, "projects:get": { name: "Apollo app" } });
    const result = await runOriginTool("origin_list_issues", {}, "coder", { bots: BOTS, state, connect: () => client });
    expect(calls.map((call) => call.name).sort()).toEqual(["projects:get", "tasks:board"]);
    expect(calls.every((call) => call.args.projectId === "proj" && call.args.sessionToken === "tok")).toBe(true);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Origin project Apollo app (proj): 1 open issue(s).");
    expect(result.text).toContain("t1 (ORI-T1) [Todo] Fix login · priority high · assignee Ana <a@x.dev> · labels bug");
    expect(result.text).not.toContain("Ship v1");
    expect(result.cards).toEqual({
      heading: "1 open issue · Apollo app",
      issues: [{ id: "t1", key: "ORI-T1", projectId: "proj", projectName: "Apollo app", title: "Fix login", status: "Todo", done: false, priority: "high", assignee: "Ana", labels: ["bug"] }],
    });
  });

  it("filters by priority and text, and refuses an unknown priority", async () => {
    const { client } = workspaceConvex();
    const urgent = await runOriginTool("origin_list_issues", { priority: "high", project: "Kai" }, "head", workspaceDeps(client));
    expect(urgent.cards?.issues.map((issue) => issue.title)).toEqual(["Set up CI"]);
    expect(urgent.cards?.heading).toBe("1 open high-priority issue · Kai");
    const matched = await runOriginTool("origin_list_issues", { query: "notes" }, "kai-dev", workspaceDeps(client));
    expect(matched.cards?.issues.map((issue) => issue.key)).toEqual(["ORI-CD34"]);
    expect(await runOriginTool("origin_list_issues", { priority: "urgent" }, "kai-dev", workspaceDeps(client))).toMatchObject({ isError: true });
  });

  it("lets a workspace head list every project it manages, or one by name, id or team, and nothing else", async () => {
    const { client } = workspaceConvex();
    const all = await runOriginTool("origin_list_issues", {}, "head", workspaceDeps(client));
    expect(all.text).toContain("Origin project Kai (kai): 2 open issue(s).");
    expect(all.text).toContain("Origin project Yuki (yuki): 1 open issue(s).");
    expect(all.cards?.heading).toBe("3 open issues · 2 projects");
    expect(all.cards?.issues.map((issue) => [issue.projectName, issue.title])).toEqual([["Kai", "Set up CI"], ["Kai", "Write notes"], ["Yuki", "Ship mobile"]]);
    for (const project of ["Yuki", "yuki", "YUKI"]) {
      const one = await runOriginTool("origin_list_issues", { project }, "head", workspaceDeps(client));
      expect(one.cards?.issues.map((issue) => issue.title), project).toEqual(["Ship mobile"]);
    }
    const outside = await runOriginTool("origin_list_issues", { project: "mars" }, "head", workspaceDeps(client));
    expect(outside).toMatchObject({ isError: true, text: expect.stringContaining('No Origin project "mars" among the ones you reach: "Kai" (kai), "Yuki" (yuki).') });
    const sideways = await runOriginTool("origin_list_issues", { project: "yuki" }, "kai-dev", workspaceDeps(client));
    expect(sideways).toMatchObject({ isError: true });
  });

  it("finds an issue by its ORI- key across the reachable projects", async () => {
    const { client } = workspaceConvex();
    const result = await runOriginTool("origin_get_issue", { issue_id: "ori-ef56" }, "head", workspaceDeps(client));
    expect(result.text).toContain("yukitaskef56 (ORI-EF56) [Todo] Ship mobile");
    expect(result.text).toContain("Origin project Yuki (yuki).");
    expect(result.cards).toMatchObject({ heading: "Issue ORI-EF56", issues: [{ id: "yukitaskef56", projectId: "yuki", labels: ["ci"] }] });
    const missing = await runOriginTool("origin_get_issue", { issue_id: "ORI-ZZZZ" }, "head", workspaceDeps(client));
    expect(missing).toMatchObject({ isError: true, text: expect.stringContaining("No issue ORI-ZZZZ") });
  });

  it("refuses to touch the labels of an issue outside the bot's project", async () => {
    const { client, calls } = workspaceConvex();
    const result = await runOriginTool("origin_update_issue", { issue_id: "yukitaskef56", labels: ["mine"] }, "kai-dev", workspaceDeps(client));
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("Task not found") });
    expect(mutations(calls)).toEqual([]);
  });

  it("finds a raw issue id in whichever reachable project holds it", async () => {
    const { client } = workspaceConvex();
    const result = await runOriginTool("origin_comment_issue", { issue_id: "yukitaskef56", text: "On it" }, "head", workspaceDeps(client));
    expect(result.text).toBe("Commented on issue yukitaskef56.");
  });

  it("creates an issue in Draft assigned to the signed-in user, then sets labels", async () => {
    const { client, calls } = fakeConvex({ "tasks:board": BOARD, "auth:me": { email: "me@x.dev" }, "tasks:createTask": "t9" });
    const result = await runOriginTool("origin_create_issue", { title: "New", labels: ["ui"], due_date: "2026-11-01" }, "coder", { bots: BOTS, state, connect: () => client });
    expect(result.text).toBe('Created issue t9 (ORI-T9) "New" in column "Draft" of proj. It stays in Origin as a draft; moving it to another column creates its GitHub issue.');
    expect(mutations(calls)).toEqual([
      ["tasks:createTask", { projectId: "proj", sessionToken: "tok", title: "New", priority: "medium", assignedToEmail: "me@x.dev", dueDate: "2026-11-01" }],
      ["issueRelations:labels", { sessionToken: "tok", taskId: "t9", labels: ["ui"] }],
    ]);
    expect(result.cards).toEqual({
      heading: "Issue created",
      issues: [{ id: "t9", key: "ORI-T9", projectId: "proj", projectName: "proj", title: "New", status: "Draft", done: false, priority: "medium", assignee: "me@x.dev", due: "2026-11-01", labels: ["ui"] }],
    });
  });

  it("moving to a done column marks the issue done", async () => {
    const { client, calls } = fakeConvex({ "tasks:board": BOARD });
    const result = await runOriginTool("origin_update_issue", { issue_id: "t1", column: "done" }, "coder", { bots: BOTS, state, connect: () => client });
    expect(result.text).toBe('Updated issue t1: column "Done", done true.');
    expect(mutations(calls)).toEqual([
      ["tasks:moveTask", { projectId: "proj", sessionToken: "tok", taskId: "t1", columnId: "col3" }],
      ["tasks:updateTask", { projectId: "proj", sessionToken: "tok", taskId: "t1", done: true }],
    ]);
    expect(result.cards?.heading).toBe("Issue updated");
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

  it.each([
    'Server Error\nArgumentValidationError: Value does not match validator.\nPath: .sessionToken\nValue: "private-origin-session"\nValidator: v.string().',
    'Uncaught Error: Invalid Origin session private-origin-session',
    'Request failed with arguments {"sessionToken":"private-origin-session"}',
  ])("keeps the Origin session out of tool errors: %s", async (message) => {
    const { client } = fakeConvex({ "tasks:board": new Error(message) });
    const result = await runOriginTool("origin_list_issues", {}, "coder", {
      bots: BOTS, state: { ...state, sessionToken: "private-origin-session" }, connect: () => client,
    });
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain("private-origin-session");
  });

  it("lists the reachable projects with their Chief and agents", async () => {
    const { client } = workspaceConvex();
    const result = await runOriginTool("origin_list_projects", {}, "head", workspaceDeps(client));
    expect(result.text).toContain("- Kai (project kai)");
    expect(result.text).toContain("Chief: Kai [id: kai-chief]");
    expect(result.text).toContain("Agents: Developer (Developer) [id: kai-dev]");
    expect(result.text).not.toContain("Mars");
  });
});

describe("origin_assign_issue", () => {
  it("prepares a handoff for an agent of the issue's project without writing anything", async () => {
    const { client, calls } = workspaceConvex();
    const result = await runOriginTool("origin_assign_issue", { issue_id: "kaitaskab12", bot_id: "kai-dev", instructions: "Use GitHub Actions." }, "kai-chief", workspaceDeps(client));
    expect(result.isError).toBeUndefined();
    expect(result.handoff).toMatchObject({ botId: "kai-dev", botName: "Developer", reason: "Origin issue ORI-AB12: Set up CI" });
    expect(result.handoff?.message).toContain('You\'re assigned issue ORI-AB12: "Set up CI" (Origin project Kai, issue id kaitaskab12).');
    expect(result.handoff?.message).toContain("origin_complete_issue");
    expect(result.handoff?.message).toContain("From Kai: Use GitHub Actions.");
    expect(mutations(calls)).toEqual([]);
  });

  it("records the assignment: agent label, a comment, and In progress", async () => {
    const { client, calls } = workspaceConvex();
    const result = await runOriginTool("origin_assign_issue", { issue_id: "ORI-AB12", bot_id: "Developer" }, "kai-chief", workspaceDeps(client), "record");
    expect(result.text).toBe("Labelled ORI-AB12 agent:developer and commented the assignment.");
    expect(mutations(calls)).toEqual([
      ["issueRelations:labels", { sessionToken: "tok", taskId: "kaitaskab12", labels: ["ci", "agent:developer"] }],
      ["tasks:addComment", { projectId: "kai", sessionToken: "tok", taskId: "kaitaskab12", body: "Assigned to the agent Developer (Developer) by Kai in Origin." }],
      ["tasks:moveTask", { projectId: "kai", sessionToken: "tok", taskId: "kaitaskab12", columnId: "k2" }],
    ]);
    expect(result.cards?.heading).toBe("Assigned to Developer");
  });

  it("lets a workspace head hand an issue to a project's Chief, and refuses crossing projects or non-Chiefs", async () => {
    const { client } = workspaceConvex();
    const down = await runOriginTool("origin_assign_issue", { issue_id: "yukitaskef56", bot_id: "yuki-chief" }, "head", workspaceDeps(client));
    expect(down.handoff?.botId).toBe("yuki-chief");
    const crossed = await runOriginTool("origin_assign_issue", { issue_id: "yukitaskef56", bot_id: "kai-dev" }, "head", workspaceDeps(client));
    expect(crossed).toMatchObject({ isError: true, text: expect.stringContaining("does not work on this Origin project") });
    const ambiguous = await runOriginTool("origin_assign_issue", { issue_id: "yukitaskef56", bot_id: "Developer" }, "head", workspaceDeps(client));
    expect(ambiguous).toMatchObject({ isError: true, text: expect.stringContaining("Several agents are called Developer") });
    const agent = await runOriginTool("origin_assign_issue", { issue_id: "kaitaskab12", bot_id: "kai-chief" }, "kai-dev", workspaceDeps(client));
    expect(agent).toMatchObject({ isError: true, text: expect.stringContaining("Only a Chief") });
    const outsider = await runOriginTool("origin_assign_issue", { issue_id: "kaitaskab12", bot_id: "outsider" }, "kai-chief", workspaceDeps(client));
    expect(outsider).toMatchObject({ isError: true });
  });
});

describe("origin_complete_issue", () => {
  it("comments the summary and pull request, moves the issue to review and asks the project's Chief to review it", async () => {
    const { client, calls } = workspaceConvex();
    const result = await runOriginTool("origin_complete_issue", {
      issue_id: "kaitaskab12", summary: "CI runs on every push.", pull_request_url: "https://github.com/ggs/kai/pull/7",
    }, "kai-dev", workspaceDeps(client));
    expect(result.text).toBe('Commented on ORI-AB12 and moved to "Review". Kai is asked to review and merge it. Do not mark it done yourself.');
    expect(mutations(calls)).toEqual([
      ["tasks:addComment", { projectId: "kai", sessionToken: "tok", taskId: "kaitaskab12", body: "CI runs on every push.\n\nPull request: https://github.com/ggs/kai/pull/7" }],
      ["tasks:moveTask", { projectId: "kai", sessionToken: "tok", taskId: "kaitaskab12", columnId: "k3" }],
    ]);
    expect(result.cards?.heading).toBe("Issue in review");
    expect(result.reviewer).toMatchObject({ botId: "kai-chief", botName: "Kai" });
    expect(result.reviewer?.message).toContain("origin_review_pr");
  });

  it("never marks an issue done, and refuses a bad link", async () => {
    const { client, calls } = workspaceConvex();
    const result = await runOriginTool("origin_complete_issue", { issue_id: "yukitaskef56", summary: "Shipped.", stage: "done" }, "yuki-dev", workspaceDeps(client));
    expect(result.isError).toBeUndefined();
    expect(mutations(calls).some(([name, args]) => name === "tasks:updateTask" || (name === "tasks:moveTask" && (args as { columnId: string }).columnId === "y4"))).toBe(false);
    expect(await runOriginTool("origin_complete_issue", { issue_id: "yukitaskef56", summary: "x", pull_request_url: "javascript:alert(1)" }, "yuki-dev", workspaceDeps(client)))
      .toMatchObject({ isError: true });
  });

  it("in a project with a repository, needs a pull request there and links it to the issue's GitHub issue", async () => {
    const { client, calls } = workspaceConvex({ "projects:get": (args: Record<string, unknown>) => ({ _id: args.projectId, name: "Kai", repoUrl: "https://github.com/ggs/kai" }) });
    const github = fakeGitHub();
    const missing = await runOriginTool("origin_complete_issue", { issue_id: "kaitaskab12", summary: "Done." }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toContain("pull_request_url");
    const foreign = await runOriginTool("origin_complete_issue", { issue_id: "kaitaskab12", summary: "Done.", pull_request_url: "https://github.com/evil/kai/pull/7" }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(foreign).toMatchObject({ isError: true });
    expect(mutations(calls)).toEqual([]);
    const result = await runOriginTool("origin_complete_issue", { issue_id: "kaitaskab12", summary: "Done.", pull_request_url: "https://github.com/ggs/kai/pull/7" }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(github.calls).toEqual([["mirrorIssue", "kai", "kaitaskab12"], ["linkPullRequest", "kai", 7, 12]]);
    expect(result.text).toContain('added "Closes #12" to #7');
    expect(result.reviewer?.message).toContain("checks success");
  });
});

function fakeGitHub(overrides: Partial<OriginGitHub> = {}) {
  const calls: unknown[][] = [];
  const pull = { number: 7, title: "CI", url: "https://github.com/ggs/kai/pull/7", author: "dev", branch: "ci", state: "open" as const, closes: [12], updatedAt: 1, checks: "success", review: "review_required" as const };
  const api: OriginGitHub = {
    mirrorIssue: async (projectId, taskId) => { calls.push(["mirrorIssue", projectId, taskId]); return { taskId, issueNumber: 12 }; },
    linkPullRequest: async (projectId, number, issueNumber) => { calls.push(["linkPullRequest", projectId, number, issueNumber]); return { added: true, pull }; },
    pullRequests: async (projectId) => { calls.push(["pullRequests", projectId]); return [pull, { ...pull, number: 3, state: "merged" }]; },
    pullRequest: async (projectId, number) => {
      calls.push(["pullRequest", projectId, number]);
      return { ...pull, baseBranch: "main", defaultBranch: "main", headSha: "a".repeat(40), mergeable: true, additions: 4, deletions: 1, files: [{ name: "ci.yml", status: "added", additions: 4, deletions: 1 }], checkRuns: [{ name: "test", status: "completed", conclusion: "success" }] };
    },
    approve: async (projectId, number, body) => { calls.push(["approve", projectId, number, body]); return { approved: true }; },
    merge: async (projectId, number, headSha) => { calls.push(["merge", projectId, number, headSha]); return { sha: "c".repeat(40) }; },
    ...overrides,
  };
  return { api, calls };
}

describe("GitHub-first issues", () => {
  const repoProject = (memberRole = "admin") => ({ "projects:get": (args: Record<string, unknown>) => ({ _id: args.projectId, name: "Kai", repoUrl: "https://github.com/ggs/kai", memberRole }) });

  it("mirrors an explicitly requested Todo issue to GitHub, and refuses to mark one done or drop it in the done column", async () => {
    const { client, calls } = workspaceConvex({ ...repoProject(), "auth:me": { email: "me@x.dev" }, "tasks:createTask": "kainew" });
    const github = fakeGitHub();
    const created = await runOriginTool("origin_create_issue", { title: "New", column: "Todo" }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(created.text).toContain("Mirrored as GitHub issue #12.");
    for (const change of [{ done: true }, { column: "Done" }]) {
      const refused = await runOriginTool("origin_update_issue", { issue_id: "kaitaskab12", ...change }, "kai-dev", workspaceDeps(client, { github: github.api }));
      expect(refused).toMatchObject({ isError: true });
      expect(refused.text).toContain("origin_complete_issue");
    }
    expect(mutations(calls).map(([name]) => name)).toEqual(["tasks:createTask"]);
  });

  it("keeps a new issue in Draft off GitHub, and mirrors it once it moves to another column", async () => {
    const board = { ...KAI_BOARD, columns: [{ _id: "k0", title: "Draft", isDraft: true }, ...KAI_BOARD.columns], tasks: [{ ...KAI_BOARD.tasks[0], columnId: "k0" }] };
    const { client, calls } = workspaceConvex({ ...repoProject(), "auth:me": { email: "me@x.dev" }, "tasks:createTask": "kainew", "tasks:board": board });
    const github = fakeGitHub();
    const created = await runOriginTool("origin_create_issue", { title: "New" }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(created.text).toContain('in column "Draft"');
    expect(mutations(calls)[0]).toEqual(["tasks:createTask", expect.not.objectContaining({ columnId: expect.anything() })]);
    expect(github.calls).toEqual([]);
    const moved = await runOriginTool("origin_update_issue", { issue_id: "kaitaskab12", column: "Todo" }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(moved.text).toContain("mirrored as GitHub issue #12");
    expect(github.calls).toEqual([["mirrorIssue", "kai", "kaitaskab12"]]);
  });

  it("repairs a legacy board before default creation and keeps its new issue off GitHub", async () => {
    let repaired = false;
    const draft = { _id: "private", title: "Private planning", isDraft: true };
    const { client, calls } = workspaceConvex({
      ...repoProject(), "auth:me": { email: "me@x.dev" }, "tasks:createTask": "kainew",
      "tasks:board": () => ({ ...KAI_BOARD, columns: repaired ? [...KAI_BOARD.columns, draft] : KAI_BOARD.columns }),
      "tasks:ensureDefaultColumns": () => { repaired = true; return null; },
    });
    const github = fakeGitHub();
    const result = await runOriginTool("origin_create_issue", { title: "Private idea" }, "kai-dev", workspaceDeps(client, { github: github.api }));
    expect(result.isError).not.toBe(true);
    expect(result.text).toContain('in column "Private planning"');
    expect(result.cards?.issues[0].status).toBe("Private planning");
    expect(mutations(calls)).toEqual([
      ["tasks:ensureDefaultColumns", { projectId: "kai", sessionToken: "tok" }],
      ["tasks:createTask", expect.not.objectContaining({ columnId: expect.anything() })],
    ]);
    expect(github.calls).toEqual([]);
  });

  it("does not infer another destination if Draft repair fails or an explicit column is unknown", async () => {
    const { client, calls } = workspaceConvex({ ...repoProject(), "tasks:ensureDefaultColumns": new Error("Draft repair failed") });
    const github = fakeGitHub();
    const deps = workspaceDeps(client, { github: github.api });
    expect(await runOriginTool("origin_create_issue", { title: "Private idea" }, "kai-dev", deps)).toMatchObject({ isError: true });
    expect(mutations(calls).map(([name]) => name)).toEqual(["tasks:ensureDefaultColumns"]);
    calls.length = 0;
    expect(await runOriginTool("origin_create_issue", { title: "Private idea", column: "foreign" }, "kai-dev", deps)).toMatchObject({ isError: true });
    expect(mutations(calls)).toEqual([]);
    expect(github.calls).toEqual([]);
  });

  it("origin_review_pr is the Chief's: lists open pull requests with the issues they close, reads one, approves and merges it", async () => {
    const { client } = workspaceConvex({ ...repoProject(), "tasks:board": () => ({ ...KAI_BOARD, tasks: KAI_BOARD.tasks.map((task, index) => (index === 0 ? { ...task, githubIssueNumber: 12 } : task)) }) });
    const github = fakeGitHub();
    expect(await runOriginTool("origin_review_pr", {}, "kai-dev", workspaceDeps(client, { github: github.api }))).toMatchObject({ isError: true });
    const listed = await runOriginTool("origin_review_pr", {}, "kai-chief", workspaceDeps(client, { github: github.api }));
    expect(listed.text).toContain("#7 open \"CI\"");
    expect(listed.text).toContain("closes #12 (ORI-AB12)");
    expect(listed.text).not.toContain("#3 merged");
    const read = await runOriginTool("origin_review_pr", { action: "read", number: 7 }, "kai-chief", workspaceDeps(client, { github: github.api }));
    expect(read.text).toContain(`Ready to merge: pass head_sha ${"a".repeat(40)}`);
    expect(read.pullRequest).toMatchObject({ projectId: "kai", number: 7, title: "CI", headSha: "a".repeat(40), closes: ["ORI-AB12"] });
    expect(read.pullRequest?.blocker).toBeUndefined();
    expect(listed.pullRequest).toBeUndefined();
    expect((await runOriginTool("origin_review_pr", { action: "approve", number: 7, comment: "Good." }, "kai-chief", workspaceDeps(client, { github: github.api }))).text).toBe("Approved #7 with your comment.");
    const merged = await runOriginTool("origin_merge_pr", { number: 7, head_sha: "a".repeat(40) }, "kai-chief", workspaceDeps(client, { github: github.api }));
    expect(merged.text).toContain("Merged #7 into the default branch (ccccccc). GitHub closes ORI-AB12");
    expect(github.calls).toContainEqual(["merge", "kai", 7, "a".repeat(40)]);
    const synced = fakeGitHub({ merge: async () => ({ sha: "c".repeat(40), completed: [12] }) });
    const completed = await runOriginTool("origin_merge_pr", { number: 7, head_sha: "a".repeat(40) }, "kai-chief", workspaceDeps(client, { github: synced.api }));
    expect(completed.text).toContain("ORI-AB12 is now done in Origin and closed on GitHub.");
    expect(completed.text).not.toContain("next sync");
  });

  it("merging needs a project admin's sign-in", async () => {
    const { client } = workspaceConvex(repoProject("member"));
    const github = fakeGitHub();
    const refused = await runOriginTool("origin_merge_pr", { number: 7, head_sha: "a".repeat(40) }, "kai-chief", workspaceDeps(client, { github: github.api }));
    expect(refused).toMatchObject({ isError: true });
    expect(github.calls.some(([name]) => name === "merge")).toBe(false);
  });
});

describe("origin_add_asset", () => {
  it("adds a link, or uploads a file the turn may share", async () => {
    const { client, calls } = workspaceConvex({ "design:generateUploadUrl": "http://127.0.0.1:3210/api/storage/upload?token=x" });
    const link = await runOriginTool("origin_add_asset", { name: "Mockups", type: "figma", url: "https://figma.com/file/1" }, "kai-dev", workspaceDeps(client));
    expect(link.text).toBe('Added the link "Mockups" to Kai\'s assets.');
    const read: string[] = [];
    const file = async (path: string) => {
      read.push(path);
      return { data: new Uint8Array([1, 2, 3]), name: "logo.png", contentType: "image/png" };
    };
    const uploaded = await runOriginTool("origin_add_asset", { name: "Logo", type: "image", path: "out/logo.png" }, "kai-dev", workspaceDeps(client, { file }));
    expect(uploaded.text).toBe('Uploaded logo.png (3 bytes) as "Logo" to Kai\'s assets.');
    expect(read).toEqual(["out/logo.png"]);
    expect(calls.filter((call) => call.kind !== "query").map((call) => [call.name, call.args])).toEqual([
      ["design:createAsset", { projectId: "kai", sessionToken: "tok", type: "figma", name: "Mockups", url: "https://figma.com/file/1" }],
      ["design:generateUploadUrl", { projectId: "kai", sessionToken: "tok" }],
      ["http://127.0.0.1:3210/api/storage/upload?token=x", { bytes: 3, contentType: "image/png" }],
      ["design:createAsset", { projectId: "kai", sessionToken: "tok", type: "image", name: "Logo", storageId: "storage1", contentType: "image/png", size: 3 }],
    ]);
  });

  it("refuses both or neither source, and explains an unreadable file", async () => {
    const { client } = workspaceConvex();
    expect(await runOriginTool("origin_add_asset", { name: "x" }, "kai-dev", workspaceDeps(client))).toMatchObject({ isError: true });
    expect(await runOriginTool("origin_add_asset", { name: "x", url: "https://a.b", path: "a" }, "kai-dev", workspaceDeps(client))).toMatchObject({ isError: true });
    expect(await runOriginTool("origin_add_asset", { name: "x", path: "a" }, "kai-dev", workspaceDeps(client))).toMatchObject({ isError: true, text: expect.stringContaining("pass url instead") });
    const file = async () => { throw new Error("the linked file is outside the workspace"); };
    expect(await runOriginTool("origin_add_asset", { name: "x", path: "/etc/passwd" }, "kai-dev", workspaceDeps(client, { file }))).toEqual({
      isError: true, text: "Could not read /etc/passwd: the linked file is outside the workspace.",
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => { resolve = ready; });
  return { promise, resolve };
}

async function serve(options: { auth?: RequestAuth; agentTurn?: (header: string | string[] | undefined) => OriginAgentTurn | null; answers?: Record<string, unknown>; rooms?: string[]; connect?: (url: string) => OriginCloudClient } = {}) {
  const file = tempFile();
  const fake = fakeConvex(options.answers ?? { "auth:me": { email: "me@x.dev" }, "tasks:board": BOARD });
  const appended: Array<{ threadId: string; message: Omit<Message, "id" | "at"> }> = [];
  const store = {
    bots: BOTS,
    bot: (id: string) => BOTS.find((bot) => bot.id === id) ?? null,
    appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => { appended.push({ threadId, message }); },
    groupByThread: (threadId: string) => (options.rooms?.includes(threadId) ? { id: "room" } : undefined),
  };
  const routes = [createOriginCloudRoutes({
    store: store as never,
    agentTurn: options.agentTurn ?? ((header) => (header === "Bearer cap-coder" ? { botId: "coder", threadId: "coder-thread" } : header === "Bearer cap-room" ? { botId: "coder", threadId: "room-thread" } : null)),
    file,
    connect: options.connect ?? (() => fake.client),
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
  return { call, file, fake, appended };
}

describe("origin-cloud routes", () => {
  it("sets, reports and clears the session without ever returning the token", async () => {
    let signedOut = false;
    const { call, file } = await serve({ answers: { "auth:me": () => (signedOut ? null : { email: "me@x.dev" }) } });
    expect(await call("GET", "/api/origin/cloud-session")).toEqual([200, { url: null, connected: false }]);
    expect(await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210/", sessionToken: "tok" })).toEqual([200, { url: "http://127.0.0.1:3210", connected: true }]);
    const [, status] = await call("GET", "/api/origin/cloud-session");
    expect(status).toEqual({ url: "http://127.0.0.1:3210", connected: true });
    expect(JSON.stringify(status)).not.toContain("tok");
    expect(readOriginCloud(file).sessionToken).toBe("tok");
    expect((await call("DELETE", "/api/origin/cloud-session"))[0]).toBe(409);
    signedOut = true;
    expect(await call("DELETE", "/api/origin/cloud-session")).toEqual([200, { url: null, connected: false }]);
    expect(readOriginCloud(file)).toEqual({ projects: {} });
  });

  it("keeps a project link saved while Origin was checking the session", async () => {
    let saved = "";
    const { call, file } = await serve({
      answers: {
        "auth:me": () => {
          writeOriginCloud(saved, { ...readOriginCloud(saved), projects: { chief: "late" } });
          return { email: "me@x.dev" };
        },
      },
    });
    saved = file;
    expect((await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "tok" }))[0]).toBe(200);
    expect(readOriginCloud(file)).toEqual({ url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "late" } });
  });

  it("never hands the bots to another person's signed-in Origin account", async () => {
    const { call, file } = await serve({ answers: { "auth:me": (args: Record<string, unknown>) => ({ email: args.sessionToken === "ana" ? "Ana@x.dev" : "bo@x.dev" }) } });
    expect((await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "ana" }))[0]).toBe(200);
    expect(await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "bo" })).toEqual([409, { error: "This app is connected to another Origin account" }]);
    expect((await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "ana" }))[0]).toBe(200);
    expect(readOriginCloud(file).sessionToken).toBe("ana");
  });

  it("keeps a replacement session when an older disconnect finishes checking its expired owner", async () => {
    const checking = deferred<void>();
    const expiredOwner = deferred<null>();
    let expiredChecks = 0;
    const { call, file } = await serve({ answers: {
      "auth:me": (args: Record<string, unknown>) => {
        if (args.sessionToken !== "expired-a") return { email: "bo@x.dev" };
        if (++expiredChecks !== 1) return null;
        checking.resolve();
        return expiredOwner.promise;
      },
    } });
    const url = "http://127.0.0.1:3210";
    writeOriginCloud(file, { url, sessionToken: "expired-a", projects: { chief: "proj" } });
    const disconnect = call("DELETE", "/api/origin/cloud-session");
    await checking.promise;
    try {
      expect((await call("PUT", "/api/origin/cloud-session", { url, sessionToken: "replacement-b" }))[0]).toBe(200);
    } finally {
      expiredOwner.resolve(null);
    }
    const result = await disconnect;
    expect(readOriginCloud(file)).toEqual({ url, sessionToken: "replacement-b", projects: { chief: "proj" } });
    expect(result[0]).toBe(409);
  });

  it("keeps the newer account when an older connection finishes checking a superseded owner", async () => {
    const checking = deferred<void>();
    const expiredOwner = deferred<null>();
    let expiredChecks = 0;
    const { call, file } = await serve({ answers: {
      "auth:me": (args: Record<string, unknown>) => {
        if (args.sessionToken !== "expired-a") return { email: args.sessionToken === "replacement-b" ? "bo@x.dev" : "ana@x.dev" };
        if (++expiredChecks !== 1) return null;
        checking.resolve();
        return expiredOwner.promise;
      },
    } });
    const url = "http://127.0.0.1:3210";
    writeOriginCloud(file, { url, sessionToken: "expired-a", projects: { chief: "proj" } });
    const olderConnect = call("PUT", "/api/origin/cloud-session", { url, sessionToken: "older-c" });
    await checking.promise;
    try {
      expect((await call("PUT", "/api/origin/cloud-session", { url, sessionToken: "replacement-b" }))[0]).toBe(200);
    } finally {
      expiredOwner.resolve(null);
    }
    const result = await olderConnect;
    expect(readOriginCloud(file)).toEqual({ url, sessionToken: "replacement-b", projects: { chief: "proj" } });
    expect(result[0]).toBe(409);
  });

  it("checks the stored owner when different deployments issue the same token text", async () => {
    const url = "http://127.0.0.1:3210";
    const otherUrl = "http://127.0.0.1:3212";
    const { call, file } = await serve({ connect: (deployment) => ({
      query: async () => ({ email: deployment === url ? "ana@x.dev" : "bo@x.dev" }),
      mutation: async () => null,
    }) });
    writeOriginCloud(file, { url, sessionToken: "same-token", projects: { chief: "proj" } });
    expect((await call("PUT", "/api/origin/cloud-session", { url: otherUrl, sessionToken: "same-token" }))[0]).toBe(409);
    expect(readOriginCloud(file)).toEqual({ url, sessionToken: "same-token", projects: { chief: "proj" } });
  });

  it("does not restore an older incoming sign-in after a newer account signs out", async () => {
    const checking = deferred<void>();
    const incomingOwner = deferred<{ email: string }>();
    let replacementSignedIn = true;
    const { call, file } = await serve({ answers: { "auth:me": (args: Record<string, unknown>) => {
      if (args.sessionToken === "older-a") {
        checking.resolve();
        return incomingOwner.promise;
      }
      return replacementSignedIn ? { email: "bo@x.dev" } : null;
    } } });
    const url = "http://127.0.0.1:3210";
    writeOriginCloud(file, { projects: { chief: "proj" } });
    const olderConnect = call("PUT", "/api/origin/cloud-session", { url, sessionToken: "older-a" });
    await checking.promise;
    try {
      expect((await call("PUT", "/api/origin/cloud-session", { url, sessionToken: "replacement-b" }))[0]).toBe(200);
      replacementSignedIn = false;
      expect((await call("DELETE", "/api/origin/cloud-session"))[0]).toBe(200);
    } finally {
      incomingOwner.resolve({ email: "ana@x.dev" });
    }
    const result = await olderConnect;
    expect(readOriginCloud(file)).toEqual({ projects: { chief: "proj" } });
    expect(result[0]).toBe(409);
  });

  it("rejects a stale refresh after the stored session changes away and back", async () => {
    const checking = deferred<void>();
    const storedOwner = deferred<{ email: string }>();
    let originalChecks = 0;
    const { call, file } = await serve({ answers: { "auth:me": (args: Record<string, unknown>) => {
      if (args.sessionToken === "a" && ++originalChecks === 1) {
        checking.resolve();
        return storedOwner.promise;
      }
      return { email: "ana@x.dev" };
    } } });
    const url = "http://127.0.0.1:3210";
    writeOriginCloud(file, { url, sessionToken: "a", projects: { chief: "proj" } });
    const olderRefresh = call("PUT", "/api/origin/cloud-session", { url, sessionToken: "c" });
    await checking.promise;
    try {
      expect((await call("PUT", "/api/origin/cloud-session", { url, sessionToken: "b" }))[0]).toBe(200);
      expect((await call("PUT", "/api/origin/cloud-session", { url, sessionToken: "a" }))[0]).toBe(200);
    } finally {
      storedOwner.resolve({ email: "ana@x.dev" });
    }
    const result = await olderRefresh;
    expect(readOriginCloud(file)).toEqual({ url, sessionToken: "a", projects: { chief: "proj" } });
    expect(result[0]).toBe(409);
  });

  it.each(["PUT", "DELETE"])("keeps the stored account when %s cannot verify its owner", async (method) => {
    const { call, file } = await serve({ answers: { "auth:me": (args: Record<string, unknown>) => {
      if (args.sessionToken === "stored-secret") throw new Error("lookup failed for stored-secret");
      return { email: "ana@x.dev" };
    } } });
    const state = { url: "http://127.0.0.1:3210", sessionToken: "stored-secret", projects: { chief: "proj" } };
    writeOriginCloud(file, state);
    const result = await call(method, "/api/origin/cloud-session", method === "PUT" ? { url: state.url, sessionToken: "replacement" } : undefined);
    expect(result[0]).toBe(502);
    expect(JSON.stringify(result)).not.toContain("stored-secret");
    expect(readOriginCloud(file)).toEqual(state);
  });

  it("allows the same account to refresh its token while preserving project links", async () => {
    const { call, file } = await serve({ answers: { "auth:me": { email: "Ana@x.dev" } } });
    const url = "http://127.0.0.1:3210";
    writeOriginCloud(file, { url, sessionToken: "stored-ana", projects: { chief: "proj" } });
    expect((await call("PUT", "/api/origin/cloud-session", { url, sessionToken: "refreshed-ana" }))[0]).toBe(200);
    expect(readOriginCloud(file)).toEqual({ url, sessionToken: "refreshed-ana", projects: { chief: "proj" } });
  });

  it("refuses a bad address or a token Origin does not accept", async () => {
    const { call } = await serve({ answers: { "auth:me": null } });
    expect((await call("PUT", "/api/origin/cloud-session", { url: "ftp://x", sessionToken: "tok" }))[0]).toBe(400);
    expect(await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "bad" })).toEqual([400, { error: "Origin did not accept this session token" }]);
  });

  it("keeps the Origin session out of connection errors", async () => {
    const { call } = await serve({ answers: { "auth:me": new Error('Request failed with arguments {"sessionToken":"private-origin-session"}') } });
    const [status, body] = await call("PUT", "/api/origin/cloud-session", { url: "http://127.0.0.1:3210", sessionToken: "private-origin-session" });
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("private-origin-session");
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

  it("runs a tool only for an agents capability, as the bot it belongs to, and shows its issues in that turn's thread", async () => {
    const { call, file, fake, appended } = await serve();
    writeOriginCloud(file, { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "proj" } });
    const tool = { name: "origin_list_issues", arguments: { status: "all" } };
    expect(await call("POST", "/api/internal/origin/tool", tool)).toEqual([401, { error: "unauthorized" }]);
    expect(await call("POST", "/api/internal/origin/tool", tool, { authorization: "Bearer forged" })).toEqual([401, { error: "unauthorized" }]);
    expect((await call("POST", "/api/internal/origin/tool", { name: "list_bots" }, { authorization: "Bearer cap-coder" }))[0]).toBe(400);
    expect(appended).toEqual([]);
    const [status, body] = await call("POST", "/api/internal/origin/tool", tool, { authorization: "Bearer cap-coder" });
    expect(status).toBe(200);
    expect((body as { text: string }).text).toContain("2 all issue(s)");
    expect(body).not.toHaveProperty("cards");
    expect(fake.calls.every((entry) => entry.args.projectId === "proj")).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("proj");
    expect(appended).toHaveLength(1);
    expect(appended[0]!.threadId).toBe("coder-thread");
    expect(appended[0]!.message).toMatchObject({ role: "bot", kind: "activity", tool: { name: "origin_list_issues", ok: true } });
    expect(appended[0]!.message.originIssues?.issues.map((issue) => issue.id)).toEqual(["t1", "t2"]);
    expect(appended[0]!.message.from).toBeUndefined();
  });

  it("attributes the cards to the bot in a room, and posts none for an error", async () => {
    const { call, file, appended } = await serve({ rooms: ["room-thread"] });
    writeOriginCloud(file, { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "proj" } });
    await call("POST", "/api/internal/origin/tool", { name: "origin_list_issues", arguments: {} }, { authorization: "Bearer cap-room" });
    expect(appended[0]!.message.from).toMatchObject({ botId: "coder", name: "Coder" });
    await call("POST", "/api/internal/origin/tool", { name: "origin_list_issues", arguments: { priority: "urgent" } }, { authorization: "Bearer cap-room" });
    expect(appended).toHaveLength(1);
  });

  it("takes the record phase only for origin_assign_issue", async () => {
    const { call, file, fake } = await serve();
    writeOriginCloud(file, { url: "http://127.0.0.1:3210", sessionToken: "tok", projects: { chief: "proj" } });
    await call("POST", "/api/internal/origin/tool", { name: "origin_list_issues", arguments: {}, phase: "record" }, { authorization: "Bearer cap-coder" });
    expect(fake.calls.filter((entry) => entry.kind === "mutation")).toEqual([]);
    const [, refused] = await call("POST", "/api/internal/origin/tool", { name: "origin_assign_issue", arguments: { issue_id: "t1", bot_id: "designer" }, phase: "record" }, { authorization: "Bearer cap-coder" });
    expect(refused).toMatchObject({ isError: true, text: expect.stringContaining("Only a Chief") });
  });

  it("leaves other paths to the next handler", async () => {
    const { call } = await serve();
    expect(await call("GET", "/api/bots")).toEqual([404, { from: "next" }]);
  });
});
