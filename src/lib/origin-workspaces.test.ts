import { describe, expect, it } from "vitest";
import { activeWorkspace, movedOrder, sortProjects, workspaceOf } from "./origin-workspaces";

const state = { projectWorkspace: { kai: "second" }, order: ["yuki", "kai"], sort: "custom" as const, collapsed: false };
const projects = [
  { id: "kai", name: "Kai", updatedAt: 10 },
  { id: "ada", name: "Ada", updatedAt: 30 },
  { id: "yuki", name: "Yuki", updatedAt: 20 },
];

describe("Origin workspaces", () => {
  it("falls back to the first head when the saved one is gone", () => {
    expect(activeWorkspace({ ...state, active: "deleted" }, [{ id: "first" }, { id: "second" }])).toBe("first");
    expect(activeWorkspace({ ...state, active: "second" }, [{ id: "first" }, { id: "second" }])).toBe("second");
  });

  it("files an unassigned project under the default workspace", () => {
    expect(workspaceOf(state, "kai", "first")).toBe("second");
    expect(workspaceOf(state, "yuki", "first")).toBe("first");
  });

  it("sorts by custom order, recency or name", () => {
    expect(sortProjects(projects, state).map((p) => p.id)).toEqual(["yuki", "kai", "ada"]);
    expect(sortProjects(projects, { ...state, sort: "recent" }).map((p) => p.id)).toEqual(["ada", "yuki", "kai"]);
    expect(sortProjects(projects, { ...state, sort: "name" }).map((p) => p.id)).toEqual(["ada", "kai", "yuki"]);
  });

  it("moves a dragged project before or after its target", () => {
    expect(movedOrder(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(movedOrder(["a", "b", "c"], "a", "b", "after")).toEqual(["b", "a", "c"]);
  });
});
