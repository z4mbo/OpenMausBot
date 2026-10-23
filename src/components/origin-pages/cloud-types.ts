export type Priority = "low" | "medium" | "high";
export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type GitHubTaskMode = "issue" | "pull_request";

export interface CloudProject {
  _id: string;
  teamId?: string;
  name: string;
  description?: string;
  repoUrl?: string;
  accent: string;
  iconType?: "default" | "emoji" | "icon" | "image";
  iconValue?: string;
  iconUrl?: string | null;
  memberRole: MemberRole;
  status: "active" | "inactive";
  githubTaskMode?: GitHubTaskMode;
  githubReviewColumnId?: string | null;
  githubDoneColumnId?: string;
  githubRepoState?: "pending" | "ready" | "error" | "awaiting_connection";
  githubRepoError?: string;
  githubWorkspaceAccess?: boolean;
  githubRepoVisibility?: "private" | "public";
}

export interface CloudColumn {
  _id: string;
  title: string;
  order: number;
  isDone?: boolean;
  isDraft?: boolean;
}

export interface CloudTask {
  _id: string;
  columnId: string;
  title: string;
  description?: string;
  priority: Priority;
  assignedToEmail?: string;
  assignedToName?: string;
  done: boolean;
  dueDate?: string;
  labels?: string[];
  milestoneId?: string;
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  githubIssueState?: "open" | "closed";
  githubTaskMode?: GitHubTaskMode;
  githubTaskBranch?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface CloudAssignee {
  email: string;
  name: string;
  username?: string;
  avatarUrl?: string | null;
}

export interface CloudBoard {
  columns: CloudColumn[];
  tasks: CloudTask[];
  assignees?: CloudAssignee[];
}

export interface CloudPerson extends CloudAssignee {
  _id: string;
  userId: string;
  role: MemberRole;
  status: "active";
}

export interface CloudComment {
  _id: string;
  authorName: string;
  authorEmail: string;
  body: string;
  createdAt: number;
}

export interface CloudTaskAsset {
  _id: string;
  commentId?: string;
  type: string;
  name: string;
  url: string;
  createdAt: number;
}

export interface CloudTaskDetails {
  task: CloudTask;
  columns: CloudColumn[];
  comments: CloudComment[];
  assets: CloudTaskAsset[];
  members: CloudPerson[];
}

export interface CloudTaskPullRequest {
  _id: string;
  number: number;
  url: string;
  branch?: string;
  state: "draft" | "open" | "closed" | "merged";
  checks: string;
  review: string;
  mergeable?: boolean | null;
  headSha?: string;
  baseSha?: string;
}

export type AssetType = "figma" | "image" | "video" | "audio" | "icon" | "font" | "document" | "apk" | "other";
export type TokenType = "color" | "typography" | "spacing" | "component" | "motion" | "other";

export interface CloudDesignAsset {
  _id: string;
  type: AssetType;
  name: string;
  url?: string;
  fileUrl?: string | null;
  contentType?: string;
  size?: number;
  notes?: string;
  folder?: string;
  studio?: { generationId: string; model: string; modelLabel: string; prompt: string };
  updatedAt: number;
}

export interface CloudDesignToken {
  _id: string;
  type: TokenType;
  name: string;
  value: string;
  description?: string;
}

export interface CloudDesign {
  tokens: CloudDesignToken[];
  assets: CloudDesignAsset[];
}

export type CredentialKind = "password" | "api_key" | "secret" | "note" | "apk" | "file" | "service";

export interface CloudCredential {
  _id: string;
  kind?: CredentialKind;
  service?: string;
  title: string;
  username?: string;
  url?: string;
  notes?: string;
  ciphertext: string;
  iv: string;
  salt: string;
  iterations: number;
  kdf: string;
  agentUse?: boolean;
  updatedAt: number;
}

export interface CloudFeedbackPortal {
  _id: string;
  projectId: string;
  slug: string;
  title: string;
  description: string;
  enabled: boolean;
}

export interface CloudFeedbackEntry {
  _id: string;
  title: string;
  body: string;
  kind: "bug" | "idea";
  status: "new" | "planned" | "completed" | "dismissed";
  taskId?: string;
  createdAt: number;
}

export interface CloudProjectMember {
  _id: string;
  email: string;
  name: string;
  role: MemberRole;
  status: string;
}
