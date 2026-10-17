// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readPRSnapshot, syncPREvent, syncPRPage } from "./github-prs";
import { githubRequest } from "./github-workspace";
import { integrationBridge } from "./integration-bridge";
import { withInstallation } from "./github-app";
const mocks = vi.hoisted(() => ({ jobs: new Map<string, { state: string; payload: string }>() }));
vi.mock("./github-workspace", () => ({
  githubRequest: vi.fn(), GitHubHttpError: class extends Error {},
  lockGitHubJob: vi.fn(() => true), readGitHubJob: (key: string) => mocks.jobs.get(key),
  saveGitHubJob: (key: string, state: string, payload?: unknown) => mocks.jobs.set(key, { state, payload: JSON.stringify(payload ?? null) }),
}));
vi.mock("./integration-bridge", () => ({ integrationBridge: vi.fn() }));
vi.mock("./github-app", () => ({ withInstallation: vi.fn(), repositoryPath: (url: string) => `/repos${new URL(url).pathname}` }));
const remote = { number: 1, html_url: "https://github.com/test/prs/pull/1", node_id: "node-1", state: "open", draft: false, updated_at: "2026-10-15T10:00:00Z", head: { ref: "origin/task", sha: "a".repeat(40), repo: { full_name: "test/prs" } }, base: { sha: "b".repeat(40), repo: { full_name: "test/prs" } }, mergeable: true, body: "<!-- origin-task:task-1 -->" };
const context = { project: { _id: "project-1", repoUrl: "https://github.com/test/prs" }, task: { _id: "task-1" }, tool: { kind: "open_pull_request", branch: "origin/task", title: "Implementation", body: "Task plan" } };
beforeEach(() => {
  mocks.jobs.clear();
  vi.mocked(withInstallation).mockImplementation(async (_project, _repo, fn) => fn("fake-App-installation-token"));
  vi.mocked(integrationBridge).mockImplementation(async (operation, args) => {
    if (operation === "prFinalize") { const a = args as { snapshot: { number: number; url: string } }; return { status: "opened", number: a.snapshot.number, url: a.snapshot.url }; }
    throw new Error(`Unexpected bridge operation ${operation}`);
  });
  vi.mocked(githubRequest).mockImplementation(async (path, _token, init) => {
    if (path === "/repos/test/prs") return { default_branch: "main" };
    if (path.includes("/git/ref/")) return { object: { sha: remote.head.sha } };
    if (path.includes("/pulls?")) return [];
    if (path.endsWith("/pulls") && init?.method === "POST") return remote;
    if (path.endsWith("/pulls/1")) return remote;
    if (path.includes("/check-runs")) return { total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] };
    if (path.includes("/status?")) return { total_count: 0, statuses: [] };
    if (path === "/graphql") return { data: { node: { reviewDecision: "APPROVED" } } };
    throw new Error(`Unexpected GitHub request ${path}`);
  });
});
afterEach(() => vi.resetAllMocks());
test("bounded reconciliation rotates through draft, open and closed pages", async () => {
  const states: string[] = [];
  vi.mocked(integrationBridge).mockImplementation(async (op, args) => {
    if (op === "prTargets") { states.push((args as { state: string }).state); return { rows: [], nextCursor: null }; }
    throw new Error(`Unexpected operation ${op}`);
  });
  for (let n = 0; n < 4; n++) await syncPRPage();
  expect(states).toEqual(["draft", "open", "closed", "draft"]);
});
test("a PR changing head during fetch cannot mix checks/review from the old SHA", async () => {
  const original = vi.mocked(githubRequest).getMockImplementation()!; let reads = 0;
  vi.mocked(githubRequest).mockImplementation(async (path, token, init) => path.endsWith("/pulls/1") && ++reads > 1 ? { ...remote, head: { ...remote.head, sha: "c".repeat(40) } } : original(path, token, init));
  await expect(readPRSnapshot("https://github.com/test/prs", 1, "fake")).rejects.toThrow("changed while");
});
test("old-head check event cannot replace the current head's checks", async () => {
  vi.mocked(integrationBridge).mockImplementation(async op => op === "prEventTargets" ? [{ _id: "pr-1", url: remote.html_url, number: 1 }] : op === "prBeginSync" ? 2 : null);
  await syncPREvent("https://github.com/test/prs", [1], "c".repeat(40));
  expect(vi.mocked(integrationBridge).mock.calls.some(([op]) => op === "prSync")).toBe(false);
});
