// The Campaigns fixture's @/lib/origin-cloud with the account calls the workspace sync makes and paginated
// queries, so the signed-in account's workspace head, Inbox and notifications show real fixture data.
import { cloudQueryOnce, useCloudQuery } from "./origin-campaigns-cloud.ts";

export * from "./origin-campaigns-cloud.ts";

export const cloud = {
  workspaces: { list: () => cloudQueryOnce("workspaces:list") },
  projects: { listForUser: (teamId?: string) => cloudQueryOnce("projects:listForUser", teamId ? { teamId } : {}) },
};

export function useCloudPages<T>(name: string, args: Record<string, unknown> | "skip", numItems: number) {
  const page = useCloudQuery<{ page: T[] }>(name, args === "skip" ? "skip" : { ...args, paginationOpts: { numItems, cursor: null } });
  return { results: page?.page ?? [], status: args === "skip" || page ? "done" : "loading", loadMore() {} };
}
