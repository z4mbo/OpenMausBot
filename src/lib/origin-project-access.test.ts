import { describe, expect, it, vi } from "vitest";
import type { WorkspaceMember } from "./origin-members";

vi.mock("@/lib/origin-cloud", () => ({ cloudMutation: vi.fn(), cloudQueryOnce: vi.fn() }));
vi.mock("@/lib/origin-github", () => ({ originGitHub: { createRepository: vi.fn() } }));

const { accessChanges, canCreateProjects, createOriginProject, currentAccess, grantsFor } = await import("./origin-project-access");
const { cloudMutation } = await import("@/lib/origin-cloud");
const { originGitHub } = await import("@/lib/origin-github");
const { exclusiveWithSync } = await import("./origin-sync");

const person = (email: string, role: WorkspaceMember["role"]): WorkspaceMember => ({ _id: email, name: email.split("@")[0]!, email, role, avatarUrl: null });
const members = [person("me@x.io", "admin"), person("boss@x.io", "owner"), person("ann@x.io", "member"), person("bob@x.io", "viewer"), person("cy@x.io", "member")];
const row = (email: string, role: WorkspaceMember["role"] = "member") => ({ _id: `row-${email}`, email, role, status: "active" });

describe("project access", () => {
  it("lets every workspace editor create projects, not viewers", () => {
    expect((["owner", "admin", "member", "viewer"] as const).filter(canCreateProjects)).toEqual(["owner", "admin", "member"]);
  });

  it("grants nobody for a private project and every non-admin for everyone, viewers read-only", () => {
    expect(grantsFor({ mode: "private", emails: [] }, members, "me@x.io")).toEqual([]);
    expect(grantsFor({ mode: "everyone", emails: [] }, members, "me@x.io")).toEqual([
      { email: "ann@x.io", role: "member" }, { email: "bob@x.io", role: "viewer" }, { email: "cy@x.io", role: "member" },
    ]);
  });

  it("grants only chosen people, ignoring admins and addresses outside the workspace", () => {
    expect(grantsFor({ mode: "people", emails: ["ANN@x.io", "boss@x.io", "stranger@y.io"] }, members, "me@x.io")).toEqual([{ email: "ann@x.io", role: "member" }]);
  });

  it("adds missing rows and removes extra ones, keeping owner rows and admins' rows", () => {
    const rows = [row("me@x.io", "owner"), row("boss@x.io"), row("bob@x.io"), row("cy@x.io")];
    expect(accessChanges([{ email: "ann@x.io", role: "member" }, { email: "cy@x.io", role: "member" }], rows, members))
      .toEqual({ add: [{ email: "ann@x.io", role: "member" }], remove: ["row-bob@x.io"] });
  });

  it("reads the choice back from the project's rows", () => {
    expect(currentAccess([row("me@x.io", "owner")], members, "me@x.io")).toEqual({ mode: "private", emails: [] });
    expect(currentAccess([row("ann@x.io"), row("bob@x.io"), row("cy@x.io")], members, "me@x.io").mode).toBe("everyone");
    expect(currentAccess([row("bob@x.io")], members, "me@x.io")).toEqual({ mode: "people", emails: ["bob@x.io"] });
  });
});

describe("exclusiveWithSync", () => {
  it("runs work one at a time, even after a failure", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = exclusiveWithSync(() => new Promise<void>((resolve) => { order.push("first"); release = resolve; }));
    const failing = exclusiveWithSync(async () => { order.push("failing"); throw new Error("boom"); });
    const last = exclusiveWithSync(async () => { order.push("last"); });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    await first;
    await expect(failing).rejects.toThrow("boom");
    await last;
    expect(order).toEqual(["first", "failing", "last"]);
  });
});

describe("a new project's repository", () => {
  const create = (repository?: Parameters<typeof createOriginProject>[0]["repository"]) =>
    createOriginProject({ teamId: "team1", name: "My App", access: { mode: "private", emails: [] }, members, myEmail: "me@x.io", ...(repository ? { repository } : {}) });

  it("creates it under the project's name by default, and reports a GitHub failure without failing the project", async () => {
    vi.mocked(cloudMutation).mockReset().mockResolvedValue("p1");
    vi.mocked(originGitHub.createRepository).mockReset().mockResolvedValue({ state: "ready", repoUrl: "https://github.com/octo/My-App" });
    expect(await create()).toEqual({ projectId: "p1", missed: [], repository: { state: "ready", repoUrl: "https://github.com/octo/My-App" } });
    expect(vi.mocked(cloudMutation).mock.calls[0]).toEqual(["projects:create", { teamId: "team1", name: "My App", githubRepo: "later" }]);
    expect(vi.mocked(originGitHub.createRepository).mock.calls[0]).toEqual(["team1", "p1", "My-App", undefined]);
    await create({ mode: "new", name: null, visibility: "public" });
    expect(vi.mocked(cloudMutation).mock.calls[1]).toEqual(["projects:create", { teamId: "team1", name: "My App", githubRepo: "later", githubRepoVisibility: "public" }]);
    expect(vi.mocked(originGitHub.createRepository).mock.calls[1]).toEqual(["team1", "p1", "My-App", "public"]);
    vi.mocked(originGitHub.createRepository).mockResolvedValue({ state: "error", error: "name already exists" });
    expect((await create({ mode: "new", name: "taken" })).repository).toEqual({ state: "error", error: "name already exists" });
  });

  it("links an existing repository, or leaves it for later without creating one", async () => {
    vi.mocked(cloudMutation).mockReset().mockResolvedValue("p2");
    vi.mocked(originGitHub.createRepository).mockReset();
    expect((await create({ mode: "existing", url: "https://github.com/octo/site" })).repository).toEqual({ state: "ready", repoUrl: "https://github.com/octo/site" });
    expect(vi.mocked(cloudMutation).mock.calls[0]).toEqual(["projects:create", { teamId: "team1", name: "My App", repoUrl: "https://github.com/octo/site" }]);
    expect((await create({ mode: "later" })).repository).toEqual({ state: "later" });
    expect(originGitHub.createRepository).not.toHaveBeenCalled();
  });

  it("falls back to the automatic repository on an Origin backend that does not know githubRepo yet", async () => {
    vi.mocked(cloudMutation).mockReset()
      .mockRejectedValueOnce(new Error("ArgumentValidationError: Object contains extra field `githubRepo` that is not in the validator."))
      .mockResolvedValue("p3");
    vi.mocked(originGitHub.createRepository).mockReset();
    expect(await create()).toEqual({ projectId: "p3", missed: [], repository: { state: "waiting" } });
    expect(vi.mocked(cloudMutation).mock.calls[1]).toEqual(["projects:create", { teamId: "team1", name: "My App" }]);
    expect(originGitHub.createRepository).not.toHaveBeenCalled();
  });
});
