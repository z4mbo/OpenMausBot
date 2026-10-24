// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudTask } from "./cloud-types";

const columns = [{ _id: "draft", title: "Draft", order: 0, isDraft: true }, { _id: "todo", title: "Todo", order: 1 }];
const fixture = vi.hoisted(() => ({
  tasks: [] as CloudTask[],
  mutations: vi.fn(async (..._args: unknown[]) => null),
  mirror: vi.fn(async (..._args: unknown[]) => ({ results: [] })),
}));
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => "https://fixture.convex.cloud",
  useCloudSession: () => ({ ready: true, user: { _id: "fixture-user" }, token: "fixture" }),
  cloudMutation: fixture.mutations,
  useCloudQuery: (name: string) => {
    if (name === "projects:get") return { _id: "project", name: "Fixture", memberRole: "owner", repoUrl: "https://github.com/fixture/app" };
    if (name === "tasks:board") return { columns, tasks: fixture.tasks };
    if (name === "tasks:details") return { task: fixture.tasks[0], columns, comments: [], members: [], assets: [] };
    return [];
  },
}));
vi.mock("@/lib/origin-github", () => ({ originGitHub: { mirrorIssues: fixture.mirror } }));
const { IssuesPage } = await import("./IssuesPage");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(() => {
  flushSync(() => root.unmount());
  host.replaceChildren();
  document.querySelectorAll("[data-pointer-menu]").forEach((node) => node.remove());
  root = createRoot(host);
  fixture.mutations.mockClear();
  fixture.mirror.mockClear();
});

const task = (patch: Partial<CloudTask> = {}): CloudTask => ({ _id: "task", columnId: "todo", title: "Linked work", priority: "medium", done: false, order: 0, createdAt: 1, updatedAt: 1, githubIssueNumber: 7, githubIssueUrl: "https://github.com/fixture/app/issues/7", githubIssueState: "open", ...patch });
const render = (tasks: CloudTask[]) => {
  fixture.tasks = tasks;
  flushSync(() => root.render(createElement(IssuesPage, { cloudProjectId: "project", projectName: "Fixture" })));
};
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim().startsWith(label) || node.querySelector(`[aria-label="${label}"]`));
const rightClick = (target: Element, x = 120, y = 90) => flushSync(() => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y })); });
const menu = () => document.querySelector<HTMLElement>("[data-pointer-menu]");
const labels = () => [...menu()!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
const choose = async (label: string) => {
  const item = [...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === label)!;
  flushSync(() => item.click());
  await vi.waitFor(() => expect(fixture.mutations).toHaveBeenCalled());
};

describe("issue context menu", () => {
  it("opens at the pointer on a board card, completes without a pull request and syncs the GitHub issue", async () => {
    render([task()]);
    const card = host.querySelector('[data-task-id="task"]')!;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 });
    flushSync(() => { card.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(menu()!.getAttribute("aria-label")).toBe("Actions for Linked work");
    expect(labels()).toEqual(["Complete", "Move to Draft", "Delete"]);
    expect(host.contains(menu())).toBe(false);
    await choose("Complete");
    expect(fixture.mutations).toHaveBeenCalledExactlyOnceWith("tasks:updateTask", { projectId: "project", taskId: "task", done: true });
    await vi.waitFor(() => expect(fixture.mirror).toHaveBeenCalledWith("project", ["task"]));
    expect(document.body.textContent).not.toContain("Done when its pull request merges");
  });

  it("moves a list row back to Draft, and hides that choice for an issue already in Draft", async () => {
    render([task(), task({ _id: "parked", columnId: "draft", title: "Parked", githubIssueNumber: undefined, githubIssueUrl: undefined, githubIssueState: undefined })]);
    flushSync(() => button("List view")!.click());
    rightClick([...host.querySelectorAll("li")].find((row) => row.textContent?.includes("Parked"))!);
    expect(labels()).toEqual(["Complete", "Delete"]);
    flushSync(() => { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await vi.waitFor(() => expect(menu()).toBeNull());
    rightClick([...host.querySelectorAll("li")].find((row) => row.textContent?.includes("Linked work"))!);
    await choose("Move to Draft");
    expect(fixture.mutations).toHaveBeenCalledWith("tasks:moveTask", { projectId: "project", taskId: "task", columnId: "draft" });
    await vi.waitFor(() => expect(fixture.mirror).toHaveBeenCalledWith("project", ["task"]));
  });

  it("offers Reopen for a completed issue and closes on a press outside", async () => {
    render([task({ done: true, githubIssueState: "closed" })]);
    flushSync(() => button("Done")!.click());
    rightClick([...host.querySelectorAll("li")].find((row) => row.textContent?.includes("Linked work"))!);
    expect(labels()).toEqual(["Reopen", "Move to Draft", "Delete"]);
    flushSync(() => { host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    await vi.waitFor(() => expect(menu()).toBeNull());
    rightClick([...host.querySelectorAll("li")].find((row) => row.textContent?.includes("Linked work"))!);
    await choose("Reopen");
    expect(fixture.mutations).toHaveBeenCalledWith("tasks:updateTask", { projectId: "project", taskId: "task", done: false });
    await vi.waitFor(() => expect(fixture.mirror).toHaveBeenCalledWith("project", ["task"]));
  });
});

describe("issue detail GitHub chips", () => {
  it("links an existing GitHub issue and never offers to create one", () => {
    render([task(), task({ _id: "unlinked", title: "Unlinked", githubIssueNumber: undefined, githubIssueUrl: undefined, githubIssueState: undefined })]);
    flushSync(() => host.querySelector<HTMLElement>('[data-task-id="task"]')!.click());
    const link = document.querySelector<HTMLAnchorElement>('a[href="https://github.com/fixture/app/issues/7"]');
    expect(link?.textContent).toContain("#7");
    fixture.tasks = [fixture.tasks[1]!, fixture.tasks[0]!];
    flushSync(() => root.render(createElement(IssuesPage, { cloudProjectId: "project", projectName: "Fixture" })));
    expect(document.body.textContent).not.toContain("Create GitHub issue");
  });
});
