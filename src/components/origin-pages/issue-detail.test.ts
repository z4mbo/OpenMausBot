// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudTask } from "./cloud-types";

const fixture = vi.hoisted(() => ({ task: {} as CloudTask, mutations: vi.fn(async () => null) }));
const columns = [{ _id: "todo", title: "Todo", order: 0 }];
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => "https://fixture.convex.cloud",
  useCloudSession: () => ({ ready: true, user: { _id: "fixture-user" }, token: "fixture" }),
  cloudMutation: fixture.mutations,
  useCloudQuery: (name: string) => {
    if (name === "projects:get") return { _id: "project", name: "Fixture", memberRole: "owner" };
    if (name === "tasks:board") return { columns, tasks: [fixture.task] };
    if (name === "tasks:details") return { task: fixture.task, columns, comments: [], members: [], assets: [] };
    return [];
  },
}));
vi.mock("@/lib/origin-github", () => ({ originGitHub: { mirrorIssues: vi.fn(async () => ({ results: [] })) } }));
const { IssuesPage } = await import("./IssuesPage");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(() => { flushSync(() => root.unmount()); host.replaceChildren(); root = createRoot(host); fixture.mutations.mockClear(); });
const render = () => flushSync(() => root.render(createElement(IssuesPage, { cloudProjectId: "project", projectName: "Fixture" })));
const open = () => {
  fixture.task = { _id: "task", columnId: "todo", title: "Original title", description: "Original description", priority: "medium", done: false, order: 0, createdAt: 1, updatedAt: 1 };
  render();
  flushSync(() => host.querySelector<HTMLElement>('[data-task-id="task"]')!.click());
  render();
};
const field = (label: string) => host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
const input = (label: string, value: string) => flushSync(() => {
  const node = field(label);
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
});
describe("issue editor collaboration", () => {
  it("follows a remote update while the editor has no local changes", () => {
    open();
    fixture.task = { ...fixture.task, title: "Changed by a teammate" };
    render();
    expect(field("Issue title").value).toBe("Changed by a teammate");
    expect(host.textContent).not.toContain("Save changes");
  });
  it("saves the locally edited title without overwriting a teammate's description", async () => {
    open();
    input("Issue title", "My local title");
    fixture.task = { ...fixture.task, description: "New teammate description" };
    render();
    expect(field("Issue title").value).toBe("My local title");
    expect(field("Issue description").value).toBe("New teammate description");
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === "Save changes")!.click());
    await Promise.resolve();
    expect(fixture.mutations).toHaveBeenCalledWith("tasks:updateTask", { projectId: "project", taskId: "task", title: "My local title" });
  });
  it("follows later remote changes after a saved local edit is acknowledged", () => {
    open();
    input("Issue title", "My saved title");
    fixture.task = { ...fixture.task, title: "My saved title" };
    render();
    render();
    fixture.task = { ...fixture.task, title: "Teammate changed the saved title" };
    render();
    expect(field("Issue title").value).toBe("Teammate changed the saved title");
  });
  it("treats a title saved without its surrounding space as saved", () => {
    open();
    input("Issue title", "Trimmed title ");
    expect(host.textContent).toContain("Save changes");
    fixture.task = { ...fixture.task, title: "Trimmed title" };
    render();
    render();
    expect(host.textContent).not.toContain("Save changes");
  });
  it("does not carry a local draft into a different selected task", () => {
    open();
    input("Issue title", "Unsaved first task title");
    fixture.task = { ...fixture.task, _id: "second", title: "Second task title" };
    render();
    flushSync(() => host.querySelector<HTMLElement>('[data-task-id="second"]')!.click());
    render();
    expect(field("Issue title").value).toBe("Second task title");
  });
});
