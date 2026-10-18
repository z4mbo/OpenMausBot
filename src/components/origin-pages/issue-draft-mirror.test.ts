// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudBoard } from "./cloud-types";

const fixture = vi.hoisted(() => ({ board: {} as CloudBoard, mirror: vi.fn(async () => ({ results: [] })), mutate: vi.fn(async () => null) }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => "https://fixture.example.test",
  useCloudSession: () => ({ ready: true, user: { _id: "user" }, token: "fixture" }),
  cloudMutation: fixture.mutate,
  useCloudQuery: (name: string) => name === "projects:get" ? { _id: "project", name: "Fixture", memberRole: "owner", repoUrl: "https://github.com/fixture/origin" }
    : name === "tasks:board" ? fixture.board : [],
}));
vi.mock("@/lib/origin-github", () => ({ originGitHub: { mirrorIssues: fixture.mirror } }));
const { IssuesPage } = await import("./IssuesPage");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(() => { flushSync(() => root.unmount()); root = createRoot(host); fixture.mirror.mockClear(); fixture.mutate.mockClear(); });
const render = (columns: CloudBoard["columns"]) => {
  fixture.board = { columns, tasks: columns.map((column, index) => ({ _id: `task-${column._id}`, columnId: column._id, title: column.title, priority: "medium", done: false, order: index, createdAt: 1, updatedAt: 1 })) };
  flushSync(() => root.render(createElement(IssuesPage, { cloudProjectId: "project", projectName: "Fixture" })));
};
describe("legacy Draft privacy before board repair", () => {
  it("holds the legacy Idea that backend repair will adopt, while mirroring ordinary Todo", () => {
    render([{ _id: "idea", title: "Idea", order: 0 }, { _id: "todo", title: "Todo", order: 1 }]);
    expect(fixture.mirror).toHaveBeenCalledExactlyOnceWith("project", ["task-todo"]);
    expect(fixture.mutate).toHaveBeenCalledWith("tasks:ensureDefaultColumns", { projectId: "project" });
  });
  it("keeps Idea ordinary when a semantic Draft already exists", () => {
    render([{ _id: "draft", title: "Private planning", order: 0, isDraft: true }, { _id: "idea", title: "Idea", order: 1 }]);
    expect(fixture.mirror).toHaveBeenCalledExactlyOnceWith("project", ["task-idea"]);
  });
  it("keeps an explicitly non-Draft Idea ordinary", () => {
    render([{ _id: "idea", title: "Idea", order: 0, isDraft: false }]);
    expect(fixture.mirror).toHaveBeenCalledExactlyOnceWith("project", ["task-idea"]);
  });
});
