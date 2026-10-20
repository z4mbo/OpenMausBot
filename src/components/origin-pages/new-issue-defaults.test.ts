// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudBoard } from "./cloud-types";

const fixture = vi.hoisted(() => ({ board: {} as CloudBoard, mutations: vi.fn(async () => "created-task") }));
const person = { _id: "member", email: "me@example.test", name: "Member" };
vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => "https://fixture.convex.cloud",
  useCloudSession: () => ({ ready: true, user: { _id: "user" }, token: "fixture" }),
  cloudMutation: fixture.mutations,
  useCloudQuery: (name: string) => {
    if (name === "projects:get") return { _id: "project", teamId: "team", name: "Fixture", memberRole: "owner" };
    if (name === "tasks:board") return fixture.board;
    if (name === "members:people") return [person];
    if (name === "feedback:portals") return [{ _id: "portal", projectId: "project", slug: "fixture", title: "Feedback", enabled: false }];
    if (name === "feedback:list") return [{ _id: "feedback", title: "Request", body: "A report", kind: "bug", status: "new", createdAt: 1 }];
    return [];
  },
}));
vi.mock("@/lib/origin-github", () => ({ originGitHub: { mirrorIssues: vi.fn(async () => ({ results: [] })) } }));
vi.mock("@/lib/origin-members", () => ({ useAppAddress: () => "https://fixture.example.test", feedbackLink: () => "https://fixture.example.test/feedback/fixture" }));
const { NewIssueComposer } = await import("./NewIssueComposer");
const { FeedbackPage } = await import("./FeedbackPage");
const { IssuesPage } = await import("./IssuesPage");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
const columns = [{ _id: "todo", title: "Todo", order: 0 }, { _id: "draft", title: "Private planning", order: 20, isDraft: true }];
const click = (node: HTMLElement) => flushSync(() => node.click());
const field = (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => flushSync(() => {
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement || node.type === "date" ? "change" : "input", { bubbles: true }));
});
const submit = async () => {
  flushSync(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(fixture.mutations).toHaveBeenCalled());
};
beforeEach(() => { fixture.board = { columns, tasks: [] }; fixture.mutations.mockClear(); });
afterEach(() => { flushSync(() => root.unmount()); host.replaceChildren(); root = createRoot(host); });
const composer = (initialColumnId?: string) => {
  flushSync(() => root.render(createElement(NewIssueComposer, { projects: [{ id: "project", name: "Fixture" }], initialProjectId: "project", initialColumnId, myEmail: person.email, onClose() {}, onCreated() {} })));
  field(document.querySelector<HTMLTextAreaElement>('[aria-label="Issue title"]')!, "New issue");
  field(document.querySelector<HTMLInputElement>('input[type="date"]')!, "2026-11-01");
};
const feedback = () => {
  flushSync(() => root.render(createElement(FeedbackPage, { cloudProjectId: "project", projectName: "Fixture" })));
  click([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Convert to issue"))!);
  const selects = document.querySelectorAll<HTMLSelectElement>("select");
  field(selects[1], person.email);
  field(document.querySelector<HTMLInputElement>('input[type="date"]')!, "2026-11-01");
  return selects[0];
};

describe("new issue destinations", () => {
  it("places semantic Draft first in a stale board without changing task destinations", () => {
    fixture.board = { columns, tasks: [{ _id: "existing", columnId: "todo", title: "Existing issue", priority: "medium", done: false, order: 0, createdAt: 1, updatedAt: 1 }] };
    flushSync(() => root.render(createElement(IssuesPage, { cloudProjectId: "project", projectName: "Fixture" })));
    expect([...host.querySelectorAll<HTMLElement>("[data-column-id]")].map((node) => node.dataset.columnId)).toEqual(["draft", "todo"]);
    expect(host.querySelector('[data-column-id="todo"] [data-task-id="existing"]')).not.toBeNull();
    expect(fixture.mutations).not.toHaveBeenCalled();
  });
  it("uses the backend transaction to repair legacy Idea instead of racing a client rename", async () => {
    fixture.board = { columns: [{ _id: "idea", title: "Idea", order: 0 }, columns[0]], tasks: [] };
    flushSync(() => root.render(createElement(IssuesPage, { cloudProjectId: "project", projectName: "Fixture" })));
    await vi.waitFor(() => expect(fixture.mutations).toHaveBeenCalledWith("tasks:ensureDefaultColumns", { projectId: "project" }));
    expect(fixture.mutations).not.toHaveBeenCalledWith("tasks:updateColumn", expect.anything());
  });
  it("shows renamed semantic Draft and leaves an unspecified composer destination to the backend", async () => {
    composer();
    expect(document.querySelector('[aria-label="Status: Private planning"]')).not.toBeNull();
    await submit();
    expect(fixture.mutations).toHaveBeenCalledWith("tasks:createTask", expect.not.objectContaining({ columnId: expect.anything() }));
  });
  it("preserves an explicit lane destination", async () => {
    composer("todo");
    expect(document.querySelector('[aria-label="Status: Todo"]')).not.toBeNull();
    await submit();
    expect(fixture.mutations).toHaveBeenCalledWith("tasks:createTask", expect.objectContaining({ columnId: "todo" }));
  });
  it("preserves a status the person explicitly selects", async () => {
    composer();
    click(document.querySelector<HTMLElement>('[aria-label="Status: Private planning"]')!);
    click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent === "Todo")!);
    await submit();
    expect(fixture.mutations).toHaveBeenCalledWith("tasks:createTask", expect.objectContaining({ columnId: "todo" }));
  });
  it("repairs missing Draft on a nonempty board without submitting into Todo", async () => {
    fixture.board = { columns: [columns[0]], tasks: [] };
    composer();
    await vi.waitFor(() => expect(fixture.mutations).toHaveBeenCalledWith("tasks:ensureDefaultColumns", { projectId: "project" }));
    expect(document.querySelector('[aria-label="Status: Todo"]')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
  it("converts feedback to semantic Draft even when Todo has the lowest order", async () => {
    const select = feedback();
    expect(select.value).toBe("draft");
    await submit();
    expect(fixture.mutations).toHaveBeenCalledWith("feedback:convert", expect.not.objectContaining({ columnId: expect.anything() }));
  });
  it("preserves an explicitly chosen feedback destination", async () => {
    field(feedback(), "todo");
    await submit();
    expect(fixture.mutations).toHaveBeenCalledWith("feedback:convert", expect.objectContaining({ columnId: "todo" }));
  });
  it("leaves feedback with no Draft to backend defaulting rather than the first column", async () => {
    fixture.board = { columns: [columns[0]], tasks: [] };
    expect(feedback().selectedOptions[0].textContent).toBe("Draft");
    await submit();
    expect(fixture.mutations).toHaveBeenCalledWith("feedback:convert", expect.not.objectContaining({ columnId: expect.anything() }));
  });
});

describe("new issue draft", () => {
  it("keeps the title and description when the person picks another project", () => {
    flushSync(() => root.render(createElement(NewIssueComposer, { projects: [{ id: "project", name: "Fixture" }, { id: "other", name: "Other" }], initialProjectId: "project", myEmail: person.email, onClose() {}, onCreated() {} })));
    field(document.querySelector<HTMLTextAreaElement>('[aria-label="Issue title"]')!, "Keep me");
    field(document.querySelector<HTMLTextAreaElement>('[aria-label="Issue description"]')!, "And me");
    click(document.querySelector<HTMLButtonElement>('button[title="Change project"]')!);
    click([...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((option) => option.textContent?.includes("Other"))!);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Issue title"]')!.value).toBe("Keep me");
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Issue description"]')!.value).toBe("And me");
  });
});
