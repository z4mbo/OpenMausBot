// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "member" as string | undefined, links: { workspaces: { studio: "team-studio" } as Record<string, string>, projects: {} } }));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceAccess: (teamId: string | null) => teamId && fixture.role ? { role: fixture.role } : undefined }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => fixture.links }));
vi.mock("./DeleteWorkspaceDialog", () => ({ DeleteWorkspaceDialog: () => null }));
vi.mock("./origin-members", () => ({ RuntimeHelp: () => null, WorkspaceMembersPanel: () => null }));

import { WorkspaceSwitcher } from "./SidebarProjects";

const heads = [{ id: "studio", name: "Studio" }, { id: "shop", name: "Shop" }];
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.links = { workspaces: { studio: "team-studio" }, projects: {} };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function menuItems(activeId: string) {
  act(() => root.render(createElement(WorkspaceSwitcher, { heads: heads as never, activeId, onNewWorkspace: () => {} })));
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Switch workspace"]')!.click());
  return [...host.querySelectorAll("[role=menuitem]")].map((item) => item.textContent);
}

it.each([["owner", true], ["admin", true], ["member", false], ["viewer", false], [undefined, false]] as const)("a workspace %s sees Delete workspace: %s", (role, shown) => {
  fixture.role = role;
  expect(menuItems("studio").includes("Delete workspace…")).toBe(shown);
});

it("offers deleting a workspace that is only on this computer", () => {
  fixture.role = undefined;
  fixture.links = { workspaces: {}, projects: {} };
  expect(menuItems("shop")).toContain("Delete workspace…");
});
