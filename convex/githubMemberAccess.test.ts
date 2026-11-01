/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";
import type { Id } from "./_generated/dataModel";
import { createFakeGitHub, type FakeGitHub } from "../testing/fake-github";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const SEALING_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 7)));

let fake: FakeGitHub;
beforeEach(async () => {
  fake = await createFakeGitHub();
  vi.stubEnv("ORIGIN_SEALING_KEY", SEALING_KEY);
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.github.com" && url.origin !== "https://github.com") throw new Error(`Unexpected fetch ${url.origin}`);
    return fake.handle(request);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const person = (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0], email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await person("owner@test.dev");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.token, name: "Acme" });
  const member = await person("member@test.dev");
  const memberRow = await t.run((ctx) => ctx.db.insert("teamMembers", { teamId, userId: member.userId, email: "member@test.dev", name: "member", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
  const ownerGitHub = fake.user("octo", 7);
  fake.install("octo", 7);
  const app = { appId: fake.appId, privateKey: fake.privateKeyPem, clientId: "Iv1.client", clientSecret: "client-secret", slug: fake.slug, webhookSecret: "hook" };
  const share = () => t.action(api.teamGitHub.share, { sessionToken: owner.token, teamId, app, token: { access_token: ownerGitHub } });
  const project = async (name: string, visibility: "public" | "private" = "private") => {
    const projectId = await t.mutation(api.projects.create, { sessionToken: owner.token, teamId, name, githubRepo: "later", githubRepoVisibility: visibility });
    await t.action(api.teamGitHub.createRepository, { sessionToken: owner.token, projectId });
    await t.run((ctx) => ctx.db.insert("members", { projectId, userId: member.userId, email: "member@test.dev", name: "member", role: "member", status: "active", createdAt: 1, updatedAt: 1 }));
    return projectId;
  };
  const link = async () => {
    const started = await t.action(api.githubLinks.startLink, { sessionToken: member.token, teamId });
    fake.approveDevice(started.userCode, "mia-dev", 31);
    return t.action(api.githubLinks.finishLink, { sessionToken: member.token, teamId });
  };
  return { t, teamId, owner, member, memberRow, share, project, link };
}

describe("the default branch of a repository Origin creates", () => {
  test("is protected at creation, so a push token cannot change it without a reviewed pull request", async () => {
    const f = await fixture();
    await f.share();
    const projectId = await f.project("Open Site", "public");
    const repo = fake.repos.get("octo/open-site")!;
    expect(repo.protection.get("main")).toMatchObject({ allow_force_pushes: false, allow_deletions: false, required_pull_request_reviews: { required_approving_review_count: 1 } });
    expect(await f.t.query(api.githubProtection.status, { sessionToken: f.member.token, projectId })).toMatchObject({ state: "on", branch: "main" });
    const push = await f.t.action(api.teamGitHub.bridge, { sessionToken: f.member.token, operation: "githubToken", args: { projectId, access: "push" } }) as { token: string };
    const write = await fake.handle(new Request("https://api.github.com/repos/octo/open-site/contents/README.md", { method: "PUT", headers: { authorization: `Bearer ${push.token}` }, body: JSON.stringify({ branch: "main", message: "sneak", content: "" }) }));
    expect(write.status).toBe(409);
    const force = await fake.handle(new Request("https://api.github.com/repos/octo/open-site/git/refs/heads/main", { method: "PATCH", headers: { authorization: `Bearer ${push.token}` }, body: JSON.stringify({ sha: "0".repeat(40), force: true }) }));
    expect(force.status).toBe(422);
  });

  test("a private repository on a free plan is reported, and a project admin protects it once the plan allows", async () => {
    const f = await fixture();
    await f.share();
    const projectId = await f.project("Private App");
    const status = await f.t.query(api.githubProtection.status, { sessionToken: f.owner.token, projectId });
    expect(status).toMatchObject({ state: "unavailable", branch: "main" });
    expect(status?.detail).toContain("paid GitHub plan");
    await expect(f.t.action(api.githubProtection.protect, { sessionToken: f.member.token, projectId })).rejects.toThrow("project admin");
    fake.paid.add("octo");
    expect(await f.t.action(api.githubProtection.protect, { sessionToken: f.owner.token, projectId })).toEqual({ state: "on", branch: "main" });
    expect(fake.repos.get("octo/private-app")!.protection.has("main")).toBe(true);
  });

  test("protection someone set on GitHub is kept, never weakened", async () => {
    const f = await fixture();
    await f.share();
    fake.paid.add("octo");
    const projectId = await f.project("Strict App");
    const repo = fake.repos.get("octo/strict-app")!;
    const strict = { required_pull_request_reviews: { required_approving_review_count: 2 }, enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
    repo.protection.set("main", strict);
    expect(await f.t.action(api.githubProtection.protect, { sessionToken: f.owner.token, projectId })).toEqual({ state: "on", branch: "main" });
    expect(repo.protection.get("main")).toBe(strict);
    const loose = { required_pull_request_reviews: null, allow_force_pushes: { enabled: true } };
    repo.protection.set("main", loose);
    expect(await f.t.action(api.githubProtection.protect, { sessionToken: f.owner.token, projectId })).toMatchObject({ state: "error" });
    expect(repo.protection.get("main")).toBe(loose);
  });
});

describe("push access Origin gave a linked GitHub", () => {
  test("is taken back when the member becomes a viewer or leaves, and given back when they can edit again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = await fixture();
    await f.share();
    await f.project("Team App", "public");
    await f.link();
    const collaborators = () => fake.repos.get("octo/team-app")!.collaborators;
    expect(collaborators().get("mia-dev")).toBe("push");

    await f.t.mutation(api.teams.updateRole, { sessionToken: f.owner.token, teamId: f.teamId, memberId: f.memberRow, role: "viewer" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(collaborators().has("mia-dev")).toBe(false);
    expect(await f.t.run((ctx) => ctx.db.query("githubCollaborators").collect())).toEqual([]);

    await f.t.mutation(api.teams.updateRole, { sessionToken: f.owner.token, teamId: f.teamId, memberId: f.memberRow, role: "member" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(collaborators().get("mia-dev")).toBe("push");

    await f.t.mutation(api.teams.removeMember, { sessionToken: f.owner.token, teamId: f.teamId, memberId: f.memberRow });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(collaborators().has("mia-dev")).toBe(false);
  });

  test("is taken back when a project admin removes the member from the project", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = await fixture();
    await f.share();
    const projectId = await f.project("Solo", "public");
    await f.link();
    const row = await f.t.run((ctx) => ctx.db.query("members").withIndex("by_project_email", (q) => q.eq("projectId", projectId).eq("email", "member@test.dev")).unique());
    await f.t.mutation(api.members.remove, { sessionToken: f.owner.token, projectId, memberId: row!._id });
    const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((job) => job.name.includes("reviewAccess"))).toBe(true);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fake.repos.get("octo/solo")!.collaborators.has("mia-dev")).toBe(false);
    expect(await f.t.action(internal.githubLinks.reviewAccess, { teamId: f.teamId, email: "member@test.dev" })).toEqual({ removed: 0, invited: 0 });
  });
});

describe("reconnecting the workspace's GitHub", () => {
  test("keeps the organization the workspace works in", async () => {
    const f = await fixture();
    await f.share();
    const org = fake.install("acme-co", 99, "Organization");
    await f.t.action(api.teamGitHub.chooseAccount, { sessionToken: f.owner.token, teamId: f.teamId, installationId: org });
    expect(await f.share()).toEqual({ accountLogin: "acme-co" });
    const status = await f.t.query(api.teamGitHub.status, { sessionToken: f.member.token, teamId: f.teamId });
    expect(status.shared).toMatchObject({ accountLogin: "acme-co", accountType: "Organization", connectorLogin: "octo" });
  });
});
