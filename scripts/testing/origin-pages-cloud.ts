import { useSyncExternalStore } from "react";
import type { CloudUser } from "../../src/lib/origin-cloud/types";
import type { CloudBoard, CloudProject, MemberRole } from "../../src/components/origin-pages/cloud-types";
export type { CloudUser } from "../../src/lib/origin-cloud/types";
export type { CloudProject, CloudWorkspace } from "../../src/lib/origin-cloud/types";

const params = new URLSearchParams(location.search);
export const fixtureMode = params.get("state") ?? "populated";
const now = Date.now();
const role = (["viewer", "member", "admin"].includes(params.get("role") ?? "") ? params.get("role") : "owner") as MemberRole;
export const fixtureMe: CloudUser = { _id: "fixture-user", email: "user@example.test", name: "Fixture user" };
export const fixtureProject: CloudProject = { _id: "fixture-project", teamId: "fixture-team", name: "Fixture project", description: "A synthetic project for production page verification", accent: "green", memberRole: role, status: "active", repoUrl: fixtureMode === "empty" ? undefined : "https://github.com/fixture/origin", githubTaskMode: "pull_request" };
const people = [{ _id: "fixture-member", userId: fixtureMe._id, email: fixtureMe.email, name: fixtureMe.name, role, status: "active", avatarUrl: null }, { _id: "fixture-other-member", userId: "fixture-other", email: "other@example.test", name: "Fixture teammate with a long display name", role: "member", status: "active", avatarUrl: null }];
const columns = [{ _id: "fixture-draft", title: "Draft", order: 0, isDraft: true }, { _id: "fixture-todo", title: "Todo", order: 1 }, { _id: "fixture-progress", title: "In Progress", order: 2 }, { _id: "fixture-done", title: "Done", order: 3, isDone: true }];
const date = new Date(now).toLocaleDateString("en-CA");
export const fixtureTasks = [{ _id: "fixture-task-one", projectId: fixtureProject._id, projectName: fixtureProject.name, columnId: columns[1]._id, title: "Inspect the synthetic release workflow", description: "Verify the production editor and its property controls.", priority: "high" as const, done: false, assignedToEmail: fixtureMe.email, assignedToName: fixtureMe.name, dueDate: date, labels: ["verification"], githubIssueNumber: 12, githubIssueUrl: "https://github.com/fixture/origin/issues/12", order: 0, createdAt: now, updatedAt: now }, { _id: "fixture-task-draft", projectId: fixtureProject._id, projectName: fixtureProject.name, columnId: columns[0]._id, title: "A private draft that must remain off GitHub", priority: "medium" as const, done: false, order: 0, createdAt: now, updatedAt: now }];
export const fixtureBoard: CloudBoard = { columns, tasks: fixtureMode === "empty" ? [] : fixtureTasks, assignees: people };
const rows: Record<string, unknown> = {
  "auth:me": { ...fixtureMe, username: "fixture-user", avatarUrl: null },
  "projects:listForUser": [fixtureProject], "tasks:board": fixtureBoard, "members:people": people, "members:list": people,
  "workspaces:access": { teamId: "fixture-team", slug: "fixture", role }, "workspaces:members": people,
  "workspaces:invitations": fixtureMode === "empty" ? [] : [{ _id: "fixture-invite", teamId: "fixture-team", token: "synthetic-invite-token", email: "invitee@example.test", role: "member", expiresAt: now + 86_400_000, createdAt: now }],
  "taskPRs:columns": columns.map((column) => ({ id: column._id, title: column.title, isDone: !!column.isDone })),
  "tasks:details": { task: fixtureTasks[0], columns, members: people, comments: [{ _id: "fixture-comment", authorName: "Fixture teammate", authorEmail: "other@example.test", body: "The synthetic issue is ready for review.", createdAt: now }], assets: [] },
  "taskPRs:list": [],
  "design:list": { assets: fixtureMode === "empty" ? [] : [{ _id: "fixture-asset", name: "Release workflow documentation with a long filename", type: "document", url: "https://example.test/release", notes: "Synthetic documentation for this project.", updatedAt: now }], tokens: fixtureMode === "empty" ? [] : [{ _id: "fixture-token", name: "Project accent", type: "color", value: "#77c59b", description: "Synthetic project colour" }] },
  "credentials:list": [],
  "feedback:portals": fixtureMode === "empty" ? [] : [{ _id: "fixture-portal", projectId: fixtureProject._id, slug: "fixture-project", title: "Fixture feedback", description: "Synthetic feedback portal", enabled: true }],
  "feedback:list": [{ _id: "fixture-feedback", title: "Keyboard navigation needs attention", body: "A synthetic report with a long URL https://example.test/" + "a".repeat(80), kind: "bug", status: "new", createdAt: now }],
  "notifications:summary": { unread: 1, more: false },
  "notifications:list": fixtureMode === "empty" ? [] : [{ _id: "fixture-notification", kind: "mention", read: false, createdAt: now, actorName: "Fixture teammate", actorAvatar: null, projectId: fixtureProject._id, projectName: fixtureProject.name, taskId: fixtureTasks[0]._id, taskTitle: fixtureTasks[0].title, available: true, preview: "Please inspect the workflow" }],
  "inbox:list": fixtureMode === "empty" ? [] : fixtureTasks,
  "inbox:activity": { events: [], truncated: false }, "inbox:calendar": { tasks: fixtureMode === "empty" ? [] : fixtureTasks.slice(0, 1), truncated: false },
};
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => version;
const rerender = () => { version++; for (const listener of listeners) listener(); };
export const fixtureCalls: { name: string; args: Record<string, unknown> }[] = [];
Object.assign(window, { originPagesFixture: { calls: fixtureCalls, getQuery(name: string) { return rows[name]; }, setQuery(name: string, value: unknown) { rows[name] = value; rerender(); }, setRole(role: MemberRole) { fixtureProject.memberRole = role; (rows["workspaces:access"] as { role: MemberRole }).role = role; rerender(); } } });
export const useCloudUrl = () => location.origin;
export const cloudUrl = () => location.origin;
export const setCloudUrl = (_url: string | null) => {};
export const useCloudSession = () => ({ ready: true, user: fixtureMe, token: "origin-pages-isolated-fixture", login: async () => {}, logout: async () => {} });
export function useCloudQuery<T = unknown>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  useSyncExternalStore(subscribe, snapshot);
  if (args === "skip") return undefined;
  if (name === "projects:get") return (fixtureMode === "denied" ? null : { ...fixtureProject, _id: args.projectId, name: args.projectId === "fixture-other-project" ? "Other fixture project" : fixtureProject.name }) as T;
  if (fixtureMode === "loading") return undefined;
  return rows[name] as T | undefined;
}
export function useCloudPages<T>(name: string, args: Record<string, unknown> | "skip", _pageSize: number) {
  const value = useCloudQuery<T[]>(name, args);
  return { results: value ?? [], status: (value ? "done" : "loading") as "done" | "loading", loadMore() {} };
}
export async function cloudMutation<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  fixtureCalls.push({ name, args });
  if (fixtureMode === "error") throw new Error("Synthetic mutation failure. Try again.");
  if (name === "credentials:create") { rows["credentials:list"] = [...rows["credentials:list"] as unknown[], { _id: "fixture-credential", ...args, updatedAt: Date.now() }]; rerender(); }
  if (name === "tasks:createTask" || name === "feedback:convert") return "fixture-created-task" as T;
  return null as T;
}
export const cloudAction = cloudMutation;
export const cloudQueryOnce = async <T>(name: string): Promise<T> => rows[name] as T;
