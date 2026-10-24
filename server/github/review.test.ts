import { describe, expect, it } from "vitest";

import { mergeBlocker, reviewDecision, type PullDetail } from "./review.ts";
import { isRepositoryName, repositoryNameFor } from "../../shared/github-repo-name.ts";
import { issueStateMove } from "./sync.ts";
import { draftBody } from "./prs.ts";
import { implementBrief, issueBrief } from "../../shared/origin-issues.ts";

describe("review decision", () => {
  it("counts each reviewer's latest decisive review", () => {
    expect(reviewDecision([])).toBe("review_required");
    expect(reviewDecision([{ user: { login: "a" }, state: "COMMENTED" }])).toBe("commented");
    expect(reviewDecision([{ user: { login: "a" }, state: "CHANGES_REQUESTED" }, { user: { login: "a" }, state: "APPROVED" }])).toBe("approved");
    expect(reviewDecision([{ user: { login: "a" }, state: "APPROVED" }, { user: { login: "b" }, state: "CHANGES_REQUESTED" }])).toBe("changes_requested");
  });
});

describe("merge blockers", () => {
  const ready: PullDetail = {
    number: 3, title: "x", url: "https://github.com/a/b/pull/3", state: "open", closes: [], updatedAt: 1, checks: "success", review: "approved",
    baseBranch: "main", defaultBranch: "main", headSha: "a".repeat(40), mergeable: true, additions: 1, deletions: 0, files: [], checkRuns: [],
  };
  it("allows only an open pull request into the default branch with passing checks and no conflicts", () => {
    expect(mergeBlocker(ready)).toBeNull();
    expect(mergeBlocker({ ...ready, checks: "none" })).toBeNull();
    expect(mergeBlocker({ ...ready, checks: "pending" })).toContain("pending");
    expect(mergeBlocker({ ...ready, baseBranch: "dev" })).toContain("not the default branch");
    expect(mergeBlocker({ ...ready, mergeable: false })).toContain("conflicts");
    expect(mergeBlocker({ ...ready, review: "changes_requested" })).toContain("changes requested");
    expect(mergeBlocker({ ...ready, state: "merged" })).toContain("already merged");
  });
});

describe("issue state sync", () => {
  it("pushes an Origin change, pulls a GitHub change, and lets GitHub win when both moved", () => {
    expect(issueStateMove({ done: true, githubIssueState: "open" }, "open")).toBe("close");
    expect(issueStateMove({ done: false, githubIssueState: "closed", githubIssueReopenRequested: true }, "closed")).toBe("reopen");
    expect(issueStateMove({ done: false, githubIssueState: "closed" }, "closed")).toBe("pull");
    expect(issueStateMove({ done: false, githubIssueState: "open" }, "closed")).toBe("pull");
    expect(issueStateMove({ done: true, githubIssueState: "closed" }, "open")).toBe("pull");
    expect(issueStateMove({ done: true, githubIssueState: "closed" }, "closed")).toBe("pull");
    expect(issueStateMove({ done: true }, "open")).toBe("pull");
  });

  it("removes the GitHub issue of any issue in Draft, whatever its GitHub state", () => {
    expect(issueStateMove({ done: false, draft: true, githubIssueState: "open" }, "open")).toBe("remove");
    expect(issueStateMove({ done: false, draft: true, githubIssueState: "closed" }, "closed")).toBe("remove");
    expect(issueStateMove({ done: false, draft: true, githubIssueState: "closed" }, "open")).toBe("remove");
    expect(issueStateMove({ done: true, draft: true, githubIssueState: "open" }, "open")).toBe("remove");
    expect(issueStateMove({ done: false, draft: false, githubIssueState: "closed", githubIssueReopenRequested: true }, "closed")).toBe("reopen");
  });
});

describe("repository names", () => {
  it("names the repository like the project, within GitHub's rules", () => {
    expect(repositoryNameFor("My App")).toBe("My-App");
    expect(repositoryNameFor("Café / Déjà vu!")).toBe("Cafe-Deja-vu");
    expect(repositoryNameFor("..hidden..")).toBe("hidden");
    expect(repositoryNameFor("???")).toBe("project");
    expect(repositoryNameFor("x".repeat(150))).toHaveLength(100);
    expect(isRepositoryName("My-App_2.0")).toBe(true);
    expect(isRepositoryName("bad name")).toBe(false);
    expect(isRepositoryName("..")).toBe(false);
  });
});

describe("pull request pipeline text", () => {
  const issue = { id: "k17abcd", key: "ORI-ABCD", projectName: "Widgets", title: "Fix login", priority: "high", labels: [], githubIssueNumber: 5 };

  it("a draft pull request closes the task's GitHub issue", () => {
    expect(draftBody({ description: "Build it", githubIssueNumber: 5 })).toBe("Build it\n\nCloses #5");
    expect(draftBody({ githubIssueNumber: 5 })).toBe("Closes #5");
    expect(draftBody({ description: "Build it" })).toBe("Build it");
  });

  it("tells the agent to close the GitHub issue, and the lead to open the pull request and ask before merging", () => {
    expect(issueBrief(issue)).toContain('open a pull request whose description says "Closes #5"');
    const lead = implementBrief(issue);
    expect(lead).not.toContain("origin_assign_issue");
    expect(lead).toContain("ask me to merge it");
    expect(lead).toContain("Merging closes GitHub issue #5 and completes ORI-ABCD");
    expect(implementBrief({ ...issue, githubIssueNumber: undefined })).toContain("that references the issue key");
  });
});
