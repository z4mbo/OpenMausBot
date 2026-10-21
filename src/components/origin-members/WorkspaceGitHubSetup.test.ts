// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubWorkspaceStatus } from "@/lib/origin-github";

const fixture = vi.hoisted(() => ({
  role: "owner" as string,
  status: null as Partial<GitHubWorkspaceStatus> | null,
  mutation: vi.fn(),
}));
vi.mock("@/lib/origin-cloud/client", () => ({ cloudMutation: fixture.mutation }));
vi.mock("@/lib/origin-github", () => ({ originGitHub: { workspace: async () => fixture.status } }));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceAccess: (teamId: string | null) => (teamId ? { teamId, slug: "acme", role: fixture.role } : undefined) }));
vi.mock("@/lib/use-origin-workspace", () => ({ useActiveOriginWorkspace: () => ({ teamId: "team1" }) }));
vi.mock("@/lib/origin-cloud", () => ({ cloudAction: vi.fn() }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));

const { WorkspaceGitHubSetup } = await import("./WorkspaceGitHubSetup");
const { closeWorkspaceGitHubOffer, createOriginWorkspace, workspaceGitHubIntroSeen } = await import("@/lib/origin-cloud/workspace-setup");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  fixture.role = "owner";
  fixture.status = null;
  fixture.mutation.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  closeWorkspaceGitHubOffer();
  await act(async () => root.unmount());
  host.remove(); vi.unstubAllGlobals();
});

const render = async () => act(async () => root.render(createElement(WorkspaceGitHubSetup)));
const dialog = () => document.querySelector<HTMLElement>("[data-workspace-github-setup]");
const button = (text: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text);

describe("the first-run GitHub step", () => {
  it("offers the owner of a new workspace GitHub, which they can skip", async () => {
    fixture.status = { canManage: true, localApp: true, shared: null, login: null };
    fixture.mutation.mockResolvedValue({ teamId: "team-new", slug: "new" });
    await render();
    expect(dialog()).toBeNull();
    await act(async () => { await createOriginWorkspace("New workspace"); });
    expect(fixture.mutation).toHaveBeenCalledWith("workspaces:create", { name: "New workspace" });
    expect(dialog()?.dataset.workspaceGithubSetup).toBe("owner");
    expect(dialog()?.textContent).toContain("Connect GitHub for your workspace");
    expect(dialog()?.textContent).toContain("Connect GitHub once");
    expect(workspaceGitHubIntroSeen("team-new")).toBe(true);
    vi.useFakeTimers();
    await act(async () => { button("Skip for now")!.click(); vi.runAllTimers(); });
    vi.useRealTimers();
    expect(dialog()).toBeNull();
  });

  it("says Done once GitHub is shared", async () => {
    fixture.status = { canManage: true, shared: { accountLogin: "acme", accountType: "Organization", connectorLogin: "ada", sharedByName: "Ada", updatedAt: 1 } };
    fixture.mutation.mockResolvedValue({ teamId: "team-new", slug: "new" });
    await render();
    await act(async () => { await createOriginWorkspace("New workspace"); });
    expect(button("Done")).toBeDefined();
    expect(button("Skip for now")).toBeUndefined();
  });

  it("tells a member once that the workspace's GitHub is theirs to use", async () => {
    fixture.role = "member";
    fixture.status = { canManage: false, shared: { accountLogin: "acme", accountType: "Organization", connectorLogin: "ada", sharedByName: "Ada", updatedAt: 1 } };
    await render();
    expect(dialog()?.dataset.workspaceGithubSetup).toBe("member");
    expect(dialog()?.textContent).toContain("GitHub is connected for this workspace by Ada; you can use it.");
    expect(dialog()?.textContent).toContain("Nothing to set up: Ada shared the workspace's GitHub with everyone here.");
    expect(workspaceGitHubIntroSeen("team1")).toBe(true);
    vi.useFakeTimers();
    await act(async () => { button("Got it")!.click(); vi.runAllTimers(); });
    vi.useRealTimers();
    await act(async () => root.render(createElement("div")));
    await render();
    expect(dialog()).toBeNull();
  });

  it("stays quiet for a member while GitHub is not shared", async () => {
    fixture.role = "member";
    fixture.status = { canManage: false, shared: null };
    await render();
    expect(dialog()).toBeNull();
    expect(workspaceGitHubIntroSeen("team1")).toBe(false);
  });
});
