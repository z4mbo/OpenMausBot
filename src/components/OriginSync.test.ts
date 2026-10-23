// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  url: "https://first.convex.cloud", token: "first-session", user: { name: "First" },
  state: { hydrated: true, bots: [], instances: [] },
  dispatch: vi.fn(), api: vi.fn(), workspaces: vi.fn(), projects: vi.fn(),
  shareSession: vi.fn(), refreshLinks: vi.fn(), sharedRound: vi.fn(), accountWorkspaces: vi.fn(), switchWorkspace: vi.fn(),
}));

vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/origin-cloud", () => ({
  cloud: { workspaces: { list: fixture.workspaces }, projects: { listForUser: fixture.projects } },
  cloudAction: vi.fn(), cloudMutation: vi.fn(), setCloudUrl: vi.fn(),
  useCloudSession: () => ({ token: fixture.token, user: fixture.user, ready: true }), useCloudUrl: () => fixture.url,
}));
vi.mock("@/lib/origin-cloud/client", () => ({ cloudUrl: () => fixture.url, sessionStore: { get: () => fixture.token }, setSessionToken: vi.fn(), cloudQueryOnce: vi.fn() }));
vi.mock("@/lib/origin-cloud-links", () => ({ refreshCloudLinks: fixture.refreshLinks }));
vi.mock("@/lib/origin-shared-agents", () => ({ sharedAgentsRound: fixture.sharedRound }));
vi.mock("@/lib/origin-teams", () => ({ PROJECT_LEAD_ROLE: { title: "Lead", description: "", soul: "" } }));
vi.mock("@/lib/origin-workspaces", () => ({ activeWorkspaceId: () => null, setAccountWorkspaces: fixture.accountWorkspaces, switchWorkspace: fixture.switchWorkspace, workspaceHeadsOf: () => [] }));
vi.mock("./OriginConnect", () => ({ shareSession: fixture.shareSession }));
vi.mock("./OriginLogo", () => ({ OriginLogo: () => null }));

import { OriginSync } from "./OriginGate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let root: Root;
let host: HTMLDivElement;
let mounted: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  fixture.url = "https://first.convex.cloud";
  fixture.token = "first-session";
  fixture.shareSession.mockResolvedValue(undefined);
  fixture.projects.mockResolvedValue([]);
  fixture.refreshLinks.mockResolvedValue(undefined);
  fixture.sharedRound.mockResolvedValue({});
  fixture.workspaces.mockResolvedValue([]);
  fixture.api.mockImplementation(async (path: string) => {
    if (path === "/api/origin/cloud-links") return { workspaces: {}, projects: {} };
    if (path === "/api/origin/import/workspaces") return { bot: { id: "old-head", name: "Old" } };
    return {};
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(() => {
  if (mounted) flushSync(() => root.unmount());
  host.remove();
});

const render = () => flushSync(() => root.render(createElement(OriginSync)));

describe("Origin sync account isolation", () => {
  it("reconciles imported workspace and project bots in the same round before React renders their additions", async () => {
    fixture.workspaces.mockResolvedValue([{ _id: "team", name: "GGs" }]);
    fixture.projects.mockResolvedValue([{ _id: "project", teamId: "team", name: "Origin" }]);
    const head = { id: "mac-head", name: "GGs", chiefOfStaff: true, section: "Workspace: GGs" };
    const chief = { id: "mac-chief", name: "Origin", chiefOfStaff: true, section: "Origin" };
    const researcher = { id: "mac-researcher", name: "Researcher", title: "Researcher", section: "Origin" };
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/origin/cloud-links") return { workspaces: {}, projects: {} };
      if (path === "/api/origin/import/workspaces") return { bot: head };
      if (path === "/api/origin/import/projects") return { bot: chief, members: [researcher] };
      throw new Error(`Unexpected fixture path: ${path}`);
    });
    render();
    await vi.waitFor(() => expect(fixture.sharedRound).toHaveBeenCalledOnce());
    expect(fixture.sharedRound.mock.calls[0][0].bots).toEqual(expect.arrayContaining([head, chief, researcher]));
    expect(fixture.state.bots).toEqual([]);
  });

  it("chooses a workspace from the current account when older accounts retain local links", async () => {
    fixture.workspaces.mockResolvedValue([{ _id: "current-team", name: "Current" }]);
    fixture.api.mockResolvedValue({ workspaces: { "old-head": "old-team", "current-head": "current-team" }, projects: {} });
    render();
    await vi.waitFor(() => expect(fixture.switchWorkspace).toHaveBeenCalledOnce());
    expect(fixture.switchWorkspace).toHaveBeenCalledWith("current-head");
    expect(fixture.accountWorkspaces).toHaveBeenLastCalledWith(["current-head"]);
  });

  it.each(["session", "server"] as const)("discards an old workspace response after the %s changes", async (change) => {
    const old = deferred<{ _id: string; name: string }[]>();
    fixture.workspaces.mockReturnValueOnce(old.promise).mockResolvedValue([]);
    render();
    await vi.waitFor(() => expect(fixture.workspaces).toHaveBeenCalledOnce());
    if (change === "session") fixture.token = "second-session";
    else fixture.url = "https://second.convex.cloud";
    render();
    old.resolve([{ _id: "old-team", name: "Old" }]);
    await vi.waitFor(() => expect(host.textContent).toContain("not in a workspace yet"));
    expect(fixture.projects).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.accountWorkspaces.mock.calls.every(([ids]) => ids.length === 0)).toBe(true);
  });

  it("stops a round after unmount instead of creating old account bots", async () => {
    const old = deferred<{ _id: string; name: string }[]>();
    fixture.workspaces.mockReturnValueOnce(old.promise);
    render();
    await vi.waitFor(() => expect(fixture.workspaces).toHaveBeenCalledOnce());
    flushSync(() => root.unmount());
    mounted = false;
    old.resolve([{ _id: "old-team", name: "Old" }]);
    await old.promise;
    await new Promise(done => setTimeout(done, 20));
    expect(fixture.projects).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("does not link or dispatch a bot response that arrives after signing into another account", async () => {
    const oldBot = deferred<{ bot: { id: string; name: string } }>();
    fixture.workspaces.mockResolvedValueOnce([{ _id: "old-team", name: "Old" }]).mockResolvedValue([]);
    fixture.api.mockImplementation(async (path: string) => path === "/api/origin/import/workspaces" ? oldBot.promise : { workspaces: {}, projects: {} });
    render();
    await vi.waitFor(() => expect(fixture.api.mock.calls.some(([path]) => path === "/api/origin/import/workspaces")).toBe(true));
    fixture.token = "second-session";
    render();
    oldBot.resolve({ bot: { id: "old-head", name: "Old" } });
    await vi.waitFor(() => expect(host.textContent).toContain("not in a workspace yet"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fixture.api.mock.calls.filter(([, init]) => init?.method === "PUT")).toEqual([]);
    expect(fixture.sharedRound).not.toHaveBeenCalled();
  });
});
