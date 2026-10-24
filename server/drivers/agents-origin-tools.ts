import { STANDUP_TOOL_DEFINITIONS } from "./agents-standup-tools.ts";
import { BRAND_TOOL_DEFINITIONS } from "./agents-brand-tools.ts";
import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

const ORIGIN_ISSUE_ID = { type: "string", minLength: 1, maxLength: 64, description: "Issue id or ORI- key from origin_list_issues." };
const ORIGIN_PRIORITY = { type: "string", enum: ["low", "medium", "high"] };
const ORIGIN_CARDS = " The person sees issue cards; do not repeat them.";

export const ORIGIN_TOOL_DEFINITIONS = [
  {
    name: "origin_list_projects",
    description: "List your own Origin project, or a workspace head's managed projects, with each one's Chief, agents and bot ids. If Origin is not connected or nothing is linked, tell the person.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "origin_list_issues",
    description: "List Origin issues (column, priority, assignee, due, labels), filtered by status, priority, assignee or text: which are open, urgent (high priority) or whose, and their ids. A Chief without a project of its own gets every project it reaches." + ORIGIN_CARDS + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["open", "done", "all"], description: "Default open." },
        priority: ORIGIN_PRIORITY,
        assignee: { type: "string", maxLength: 120, description: "Part of an assignee's name or email." },
        query: { type: "string", maxLength: 120, description: "Text in the key, title, description or labels." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_get_issue",
    description: "Read one Origin issue in full: description, comments, attachments, pull requests with checks and review, labels and related issues." + ORIGIN_CARDS + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { issue_id: ORIGIN_ISSUE_ID, project: ORIGIN_PROJECT }, required: ["issue_id"] },
  },
  {
    name: "origin_create_issue",
    description: "Create an Origin issue for work to track or a bug or follow-up you found. Check origin_list_issues first for a duplicate." + ORIGIN_CARDS + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 250 },
        description: { type: "string", maxLength: 60_000, description: "Markdown." },
        priority: { ...ORIGIN_PRIORITY, description: "Default medium." },
        labels: { type: "array", maxItems: 20, items: { type: "string", maxLength: 32 } },
        column: { type: "string", description: "Column title or id; default Draft, which gets no GitHub issue until moved out of it." },
        assignee: { type: "string", description: "Member email; default you, the signed-in user." },
        due_date: { type: "string", description: "YYYY-MM-DD; default one week from today." },
        project: ORIGIN_PROJECT,
      },
      required: ["title"],
    },
  },
  {
    name: "origin_update_issue",
    description: "Change an Origin issue: title, description, priority, labels, assignee, due date, column or done. A done column marks it done unless you pass done. Finish your own work with origin_complete_issue." + ORIGIN_CARDS + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        issue_id: ORIGIN_ISSUE_ID,
        title: { type: "string", minLength: 1, maxLength: 250 },
        description: { type: "string", maxLength: 60_000 },
        priority: ORIGIN_PRIORITY,
        done: { type: "boolean" },
        column: { type: "string", description: "Column title or id to move the issue to." },
        assignee: { type: "string", description: "Email of an active project member." },
        due_date: { type: "string", description: "YYYY-MM-DD." },
        labels: { type: "array", maxItems: 20, items: { type: "string", maxLength: 32 }, description: "Replaces all labels." },
        project: ORIGIN_PROJECT,
      },
      required: ["issue_id"],
    },
  },
  {
    name: "origin_delete_issue",
    description: "Permanently delete an Origin issue and its comments and attachments. Use completion for finished work; deletion removes the record." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { issue_id: ORIGIN_ISSUE_ID, project: ORIGIN_PROJECT }, required: ["issue_id"] },
  },
  {
    name: "origin_comment_issue",
    description: "Comment on an Origin issue: progress, a finding, a question or a result. Members are notified; keep it short." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { issue_id: ORIGIN_ISSUE_ID, text: { type: "string", minLength: 1, maxLength: 8_000, description: "Markdown." }, project: ORIGIN_PROJECT },
      required: ["issue_id", "text"],
    },
  },
  {
    name: "origin_assign_issue",
    description: "Hand an Origin issue to an agent of its project's team, or to the Chief of a project you manage, through coordinate_bots in a new thread: it branches, opens a pull request and finishes with origin_complete_issue. The issue gets the agent's label and moves to In progress. The result resumes you; end your turn." + ORIGIN_CARDS + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        issue_id: ORIGIN_ISSUE_ID,
        bot_id: { type: "string", minLength: 1, maxLength: 128, description: "Bot id from origin_list_projects, or a unique name." },
        instructions: { type: "string", maxLength: 1_000, description: "Optional extra direction for the agent." },
        project: ORIGIN_PROJECT,
      },
      required: ["issue_id", "bot_id"],
    },
  },
  {
    name: "origin_complete_issue",
    description: "Finish your work on an Origin issue: links your pull request to its GitHub issue (adds \"Closes #n\"), comments the summary, moves it to review and asks the project's Chief to review and merge. The issue is done only when the pull request merges; never mark it done yourself. In a project with a GitHub repository, pull_request_url is required." + ORIGIN_CARDS + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        issue_id: ORIGIN_ISSUE_ID,
        summary: { type: "string", minLength: 1, maxLength: 6_000, description: "What was done, in Markdown." },
        pull_request_url: { type: "string", maxLength: 500, description: "https://github.com/<owner>/<repo>/pull/<number> in the project's repository." },
        project: ORIGIN_PROJECT,
      },
      required: ["issue_id", "summary"],
    },
  },
  {
    name: "origin_review_pr",
    description: "As a project's Chief, review its pull requests: list the open ones (checks, review, the issues each closes), read one (changed files, checks, whether it can merge), or approve it with a review comment. Merge with origin_merge_pr." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list", "read", "approve"], description: "Default list." },
        number: { type: "integer", minimum: 1, description: "Pull request number, for read and approve." },
        comment: { type: "string", maxLength: 4_000, description: "Review comment for approve." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_merge_pr",
    description: "As a project's Chief, merge a reviewed pull request into the default branch once its checks pass. Irreversible, always asks the person first, and completes the issues it closes. Read it with origin_review_pr first and pass the head_sha it reports." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        number: { type: "integer", minimum: 1, description: "Pull request number." },
        head_sha: { type: "string", maxLength: 64, description: "The head SHA origin_review_pr read reported, so a newer push is not merged unseen." },
        project: ORIGIN_PROJECT,
      },
      required: ["number", "head_sha"],
    },
  },
  {
    name: "origin_list_assets",
    description: "List an Origin project's design assets (with links) and tokens, to reuse its logos, images and colours." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_add_asset",
    description: "Add a design asset to an Origin project: a link (url) or a file from your working folder (path, at most 15 MB)." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 150 },
        type: { type: "string", enum: ["figma", "image", "video", "audio", "icon", "font", "document", "apk", "other"], description: "Default other." },
        url: { type: "string", maxLength: 2_000, description: "http(s) link; url or path, not both." },
        path: { type: "string", maxLength: 1_000, description: "A file in your working folder." },
        notes: { type: "string", maxLength: 1_000 },
        project: ORIGIN_PROJECT,
      },
      required: ["name"],
    },
  },
  {
    name: "origin_vault_store",
    description: "Store an API key from an encrypted Vault JSON file in your working folder. Payload: ciphertext, iv, salt, iterations, kdf (PBKDF2-SHA256/AES-256-GCM). Never pass plaintext or a passphrase. A member must permit agent use and unlock it before reading its value." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { title: { type: "string", minLength: 1, maxLength: 150 }, path: { type: "string", minLength: 1, maxLength: 1_000 }, project: ORIGIN_PROJECT }, required: ["title", "path"] },
  },
  {
    name: "origin_vault_list",
    description: "List an Origin project's vault and the signed-in person's: titles, kinds, URLs, usernames, and the values (a service sign-in's as env vars) members let agents use and unlocked here. Ask for any other with request_credential." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_repo_status",
    description: "Show an Origin project's repository: URL, clone command and default branch, the project's folder on this computer (empty, or the branch checked out), open pull requests with checks and review, and recent commits." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_team_chat",
    description: "Read the latest messages of an Origin project's team chat, where its members and agents talk." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 20." }, project: ORIGIN_PROJECT },
    },
  },
  {
    name: "origin_team_chat_post",
    description: "Post a message in an Origin project's team chat under your own name, for the project's members to read." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { text: { type: "string", minLength: 1, maxLength: 4_000, description: "Markdown." }, project: ORIGIN_PROJECT },
      required: ["text"],
    },
  },
  {
    name: "origin_feedback",
    description: "List the feedback an Origin project's users sent through its public portal (bugs and ideas), or read one item in full with entry_id." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["open", "new", "planned", "completed", "dismissed", "all"], description: "Default open (new and planned)." },
        entry_id: { type: "string", maxLength: 64, description: "Feedback id from the list, to read it in full." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  ...STANDUP_TOOL_DEFINITIONS, ...BRAND_TOOL_DEFINITIONS,
];

export const ORIGIN_TOOL_NAMES: ReadonlySet<string> = new Set(ORIGIN_TOOL_DEFINITIONS.map((tool) => tool.name));
