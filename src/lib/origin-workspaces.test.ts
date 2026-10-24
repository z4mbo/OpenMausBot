import { describe, expect, it } from "vitest";
import { activeWorkspace, inWorkspace, movedOrder, sortProjects, switchableWorkspaceHeads, workspaceHeadsOf, workspaceSectionKeys } from "./origin-workspaces";

const view = { order: ["yuki", "kai"], sort: "custom" as const, collapsed: false };
const projects = [
  { id: "kai", name: "Kai", updatedAt: 10 },
  { id: "ada", name: "Ada", updatedAt: 30 },
  { id: "yuki", name: "Yuki", updatedAt: 20 },
];

describe("Origin workspaces", () => {
  it("lists workspace heads oldest first and ignores project Chiefs", () => {
    const bots = [
      { id: "ggs", section: "Workspace: GGs", chiefOfStaff: true },
      { id: "kai", section: "Kai", chiefOfStaff: true },
      { id: "rio", section: "Workspace: Rio", chiefOfStaff: true },
    ];
    expect(workspaceHeadsOf(bots).map((bot) => bot.id)).toEqual(["rio", "ggs"]);
  });

  it("keeps a pinned head switchable so its workspace stays the open one", () => {
    const bots = [
      { id: "ggs", section: "Workspace: GGs", chiefOfStaff: true },
      { id: "rio", section: "Workspace: Rio", chiefOfStaff: true, pinned: true },
      { id: "old", section: "Workspace: Old", chiefOfStaff: true, hidden: true },
    ];
    const heads = switchableWorkspaceHeads(bots);
    expect(heads.map((bot) => bot.id)).toEqual(["rio", "ggs"]);
    expect(activeWorkspace({ ...view, active: "rio" }, heads)).toBe("rio");
  });

  it("falls back to the first head when the saved one is gone", () => {
    expect(activeWorkspace({ ...view, active: "deleted" }, [{ id: "first" }, { id: "second" }])).toBe("first");
    expect(activeWorkspace({ ...view, active: "second" }, [{ id: "first" }, { id: "second" }])).toBe("second");
  });

  it("shows a project only in the workspace whose head manages its team", () => {
    const rio = { id: "rio", managedSections: ["Kai", "Yuki"] };
    expect(inWorkspace(rio, { section: "Kai" })).toBe(true);
    expect(inWorkspace(rio, { section: "Other" })).toBe(false);
    expect(inWorkspace(undefined, { section: "Other" })).toBe(true);
  });

  it("sorts by custom order, recency or name", () => {
    expect(sortProjects(projects, view).map((p) => p.id)).toEqual(["yuki", "kai", "ada"]);
    expect(sortProjects(projects, { ...view, sort: "recent" }).map((p) => p.id)).toEqual(["ada", "yuki", "kai"]);
    expect(sortProjects(projects, { ...view, sort: "name" }).map((p) => p.id)).toEqual(["ada", "kai", "yuki"]);
  });

  it("shares canonical linked order while retaining a separate local-only order", () => {
    expect(sortProjects(projects, view, ["kai", "yuki"]).map(project => project.id)).toEqual(["kai", "yuki", "ada"]);
    expect(sortProjects(projects, { ...view, order: ["ada", "yuki", "kai"] }, ["kai", "yuki"]).map(project => project.id)).toEqual(["kai", "yuki", "ada"]);
    expect(sortProjects(projects, { ...view, sort: "name" }, ["kai", "yuki"]).map(project => project.id)).toEqual(["ada", "kai", "yuki"]);
  });

  it("moves a dragged project before or after its target", () => {
    expect(movedOrder(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(movedOrder(["a", "b", "c"], "a", "b", "after")).toEqual(["b", "a", "c"]);
  });
});

describe("workspaceSectionKeys", () => {
  it("lists the head's own section, its projects and templates once, then standalone agents", () => {
    expect(workspaceSectionKeys({ id: "h", section: "Workspace: GGs", chiefOfStaff: true, managedSections: ["Kai", " Kai ", "Agents", "SEO Team"] }))
      .toEqual(["Workspace: GGs", "Kai", "SEO Team", "Agents"]);
  });
});
