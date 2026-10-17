import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  process.env.ORIGIN_LOCAL_DATA_DIR = mkdtempSync(join(tmpdir(), "origin-github-mock-"));
  process.env.ORIGIN_INTEGRATION_SECRET = "isolated-github-test-secret-not-a-real-credential";
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "http://127.0.0.1:9876";
  delete process.env.GITHUB_TOKEN;
  const { saveWorkspaceGitHub } = await import("../lib/github-workspace");
  const { createProjectRepository, createGitHubTask, syncTarget } = await import("../lib/github-sync");
  saveWorkspaceGitHub("team", "admin", 1, "owner", { access_token: "fake-test-token" });
  const projects = new Map<string, any>(), issues = new Map<string, any>();
  let repoPosts = 0, issuePosts = 0, mode = "success", failLink = false, autoCreate = true, connected = true;
  const remoteRepos = new Map<string, any>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === "http://127.0.0.1:9876/integrations") {
      const a = body.args, p = projects.get(a.projectId);
      if (body.operation === "context") return Response.json({ project: p, task: a.taskId ? issues.get(a.taskId) : null, connection: connected ? { teamId: "team", login: "admin", connectedBy: "owner", autoCreate } : null, credentialAllowed: false, legacyOwner: false });
      if (body.operation === "repoResult") { Object.assign(p, { githubRepoState: a.state, repoUrl: a.repoUrl, githubWorkspaceAccess: a.state === "ready" }); return Response.json(null); }
      if (body.operation === "linkIssue") { if (failLink) { failLink = false; return new Response("temporary failure", { status: 503 }); } Object.assign(issues.get(a.taskId), { githubIssueNumber: a.number, githubIssueUrl: a.issueUrl, done: a.state === "closed" }); return Response.json(null); }
    }
    assert.ok(url.startsWith("https://api.github.com/"), `Unexpected fetch: ${url}`);
    if (url.endsWith("/user/repos")) {
      repoPosts++; assert.equal(body.private, true); assert.equal(body.has_issues, true);
      assert.doesNotMatch(body.description, /[\u0000-\u001f\u007f-\u009f]/, "Repository descriptions cannot contain control characters");
      if (mode === "denied") return Response.json({}, { status: 403 });
      const repo = { id: repoPosts, html_url: `https://github.com/admin/${body.name}`, owner: { login: "admin" }, private: true, description: body.description };
      remoteRepos.set(body.name, repo);
      if (mode === "lost-response") throw new Error("network timeout after GitHub commit");
      return Response.json(repo);
    }
    if (init?.method === "POST" && url.endsWith("/issues")) {
      issuePosts++;
      if (mode === "denied") return Response.json({}, { status: 403 });
      return Response.json({ number: issuePosts, html_url: `${url.replace("https://api.github.com/repos/", "https://github.com/")}/${issuePosts}`, body: body.body, state: "open", updated_at: new Date().toISOString() });
    }
    if (/\/issues\/\d+$/.test(url)) return Response.json({ number: Number(url.split("/").at(-1)), html_url: url, state: "closed", updated_at: new Date().toISOString() });
    const repo = remoteRepos.get(url.split("/").at(-1)!);
    return repo ? Response.json(repo) : Response.json({}, { status: 404 });
  };
  projects.set("project-one", { _id: "project-one", name: "Private by default", description: "A real project\nwith multiline notes\tand tabs" });
  await createProjectRepository("project-one"); await createProjectRepository("project-one");
  assert.equal(repoPosts, 1); assert.equal(projects.get("project-one").githubRepoState, "ready");
  projects.set("project-manual", { _id: "project-manual", name: "Manual creation" });
  autoCreate = false;
  assert.equal((await createProjectRepository("project-manual")).state, "awaiting_connection");
  assert.equal((await createProjectRepository("project-manual", true)).state, "ready", "Explicit creation works when automatic creation is off");
  connected = false;
  projects.set("project-waiting", { _id: "project-waiting", name: "Waiting for OAuth" });
  assert.equal((await createProjectRepository("project-waiting", true)).state, "awaiting_connection");
  connected = true; autoCreate = true;
  assert.equal((await createProjectRepository("project-waiting")).state, "ready");
  projects.set("project-two", { _id: "project-two", name: "Retry denied" });
  mode = "denied"; await createProjectRepository("project-two");
  assert.equal(projects.get("project-two").githubRepoState, "error");
  mode = "success"; await createProjectRepository("project-two");
  assert.equal(projects.get("project-two").githubRepoState, "ready");
  projects.set("project-three", { _id: "project-three", name: "Lost response" });
  mode = "lost-response"; await createProjectRepository("project-three");
  const attempts = repoPosts;
  projects.get("project-three").name = "Renamed after timeout";
  mode = "success"; await createProjectRepository("project-three");
  assert.equal(repoPosts, attempts); assert.equal(projects.get("project-three").githubRepoState, "ready");
  issues.set("task-one", { _id: "task-one", title: "Create inline", done: false });
  mode = "denied"; await assert.rejects(createGitHubTask("project-one", "task-one"));
  mode = "success"; failLink = true; await assert.rejects(createGitHubTask("project-one", "task-one"));
  const issueAttempts = issuePosts;
  await createGitHubTask("project-one", "task-one"); await createGitHubTask("project-one", "task-one");
  assert.equal(issuePosts, issueAttempts, "Retry after linking failure must reuse the GitHub issue");
  await syncTarget({ projectId: "project-one", taskId: "task-one", number: issues.get("task-one").githubIssueNumber, repoUrl: projects.get("project-one").repoUrl, connection: null });
  assert.equal(issues.get("task-one").done, true);
  projects.get("project-one").githubWorkspaceAccess = false;
  issues.set("task-denied", { _id: "task-denied", title: "No workspace approval", done: false });
  await assert.rejects(createGitHubTask("project-one", "task-denied"), /admin/);
  console.log("PASS private repositories, admin credentials, definitive rejection retries, ambiguous response recovery, rename recovery, issue deduplication, closure sync and repository approval");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
