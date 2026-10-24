// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  api: vi.fn(), cloudMutation: vi.fn(), switchWorkspace: vi.fn(), sync: vi.fn(),
  summary: undefined as unknown, role: "owner",
  state: { bots: [] as unknown[], groups: [] as unknown[] },
}));

vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: fixture.state }) }));
vi.mock("@/lib/origin-cloud", () => ({ cloudMutation: fixture.cloudMutation, useCloudQuery: () => fixture.summary }));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceAccess: () => ({ role: fixture.role }) }));
vi.mock("@/lib/origin-sync", () => ({ exclusiveWithSync: (work: () => Promise<unknown>) => work(), requestOriginSync: fixture.sync }));
vi.mock("@/lib/origin-workspaces", () => ({ switchWorkspace: fixture.switchWorkspace }));

import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";

const head = { id: "studio", name: "Studio", chiefOfStaff: true, section: "Workspace: Studio", managedSections: ["Walkies"] };
let root: Root;
let host: HTMLDivElement;
const IS_REACT_ACT_ENVIRONMENT = "IS_REACT_ACT_ENVIRONMENT";

beforeEach(() => {
  (globalThis as Record<string, unknown>)[IS_REACT_ACT_ENVIRONMENT] = true;
  vi.clearAllMocks();
  fixture.state = { bots: [head, { id: "walkies", name: "Walkies", chiefOfStaff: true, section: "Walkies" }, { id: "nova", name: "Nova", section: "Walkies" }], groups: [] };
  fixture.summary = { name: "Studio", projects: ["Walkies"], projectCount: 1, agentCount: 2, memberCount: 3, openIssueCount: 4, countsCapped: false };
  fixture.role = "owner";
  fixture.api.mockResolvedValue({});
  fixture.cloudMutation.mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

function open(onClose = vi.fn()) {
  act(() => root.render(createElement(DeleteWorkspaceDialog, { head: head as never, cloudTeamId: "team-studio", nextHeadId: "shop", onClose })));
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  const input = dialog.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]')!;
  const submit = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.includes("Delete workspace"))!;
  return { dialog, input, submit, onClose };
}

describe("the delete-workspace confirmation", () => {
  it("says what goes and stays disabled until the exact name is typed", () => {
    const { dialog, input, submit } = open();
    const list = dialog.querySelector("[data-workspace-deletion-list]")!.textContent!;
    expect(list).toContain("1 project: Walkies");
    expect(list).toContain("2 shared agents");
    expect(list).toContain("Access for 3 members");
    expect(list).toContain("On this computer: 3 agents");
    expect(dialog.textContent).toContain("GitHub repositories are kept");
    expect(submit.disabled).toBe(true);
    act(() => type(input, "studio"));
    expect(submit.disabled).toBe(true);
    act(() => type(input, "Studio"));
    expect(submit.disabled).toBe(false);
  });

  it("deletes the agents here, then the Origin workspace, then the head, and opens the next workspace", async () => {
    const { input, submit } = open();
    const order: string[] = [];
    fixture.api.mockImplementation(async (path: string) => { order.push(path); return {}; });
    fixture.cloudMutation.mockImplementation(async (name: string, args: unknown) => { order.push(`${name} ${JSON.stringify(args)}`); return null; });
    act(() => type(input, "Studio"));
    await act(async () => { submit.click(); });
    await vi.waitFor(() => expect(fixture.switchWorkspace).toHaveBeenCalledWith("shop"));
    expect(order).toEqual([
      "/api/bots/nova", "/api/bots/walkies", "/api/sidebar-sections?section=Walkies",
      'workspaces:remove {"teamId":"team-studio","confirmName":"Studio"}', "/api/bots/studio",
    ]);
    expect(fixture.sync).toHaveBeenCalled();
  });

  it("shows why Origin refused and keeps the head", async () => {
    const { dialog, input, submit } = open();
    fixture.cloudMutation.mockRejectedValue(new Error("Admin role required"));
    act(() => type(input, "Studio"));
    await act(async () => { submit.click(); });
    await vi.waitFor(() => expect(dialog.textContent).toContain("Origin kept the workspace: Admin role required"));
    expect(fixture.api.mock.calls.map(([path]) => path)).not.toContain("/api/bots/studio");
    expect(fixture.switchWorkspace).not.toHaveBeenCalled();
  });

  it("tells a member they cannot delete it and offers nothing to confirm", () => {
    fixture.role = "member";
    act(() => root.render(createElement(DeleteWorkspaceDialog, { head: head as never, cloudTeamId: "team-studio", onClose: vi.fn() })));
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.textContent).toContain("Only the workspace's owner or an admin can delete it");
    expect(dialog.querySelector('input[aria-label="Workspace name"]')).toBeNull();
  });
});
