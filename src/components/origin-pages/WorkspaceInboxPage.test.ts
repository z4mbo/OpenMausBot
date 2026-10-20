// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ linked: false, done: false, repoUrl: "", projectRole: "member", open: vi.fn(() => true), mutation: vi.fn(async () => null) }));
vi.mock("@/lib/origin-cloud", () => ({
  cloudMutation: fixture.mutation,
  useCloudQuery: (name: string) => name === "projects:listForUser" ? [{ _id: "project", name: "Fixture", repoUrl: fixture.repoUrl, memberRole: fixture.projectRole }] : name === "notifications:summary" ? { unread: 0, more: false } : { events: [], truncated: false },
  useCloudPages: (name: string) => ({ status: "done", loadMore: vi.fn(), results: name === "inbox:list" ? [{ _id: "task", projectId: "project", title: "Fixture issue", projectName: "Fixture", priority: "medium", done: fixture.done, githubIssueNumber: fixture.linked ? 12 : undefined }] : [] }),
}));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceMembers: () => [] }));
vi.mock("@/lib/origin-issue-focus", () => ({ useOpenOriginIssue: () => fixture.open }));
vi.mock("@/lib/origin-notification-open", () => ({ useOpenOriginNotification: () => vi.fn() }));
const { WorkspaceInbox } = await import("./WorkspaceInboxPage");
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(() => { flushSync(() => root.unmount()); host.replaceChildren(); root = createRoot(host); fixture.open.mockClear(); fixture.mutation.mockClear(); fixture.linked = false; fixture.done = false; fixture.repoUrl = ""; fixture.projectRole = "member"; });
const toggle = () => {
  flushSync(() => root.render(createElement(WorkspaceInbox, { teamId: "team", role: "owner", canEdit: true, me: { _id: "user", email: "user@example.test" } })));
  flushSync(() => host.querySelector<HTMLButtonElement>(`button[aria-label="${fixture.done ? "Reopen" : "Complete"} Fixture issue"]`)!.click());
};
describe("workspace completion workflow", () => {
  it.each(["linked issue", "repository project"])("opens %s for PR completion instead of requesting direct completion", (kind) => {
    if (kind === "linked issue") fixture.linked = true;
    else fixture.repoUrl = "https://github.com/fixture/origin";
    toggle();
    expect(fixture.open).toHaveBeenCalledWith({ projectId: "project", issueId: "task" });
    expect(fixture.mutation).not.toHaveBeenCalled();
  });
  it("can complete a local issue with no repository", () => {
    toggle();
    expect(fixture.mutation).toHaveBeenCalledWith("tasks:updateTask", { projectId: "project", taskId: "task", done: true });
  });
  it("can reopen a completed GitHub issue", () => {
    fixture.done = true;
    fixture.linked = true;
    toggle();
    expect(fixture.mutation).toHaveBeenCalledWith("tasks:updateTask", { projectId: "project", taskId: "task", done: false });
  });
  it("leaves an issue alone in a project the person only views", () => {
    fixture.projectRole = "viewer";
    toggle();
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Complete Fixture issue"]')!.disabled).toBe(true);
    expect(fixture.mutation).not.toHaveBeenCalled();
  });
});
