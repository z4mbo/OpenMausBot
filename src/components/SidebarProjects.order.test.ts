import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, role: "owner", rows: [{ _id: "pa", teamId: "team" }, { _id: "pb", teamId: "team" }, { _id: "pc", teamId: "team" }],
  view: { order: ["c", "b", "a"], sort: "custom", collapsed: false }, links: { workspaces: {}, projects: { a: "pa", b: "pb", c: "pc" } } as { workspaces: Record<string, string>; projects: Record<string, string> },
  mutate: vi.fn(), query: vi.fn(), localOrder: vi.fn(), currentSession: true, token: "fixture-session",
}));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = fixture.index++; if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [fixture.values[index], (next: unknown) => { fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = fixture.index++; return fixture.values[index] ??= { current: initial }; },
  useEffect: vi.fn(),
}));
vi.mock("@/lib/origin-workspaces", async original => ({ ...await original<typeof import("@/lib/origin-workspaces")>(), useWorkspaces: () => fixture.view, setProjectOrder: fixture.localOrder }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => fixture.links }));
vi.mock("@/lib/origin-cloud", () => ({ cloudMutation: fixture.mutate, cloudQueryOnce: fixture.query, useCloudQuery: (_name: string, args: unknown) => args === "skip" ? undefined : fixture.rows, useCloudUrl: () => "https://fixture.convex.cloud", useCloudToken: () => "fixture-session" }));
vi.mock("@/lib/origin-cloud/client", () => ({ captureCloudSession: () => ({ isCurrent: () => fixture.currentSession }) }));
vi.mock("@/lib/origin-cloud/hooks", () => ({ useCloudToken: () => fixture.token }));
vi.mock("./origin-members", () => ({ RuntimeHelp: () => null, WorkspaceMembersPanel: () => null }));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceAccess: () => ({ role: fixture.role }) }));
vi.mock("./lazy-screens", () => ({ NewBotDialog: () => null }));
vi.mock("./origin-pages/ui", () => ({ iconButton: "" }));

import { SidebarProjects } from "./SidebarProjects";

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const nodes = (value: ReactNode): Node[] => Children.toArray(value).flatMap(child => isValidElement(child) ? [child as Node, ...nodes((child as Node).props.children)] : []);
const bots = ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase() }) as Bot);
function render(projects = bots) {
  let all: Node[] = [];
  function Body() { fixture.index = 0; const result = SidebarProjects({ cloudTeamId: "team", projects, row: bot => createElement("span", null, bot.name) }); all = nodes(result); return result; }
  const html = renderToStaticMarkup(createElement(Body));
  return { html, all, rows: all.filter(node => node.props["data-sidebar-project-row"]), grip: (id: string) => all.find(node => node.props["aria-label"] === `Reorder ${id.toUpperCase()}`)! };
}
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
beforeEach(() => {
  fixture.values = []; fixture.role = "owner"; fixture.currentSession = true; fixture.token = "fixture-session";
  fixture.rows = [{ _id: "pa", teamId: "team" }, { _id: "pb", teamId: "team" }, { _id: "pc", teamId: "team" }];
  fixture.view = { order: ["c", "b", "a"], sort: "custom", collapsed: false };
  fixture.links = { workspaces: {}, projects: { a: "pa", b: "pb", c: "pc" } };
  fixture.mutate.mockReset().mockResolvedValue(null); fixture.query.mockReset().mockImplementation(async () => fixture.rows); fixture.localOrder.mockReset();
});

describe("shared sidebar project order", () => {
  it("uses canonical workspace order instead of stale machine-local IDs", () => {
    expect(render().rows.map(row => row.props["data-sidebar-project-row"])).toEqual(["a", "b", "c"]);
  });

  it("saves a keyboard move to the workspace with the visible canonical order as its compare-and-swap base", async () => {
    const event = { key: "ArrowUp", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (render().grip("c").props.onKeyDown as (event: unknown) => void)(event); await flush();
    expect(fixture.mutate).toHaveBeenCalledWith("projects:reorder", { teamId: "team", projectIds: ["pa", "pc", "pb"], expectedProjectIds: ["pa", "pb", "pc"] });
    expect(fixture.localOrder).not.toHaveBeenCalled();
  });

  it("shows the saved order on another machine with different local bot IDs and browser preferences", async () => {
    fixture.mutate.mockImplementationOnce(async (_name: string, { projectIds }: { projectIds: string[] }) => { fixture.rows = projectIds.map(_id => ({ _id, teamId: "team" })); });
    (render().grip("c").props.onKeyDown as (event: unknown) => void)({ key: "ArrowUp", preventDefault: vi.fn(), stopPropagation: vi.fn() }); await flush();
    expect(render().rows.map(row => row.props["data-sidebar-project-row"])).toEqual(["a", "c", "b"]);
    fixture.values = [];
    fixture.links = { workspaces: {}, projects: { "mac-a": "pa", "mac-b": "pb", "mac-c": "pc" } };
    fixture.view.order = ["mac-b", "mac-a", "mac-c"];
    const mac = bots.map(bot => ({ ...bot, id: `mac-${bot.id}` }));
    expect(render(mac).rows.map(row => row.props["data-sidebar-project-row"])).toEqual(["mac-a", "mac-c", "mac-b"]);
  });

  it("refreshes a rejected concurrent order instead of retrying over a teammate's change", async () => {
    fixture.mutate.mockRejectedValueOnce(new Error("Project order changed. Refresh the list and try again."));
    fixture.query.mockResolvedValueOnce([fixture.rows[2], fixture.rows[0], fixture.rows[1]]);
    (render().grip("c").props.onKeyDown as (event: unknown) => void)({ key: "ArrowUp", preventDefault: vi.fn(), stopPropagation: vi.fn() }); await flush();
    expect(fixture.query).toHaveBeenCalledWith("projects:listForUser", { teamId: "team" });
    expect(render().html).toContain("Project order changed. Refresh the list and try again.");
    expect(render().rows.map(row => row.props["data-sidebar-project-row"])).toEqual(["c", "a", "b"]);
    expect(fixture.mutate).toHaveBeenCalledOnce();
    expect(fixture.localOrder).not.toHaveBeenCalled();
  });

  it("keeps archived and not-yet-imported visible project IDs in the complete saved order", async () => {
    fixture.rows.splice(1, 0, { _id: "not-yet-imported", teamId: "team" });
    (render().grip("c").props.onKeyDown as (event: unknown) => void)({ key: "ArrowUp", preventDefault: vi.fn(), stopPropagation: vi.fn() }); await flush();
    expect(fixture.mutate.mock.calls[0][1]).toMatchObject({ projectIds: ["pa", "not-yet-imported", "pc", "pb"], expectedProjectIds: ["pa", "not-yet-imported", "pb", "pc"] });
  });

  it("keeps local-only project changes out of shared mutations and disables workspace viewers", async () => {
    const local = [...bots, { id: "x", name: "X" } as Bot, { id: "y", name: "Y" } as Bot];
    fixture.view.order = ["y", "x", "c", "b", "a"];
    (render(local).grip("y").props.onKeyDown as (event: unknown) => void)({ key: "ArrowDown", preventDefault: vi.fn(), stopPropagation: vi.fn() }); await flush();
    expect(fixture.localOrder).toHaveBeenCalledWith(["x", "y"]);
    expect(fixture.mutate).not.toHaveBeenCalled();
    fixture.role = "viewer";
    expect(render().grip("c").props.disabled).toBe(true);
    (render().grip("c").props.onKeyDown as (event: unknown) => void)({ key: "ArrowUp", preventDefault: vi.fn(), stopPropagation: vi.fn() }); await flush();
    expect(fixture.mutate).not.toHaveBeenCalled();
  });

  it("does not save on pointer movement and commits once on pointer release", async () => {
    const list = { contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 300 }) };
    const document = { elementsFromPoint: () => [{ closest: () => ({ dataset: { reorderKey: "b" }, closest: () => list }) }] };
    const handle = { ownerDocument: document, focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const event = (y: number) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: y, currentTarget: handle, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    const root = render().all.find(node => node.props["data-sidebar-projects"] !== undefined)!;
    (root.props.ref as { current: unknown }).current = list;
    (render().grip("c").props.onPointerDown as (event: unknown) => void)(event(150));
    (render().grip("c").props.onPointerMove as (event: unknown) => void)(event(100));
    expect(render().rows.map(row => row.props["data-sidebar-project-row"])).toEqual(["a", "b", "c"]);
    expect(fixture.mutate).not.toHaveBeenCalled();
    (render().grip("c").props.onPointerUp as (event: unknown) => void)(event(100)); await flush();
    expect(fixture.mutate).toHaveBeenCalledOnce();
    expect(fixture.mutate.mock.calls[0][1].projectIds).toEqual(["pa", "pc", "pb"]);
  });

  it("keeps one save in flight and ignores a failure from a previous account", async () => {
    let reject!: (cause: Error) => void;
    fixture.mutate.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    const key = () => (render().grip("c").props.onKeyDown as (event: unknown) => void)({ key: "ArrowUp", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    key(); key();
    expect(fixture.mutate).toHaveBeenCalledOnce();
    fixture.token = "second-account"; fixture.currentSession = false; render();
    reject(new Error("Previous account failed")); await flush();
    expect(render().html).not.toContain("Previous account failed");
    expect(fixture.query).not.toHaveBeenCalled();
    expect(render().grip("c").props.disabled).toBe(false);
  });
});
