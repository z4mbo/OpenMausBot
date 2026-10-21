import type { CloudUser } from "../../src/lib/origin-cloud/types";
import { ORIGIN_HOSTED_CONVEX_URL } from "../../shared/origin-site-address";

export type { CloudUser } from "../../src/lib/origin-cloud/types";
const params = new URLSearchParams(location.search);
export const fixtureBackend = params.get("connection") === "custom" ? "https://fixture.example.convex.cloud" : ORIGIN_HOSTED_CONVEX_URL;
const token = "origin-invites-synthetic-session";
const person: CloudUser = { _id: "fixtureowner", name: "Synthetic owner", email: "owner@example.test" };
const members = [
  { ...person, role: "owner", avatarUrl: null },
  { _id: "fixturemember", name: "Synthetic teammate", email: "teammate@example.test", role: "member", avatarUrl: null },
];
const invitations = [{ _id: "fixtureinvite", teamId: "fixtureteam", token: "a".repeat(64), email: "pending@example.test", role: "member", expiresAt: Date.now() + 5 * 86_400_000, createdAt: Date.now() }];
const noop = () => {};
export const cloudUrl = () => fixtureBackend;
export const useCloudUrl = cloudUrl;
export const setCloudUrl = noop;
export const sessionStore = { get: () => token, subscribe: () => noop };
export const useCloudToken = () => token;
export const useCloudSession = () => ({ ready: true, token, user: person, login: async () => {}, logout: async () => {} });
export function useCloudQuery<T = unknown>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  if (args === "skip") return undefined;
  if (name === "workspaces:access") return { teamId: "fixtureteam", slug: "synthetic-workspace", role: "owner" } as T;
  if (name === "workspaces:members") return members as T;
  if (name === "workspaces:invitations") return invitations as T;
  throw new Error(`Unexpected synthetic cloud query: ${name}`);
}
export const cloudMutation = async () => { throw new Error("This fixture permits only the visible invitation form"); };
export const cloudAction = cloudMutation;
export const cloudQueryOnce = cloudMutation;
export const useCloudLinks = () => ({ workspaces: {}, projects: {} });
export const linkCloudRecord = cloudMutation;
export const requestOriginSync = noop;
export const createOriginWorkspace = async (): Promise<{ teamId: string; slug: string }> => { throw new Error("The fixture has one workspace"); };
