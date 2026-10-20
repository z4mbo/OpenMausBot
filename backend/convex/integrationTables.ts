import { defineTable } from "convex/server";
import { v } from "convex/values";

export const githubAccountType = v.union(v.literal("User"), v.literal("Organization"));
export const repoVisibility = v.union(v.literal("private"), v.literal("public"));

export const integrationTables = {
  /** A workspace's GitHub connection, held by the backend so every member works through it. */
  teamGitHub: defineTable({
    teamId: v.id("teams"),
    /** Sealed JSON of the App's credentials and the connecting admin's user token. */
    sealed: v.string(),
    /** The account repositories are created in: the connecting admin's own or an organization the App is installed on. */
    accountLogin: v.string(),
    accountId: v.number(),
    accountType: githubAccountType,
    installationId: v.number(),
    connectorLogin: v.string(),
    connectorId: v.number(),
    sharedBy: v.id("users"),
    /** Bumped on every write of `sealed`, so a token refresh never overwrites a reconnect. */
    version: v.number(),
    updatedAt: v.number(),
  }).index("by_teamId", ["teamId"]),

  githubRepoJobs: defineTable({
    projectId: v.id("projects"),
    startedAt: v.number(),
    state: v.union(v.literal("working"), v.literal("done"), v.literal("error")),
  }).index("by_projectId", ["projectId"]),

  /** Integration keys an admin shared with a whole workspace (no projectId) or one project. */
  sharedKeys: defineTable({
    teamId: v.id("teams"),
    projectId: v.optional(v.id("projects")),
    integration: v.string(),
    sealed: v.string(),
    /** The non-secret fields, such as a sender address, readable by every member. */
    visible: v.record(v.string(), v.string()),
    sharedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_teamId_and_integration", ["teamId", "integration"]).index("by_projectId", ["projectId"]),

  /** A person's own GitHub account, proven through the Origin App's device sign-in. */
  githubUserLinks: defineTable({
    userId: v.id("users"),
    login: v.string(),
    githubId: v.number(),
    linkedAt: v.number(),
  }).index("by_userId", ["userId"]).index("by_githubId", ["githubId"]),

  /** Push access Origin gave a person's own GitHub account, so unlinking can take it back. */
  githubCollaborators: defineTable({
    userId: v.id("users"),
    repoUrl: v.string(),
    login: v.string(),
  }).index("by_userId", ["userId"]),

  githubDeviceFlows: defineTable({
    userId: v.id("users"),
    teamId: v.id("teams"),
    sealed: v.string(),
    expiresAt: v.number(),
  }).index("by_userId", ["userId"]).index("by_expiresAt", ["expiresAt"]),
};
