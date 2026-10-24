import { describe, expect, it } from "vitest";

import type { GitHubService } from "./service.ts";
import type { GitHubStore } from "./store.ts";
import { pushIssueState, syncLinkedTask, type IntegrationContext } from "./sync.ts";

const repoUrl = "https://github.com/acme/app";
type Task = NonNullable<IntegrationContext["task"]>;
type Call = { method: string; path: string; body?: Record<string, unknown> };

function fixture(task: Task, remote: { state: "open" | "closed"; body?: string } = { state: "open" }) {
  const requests: Call[] = [];
  const bridged: { operation: string; args: Record<string, unknown> }[] = [];
  const issue = (number: number, state: "open" | "closed") => ({
    number, state, html_url: `${repoUrl}/issues/${number}`, updated_at: "2026-10-24T10:00:00Z", node_id: `node-${number}`,
    body: remote.body ?? `Work\n\n<!-- origin-task:${task._id} -->`,
  });
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace("https://api.github.com", "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ method, path, ...(body ? { body } : {}) });
    if (path === "/graphql") return reply({ data: { deleteIssue: { clientMutationId: null } } });
    if (path === "/repos/acme/app/issues" && method === "POST") return reply(issue(9, "open"));
    if (path === "/repos/acme/app/issues/7") return reply(issue(7, method === "PATCH" ? body!.state as "open" | "closed" : remote.state));
    return reply({});
  }) as typeof globalThis.fetch;
  const jobs = new Map<string, { state: string; payload?: string }>();
  const store = {
    connectionInfo: () => null,
    readJob: (key: string) => jobs.get(key),
    saveJob: (key: string, state: string, payload?: unknown) => { jobs.set(key, { state, ...(payload ? { payload: JSON.stringify(payload) } : {}) }); },
    lockJob: () => true,
  } as unknown as GitHubStore;
  const context: IntegrationContext = {
    credentialAllowed: false, legacyOwner: true, connection: null, task,
    project: { _id: "project", name: "App", status: "active", repoUrl, githubWorkspaceAccess: false },
  };
  const service = {
    store, fetch, env: { legacyToken: "fixture-token" }, publicUrl: () => undefined, now: () => Date.now(),
    convex: () => { throw new Error("not used"); },
    bridge: async <T,>(operation: string, args: unknown): Promise<T> => {
      bridged.push({ operation, args: args as Record<string, unknown> });
      return (operation === "context" ? context : null) as T;
    },
  } as unknown as GitHubService;
  const writes = () => bridged.filter((call) => call.operation !== "context");
  return { service, requests, writes };
}

const linked = (patch: Partial<Task>): Task => ({ _id: "task", title: "Work", done: false, githubIssueNumber: 7, githubIssueUrl: `${repoUrl}/issues/7`, githubIssueState: "open", ...patch });

describe("pushing an Origin issue's state to GitHub", () => {
  it("closes the GitHub issue of a completed issue as completed and keeps the link", async () => {
    const f = fixture(linked({ done: true }));
    await syncLinkedTask(f.service, "project", "task", 7, repoUrl);
    expect(f.requests.filter((call) => call.method !== "GET")).toEqual([{ method: "PATCH", path: "/repos/acme/app/issues/7", body: { state: "closed", state_reason: "completed" } }]);
    expect(f.writes()).toEqual([{ operation: "linkIssue", args: expect.objectContaining({ taskId: "task", number: 7, state: "closed" }) }]);
  });

  it("reopens the GitHub issue of an issue reopened in Origin", async () => {
    const f = fixture(linked({ githubIssueState: "closed", githubIssueReopenRequested: true }), { state: "closed" });
    await syncLinkedTask(f.service, "project", "task", 7, repoUrl);
    expect(f.requests.filter((call) => call.method !== "GET")).toEqual([{ method: "PATCH", path: "/repos/acme/app/issues/7", body: { state: "open" } }]);
    expect(f.writes()).toEqual([{ operation: "linkIssue", args: expect.objectContaining({ state: "open" }) }]);
  });

  it("pulls a close made on GitHub instead of pushing anything", async () => {
    const f = fixture(linked({}), { state: "closed" });
    await syncLinkedTask(f.service, "project", "task", 7, repoUrl);
    expect(f.requests.every((call) => call.method === "GET")).toBe(true);
    expect(f.writes()).toEqual([{ operation: "linkIssue", args: expect.objectContaining({ state: "closed" }) }]);
  });

  it("deletes the GitHub issue of an issue moved back to Draft, even a closed one, and forgets the link", async () => {
    const f = fixture(linked({ draft: true, githubIssueState: "closed" }), { state: "closed" });
    await syncLinkedTask(f.service, "project", "task", 7, repoUrl);
    expect(f.requests.filter((call) => call.method !== "GET").map((call) => call.path)).toEqual(["/graphql"]);
    expect(f.writes()).toEqual([{ operation: "unlinkIssue", args: { projectId: "project", taskId: "task", number: 7 } }]);
  });

  it("closes as not planned with a note when the GitHub issue was not created by Origin", async () => {
    const f = fixture(linked({ draft: true }), { state: "open", body: "Filed by hand" });
    await syncLinkedTask(f.service, "project", "task", 7, repoUrl);
    expect(f.requests.filter((call) => call.method !== "GET")).toEqual([
      { method: "PATCH", path: "/repos/acme/app/issues/7", body: { state: "closed", state_reason: "not_planned" } },
      { method: "POST", path: "/repos/acme/app/issues/7/comments", body: { body: expect.stringContaining("Moved back to Draft in Origin") } },
    ]);
    expect(f.writes().map((call) => call.operation)).toEqual(["unlinkIssue"]);
  });

  it("creates the GitHub issue of an unlinked issue outside Draft, and leaves drafts and completed issues alone", async () => {
    const created = fixture({ _id: "task", title: "Work", done: false });
    expect(await pushIssueState(created.service, "project", "task")).toEqual({ taskId: "task", issueNumber: 9 });
    expect(created.requests.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /repos/acme/app/issues"]);
    for (const task of [{ _id: "task", title: "Work", done: false, draft: true }, { _id: "task", title: "Work", done: true }]) {
      const untouched = fixture(task);
      expect(await pushIssueState(untouched.service, "project", "task")).toEqual({ taskId: "task" });
      expect(untouched.requests).toEqual([]);
    }
  });

  it("syncs a linked issue, reports no issue once a draft's is deleted, and reports a GitHub failure instead of throwing", async () => {
    const synced = fixture(linked({ done: true }));
    expect(await pushIssueState(synced.service, "project", "task")).toEqual({ taskId: "task", issueNumber: 7 });
    expect(synced.requests.some((call) => call.method === "PATCH")).toBe(true);
    const parked = fixture(linked({ draft: true }));
    expect(await pushIssueState(parked.service, "project", "task")).toEqual({ taskId: "task" });
    expect(parked.writes().map((call) => call.operation)).toEqual(["unlinkIssue"]);
    const failing = fixture(linked({ done: true }));
    failing.service.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    expect(await pushIssueState(failing.service, "project", "task")).toEqual({ taskId: "task", error: "GitHub request failed (500)" });
  });
});
