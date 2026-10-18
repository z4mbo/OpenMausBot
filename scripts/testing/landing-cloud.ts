import type { CloudUser } from "../../src/lib/origin-cloud/types";
export * from "../../src/lib/origin-cloud/index";

export const person: CloudUser = { _id: "landing-member", username: "maya", name: "Maya Chen", email: "maya@example.test" };
const project = { _id: "landingproject", teamId: "landingworkspace", name: "Website relaunch", description: "Marketing website and account onboarding", accent: "green", memberRole: "owner", status: "active", githubTaskMode: "pull_request" };
const columns = [{ _id: "landing-draft", title: "Draft", order: 0, isDraft: true }, { _id: "landing-todo", title: "Todo", order: 1 }, { _id: "landing-progress", title: "In Progress", order: 2 }, { _id: "landing-done", title: "Done", order: 3, isDone: true }];
const titles = [["Explore the mobile onboarding flow", "Write the pricing page copy"], ["Design the download page", "Check keyboard navigation"], ["Ship the Windows installer link", "Polish the project settings"], ["Review the release checklist"]];
const tasks = titles.flatMap((names, lane) => names.map((title, index) => ({ _id: `landingtask${(lane + 1) * 1000 + index + 1}`, projectId: project._id, projectName: project.name, columnId: columns[lane]!._id, title, description: "", priority: index ? "medium" : "high", done: lane === 3, order: index, labels: [], assignedToEmail: person.email, assignedToName: person.name, createdAt: 1792231200000, updatedAt: 1792231200000 })));
const people = [{ _id: "landing-membership", userId: person._id, email: person.email, name: person.name, role: "owner", status: "active", avatarUrl: null }];
const rows: Record<string, unknown> = { "auth:me": person, "projects:get": project, "projects:listForUser": [project], "tasks:board": { columns, tasks, assignees: people }, "members:people": people, "members:list": people, "workspaces:access": { teamId: project.teamId, slug: "northwind-demo", role: "owner" }, "notifications:summary": { unread: 0, more: false }, "notifications:list": [], "taskPRs:list": [], "inbox:list": [] };

export const cloudUrl = () => location.origin;
export const useCloudUrl = cloudUrl;
export const useCloudSession = () => ({ ready: true, token: "landing-synthetic-session", user: person, login: async () => {}, logout: async () => {} });
export function useCloudQuery<T = unknown>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  return args === "skip" ? undefined : rows[name] as T | undefined;
}
export function useCloudPages<T>(name: string, args: Record<string, unknown> | "skip") {
  return { results: useCloudQuery<T[]>(name, args) ?? [], status: "done" as const, loadMore() {} };
}
export const cloudMutation = async () => { throw new Error("This preview uses sample data. Changes are not saved."); };
export const cloudAction = cloudMutation;
export const cloudQueryOnce = async <T>(name: string): Promise<T> => rows[name] as T;
