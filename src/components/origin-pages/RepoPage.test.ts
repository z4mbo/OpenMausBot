import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CloudBoard, CloudTask } from "./cloud-types";

const cloud = vi.hoisted(() => ({ board: { columns: [], tasks: [] } as CloudBoard }));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => "https://fixture.convex.cloud",
  useCloudSession: () => ({ ready: true, user: { _id: "fixture-user" }, token: "fixture" }),
  useCloudQuery: (name: string) => name === "projects:get" ? { _id: "fixture-project", name: "Fixture", memberRole: "owner", repoUrl: "https://github.com/fixture/origin" } : cloud.board,
}));
const { RepoPage } = await import("./RepoPage");
const task = (id: string, columnId: string): CloudTask => ({ _id: id, columnId, title: id, priority: "medium", done: false, order: 0, createdAt: 1, updatedAt: 1 });
const render = () => renderToStaticMarkup(createElement(RepoPage, { cloudProjectId: "fixture-project", projectName: "Fixture" }));
describe("repository issue mirroring controls", () => {
  it("does not offer Draft issues for publication", () => {
    cloud.board = { columns: [{ _id: "draft", title: "Draft", order: 0, isDraft: true }], tasks: [task("private-plan", "draft")] };
    expect(render()).not.toContain("on GitHub</button>");
  });
  it("counts only open non-Draft issues without a GitHub link", () => {
    cloud.board = { columns: [{ _id: "draft", title: "Draft", order: 0, isDraft: true }, { _id: "todo", title: "Todo", order: 1 }], tasks: [task("private-plan", "draft"), task("ready", "todo"), { ...task("closed", "todo"), done: true }, { ...task("linked", "todo"), githubIssueNumber: 12 }] };
    expect(render()).toContain("Create 1 on GitHub");
    expect(render()).not.toContain("Create 2 on GitHub");
  });
});
