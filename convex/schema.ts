import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { featureTables } from "./featureTables";
import { agentAttribution, agentsTables } from "./agentsTables";
import {
  assetTypeValidator,
  callSignalKindValidator,
  memberStatusValidator,
  priorityValidator,
  storedProjectStatusValidator,
  projectIconTypeValidator,
  roleValidator,
  taskAssetTypeValidator,
  tokenTypeValidator,
  userRoleValidator,
  userStatusValidator,
  wikiTypeValidator,
} from "./lib/validators";

export default defineSchema({
  ...featureTables,
  ...agentsTables,
  notifications: defineTable({ teamId: v.id("teams"), userId: v.id("users"), actorId: v.id("users"), kind: v.union(v.literal("assignment"), v.literal("comment"), v.literal("mention")), eventId: v.string(), projectId: v.optional(v.id("projects")), taskId: v.optional(v.id("tasks")), messageId: v.optional(v.string()), preview: v.optional(v.string()), read: v.boolean(), snoozedUntil: v.optional(v.number()), createdAt: v.number() })
    .index("by_user_team", ["userId", "teamId"])
    .index("by_user_team_read", ["userId", "teamId", "read"])
    .index("by_user_event", ["userId", "eventId"]),
  projectPresence: defineTable({ teamId: v.id("teams"), userId: v.id("users"), clientId: v.string(), projectId: v.optional(v.id("projects")), sequence: v.number(), updatedAt: v.number() })
    .index("by_team_user_client", ["teamId", "userId", "clientId"])
    .index("by_team_updatedAt", ["teamId", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),
  authAttempts: defineTable({ key: v.string(), count: v.number(), expiresAt: v.number() }).index("by_key", ["key"]),
  canvases: defineTable({ teamId: v.id("teams"), projectId: v.id("projects"), name: v.string(), archived: v.boolean(), drawingElementCount: v.optional(v.number()), drawingBytes: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number() }).index("by_project", ["projectId", "archived"]),
  drawingElements: defineTable({ teamId: v.id("teams"), canvasId: v.optional(v.id("canvases")), elementId: v.string(), version: v.number(), nonce: v.number(), data: v.string(), updatedAt: v.number() }).index("by_teamId", ["teamId"]).index("by_teamId_and_elementId", ["teamId", "elementId"]).index("by_scene", ["teamId", "canvasId", "elementId"]),
  drawingFiles: defineTable({ teamId: v.id("teams"), canvasId: v.optional(v.id("canvases")), fileId: v.string(), storageId: v.id("_storage"), mimeType: v.string() }).index("by_teamId", ["teamId"]).index("by_teamId_and_fileId", ["teamId", "fileId"]).index("by_scene", ["teamId", "canvasId", "fileId"]),
  drawingPresence: defineTable({ teamId: v.id("teams"), canvasId: v.optional(v.id("canvases")), userId: v.id("users"), name: v.string(), x: v.number(), y: v.number(), button: v.string(), updatedAt: v.number() }).index("by_teamId", ["teamId"]).index("by_teamId_and_userId", ["teamId", "userId"]).index("by_scene", ["teamId", "canvasId", "userId"]),
  users: defineTable({
    email: v.string(),
    name: v.string(),
    username: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    passwordHash: v.string(),
    salt: v.string(),
    iterations: v.number(),
    role: userRoleValidator,
    status: userStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"]),

  teams: defineTable({
    githubLogin: v.optional(v.string()),
    githubConnectedBy: v.optional(v.id("users")),
    githubAutoCreate: v.optional(v.boolean()),
    name: v.string(),
    drawingElementCount: v.optional(v.number()),
    drawingBytes: v.optional(v.number()),
    slug: v.optional(v.string()),
    ownerUserId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerUserId", ["ownerUserId"]).index("by_slug", ["slug"]),

  workspaceInvites: defineTable({
    teamId: v.id("teams"),
    projectId: v.optional(v.id("projects")),
    token: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("viewer")),
    createdBy: v.id("users"),
    expiresAt: v.number(),
    revoked: v.boolean(),
    createdAt: v.number(),
  }).index("by_token", ["token"]).index("by_teamId", ["teamId"]),

  teamMembers: defineTable({
    teamId: v.id("teams"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.string(),
    role: roleValidator,
    status: memberStatusValidator,
    inviteToken: v.optional(v.string()),
    invitedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    joinedAt: v.optional(v.number()),
  })
    .index("by_team", ["teamId"])
    .index("by_user", ["userId"])
    .index("by_email", ["email"])
    .index("by_team_email", ["teamId", "email"])
    .index("by_token", ["inviteToken"]),

  projects: defineTable({
    githubTaskMode: v.optional(v.union(v.literal("issue"), v.literal("pull_request"))),
    githubReviewColumnId: v.optional(v.union(v.id("columns"), v.null())),
    githubDoneColumnId: v.optional(v.id("columns")),
    githubRepoState: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("error"), v.literal("awaiting_connection"))),
    githubRepoError: v.optional(v.string()),
    githubRepoId: v.optional(v.number()),
    githubWorkspaceAccess: v.optional(v.boolean()),
    legacySourceKey: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
    order: v.optional(v.number()),
    openIssueCount: v.optional(v.number()),
    name: v.string(),
    description: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    status: storedProjectStatusValidator,
    accent: v.string(),
    iconType: v.optional(projectIconTypeValidator),
    iconValue: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    ownerEmail: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_githubRepoState", ["githubRepoState"])
    .index("by_repoUrl", ["repoUrl"])
    .index("by_owner", ["ownerEmail"])
    .index("by_legacySourceKey", ["legacySourceKey"])
    .index("by_team", ["teamId"]),

  members: defineTable({
    projectId: v.id("projects"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.string(),
    role: roleValidator,
    status: memberStatusValidator,
    inviteToken: v.optional(v.string()),
    invitedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    joinedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_email", ["email"])
    .index("by_project_email", ["projectId", "email"])
    .index("by_token", ["inviteToken"]),

  columns: defineTable({
    ...agentAttribution,
    projectId: v.id("projects"),
    title: v.string(),
    order: v.number(),
    isDone: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_order", ["projectId", "order"]),

  tasks: defineTable({
    githubTaskBranch: v.optional(v.string()),
    githubTaskMode: v.optional(v.union(v.literal("issue"), v.literal("pull_request"))),
    ...agentAttribution,
    labels: v.optional(v.array(v.string())),
    milestoneId: v.optional(v.id("milestones")),
    teamId: v.optional(v.id("teams")),
    completedAt: v.optional(v.number()),
    legacySourceKey: v.optional(v.string()),
    projectId: v.id("projects"),
    columnId: v.id("columns"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: priorityValidator,
    assignedToEmail: v.optional(v.string()),
    assignedToName: v.optional(v.string()),
    done: v.boolean(),
    dueDate: v.optional(v.string()),
    githubIssueNumber: v.optional(v.number()),
    githubIssueUrl: v.optional(v.string()),
    githubIssueState: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    githubIssueSyncedAt: v.optional(v.number()),
    githubIssueUpdatedAt: v.optional(v.number()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_teamId_and_done", ["teamId", "done"])
    .index("by_teamId_and_done_and_priority", ["teamId", "done", "priority"])
    .index("by_teamId_and_done_and_assignedToEmail", ["teamId", "done", "assignedToEmail"])
    .index("by_teamId_and_done_and_assignedToEmail_and_priority", ["teamId", "done", "assignedToEmail", "priority"])
    .index("by_projectId_and_done_and_priority", ["projectId", "done", "priority"])
    .index("by_projectId_and_done_and_assignedToEmail", ["projectId", "done", "assignedToEmail"])
    .index("by_projectId_and_done_and_assignedToEmail_and_priority", ["projectId", "done", "assignedToEmail", "priority"])
    .index("by_legacySourceKey", ["legacySourceKey"])
    .index("by_assignee", ["projectId", "assignedToEmail"])
    .index("by_assignedToEmail_and_done", ["assignedToEmail", "done"])
    .index("by_project_and_done", ["projectId", "done"])
    .index("by_column", ["columnId"])
    .index("by_column_order", ["columnId", "order"])
    .index("by_project_githubIssueNumber", ["projectId", "githubIssueNumber"])
    .index("by_githubTaskBranch", ["githubTaskBranch"])
    .index("by_githubIssueNumber", ["githubIssueNumber"])
    .index("by_milestoneId", ["milestoneId"])
    .index("by_teamId_and_dueDate", ["teamId", "dueDate"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["teamId", "projectId", "done"] }),

  connectorGrants: defineTable({
    teamId: v.id("teams"), userId: v.id("users"), tokenHash: v.string(), name: v.string(),
    agentAccess: v.optional(v.boolean()),
    hostId: v.optional(v.id("agentHosts")),
    runId: v.optional(v.id("workspaceAgentRuns")),
    write: v.boolean(), expiresAt: v.number(), createdAt: v.number(), revoked: v.boolean(),
  }).index("by_tokenHash", ["tokenHash"]).index("by_userId_and_teamId", ["userId", "teamId"])
    .index("by_userId_and_teamId_and_revoked", ["userId", "teamId", "revoked"])
    .index("by_userId_and_teamId_and_runId_and_hostId", ["userId", "teamId", "runId", "hostId"])
    .index("by_userId_and_teamId_and_runId_and_hostId_and_revoked", ["userId", "teamId", "runId", "hostId", "revoked"]),
  connectorOperations: defineTable({
    grantId: v.id("connectorGrants"), requestId: v.string(), result: v.string(),
  }).index("by_grantId_and_requestId", ["grantId", "requestId"]),

  taskCompletions: defineTable({
    teamId: v.id("teams"), projectId: v.id("projects"), taskId: v.id("tasks"),
    assignedToEmail: v.optional(v.string()), completedAt: v.number(),
  }).index("by_teamId_and_completedAt", ["teamId", "completedAt"])
    .index("by_teamId_and_assignedToEmail_and_completedAt", ["teamId", "assignedToEmail", "completedAt"])
    .index("by_taskId", ["taskId"]),

  taskComments: defineTable({
    ...agentAttribution,
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
    authorUserId: v.id("users"),
    authorName: v.string(),
    authorEmail: v.string(),
    body: v.string(),
    mentions: v.optional(v.array(v.object({ userId: v.id("users"), name: v.string(), email: v.string(), token: v.string() }))),
    references: v.optional(v.array(v.object({ type: v.union(v.literal("project"), v.literal("issue")), id: v.string(), projectId: v.id("projects"), label: v.string() }))),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_task", ["taskId"]),

  taskAssets: defineTable({
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
    commentId: v.optional(v.id("taskComments")),
    type: taskAssetTypeValidator,
    name: v.string(),
    url: v.string(),
    localFileId: v.optional(v.string()),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    notes: v.optional(v.string()),
    authorUserId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_localFileId", ["localFileId"])
    .index("by_task", ["taskId"]),

  commits: defineTable({
    projectId: v.id("projects"),
    sha: v.string(),
    message: v.string(),
    author: v.string(),
    url: v.optional(v.string()),
    committedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_sha", ["projectId", "sha"]),

  githubPullRequests: defineTable({
    projectId: v.id("projects"),
    number: v.number(),
    title: v.string(),
    state: v.union(v.literal("open"), v.literal("closed"), v.literal("merged")),
    url: v.string(),
    author: v.optional(v.string()),
    branch: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    syncedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_number", ["projectId", "number"])
    .index("by_project_and_updatedAt", ["projectId", "updatedAt"]),

  wikiPages: defineTable({
    ...agentAttribution,
    teamId: v.optional(v.id("teams")),
    collaborationState: v.optional(v.bytes()),
    projectId: v.id("projects"),
    title: v.string(),
    content: v.string(),
    type: wikiTypeValidator,
    tags: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_teamId_and_updatedAt", ["teamId", "updatedAt"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["teamId", "projectId"] })
    .searchIndex("search_content", { searchField: "content", filterFields: ["teamId", "projectId"] }),

  credentials: defineTable({
    projectId: v.id("projects"),
    kind: v.optional(v.union(
      v.literal("password"),
      v.literal("api_key"),
      v.literal("secret"),
      v.literal("note"),
      v.literal("apk"),
      v.literal("file"),
    )),
    title: v.string(),
    username: v.optional(v.string()),
    url: v.optional(v.string()),
    notes: v.optional(v.string()),
    ciphertext: v.string(),
    iv: v.string(),
    salt: v.string(),
    iterations: v.number(),
    kdf: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  designTokens: defineTable({
    projectId: v.id("projects"),
    type: tokenTypeValidator,
    name: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  designAssets: defineTable({
    ...agentAttribution,
    projectId: v.id("projects"),
    type: assetTypeValidator,
    name: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  chatMessages: defineTable({
    projectId: v.id("projects"),
    authorUserId: v.id("users"),
    authorName: v.string(),
    authorEmail: v.string(),
    body: v.string(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_createdAt", ["projectId", "createdAt"]),

  callParticipants: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    name: v.string(),
    username: v.optional(v.string()),
    email: v.string(),
    avatarStorageId: v.optional(v.id("_storage")),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_user", ["projectId", "userId"])
    .index("by_project_and_lastSeenAt", ["projectId", "lastSeenAt"]),

  callSignals: defineTable({
    projectId: v.id("projects"),
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    kind: callSignalKindValidator,
    payload: v.string(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_and_to", ["projectId", "toUserId"])
    .index("by_project_and_to_and_createdAt", ["projectId", "toUserId", "createdAt"])
    .index("by_project_and_from", ["projectId", "fromUserId"]),

  generalChatMessages: defineTable({
    authorUserId: v.id("users"),
    authorName: v.string(),
    authorEmail: v.string(),
    avatarStorageId: v.optional(v.id("_storage")),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  voiceParticipants: defineTable({
    userId: v.id("users"),
    name: v.string(),
    username: v.optional(v.string()),
    email: v.string(),
    avatarStorageId: v.optional(v.id("_storage")),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
    screenSharing: v.optional(v.boolean()),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_lastSeenAt", ["lastSeenAt"]),

  voiceSignals: defineTable({
    fromUserId: v.id("users"),
    toUserId: v.id("users"),
    kind: callSignalKindValidator,
    payload: v.string(),
    createdAt: v.number(),
  })
    .index("by_to", ["toUserId"])
    .index("by_to_and_createdAt", ["toUserId", "createdAt"])
    .index("by_from", ["fromUserId"]),
});
