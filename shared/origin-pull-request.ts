/** A pull request a project Chief read with origin_review_pr, drawn in chat with its size, checks and review. */
export interface OriginPullRequestCard {
  projectId: string;
  projectName?: string;
  number: number;
  title: string;
  url: string;
  state: "draft" | "open" | "closed" | "merged";
  author?: string;
  branch?: string;
  baseBranch: string;
  /** The head the Chief read; a merge from the card is pinned to it, so a newer push is not merged unseen. */
  headSha: string;
  additions: number;
  deletions: number;
  files: number;
  /** "success", "failure", "pending", "none" or "unknown", as GitHub's check runs summarize. */
  checks: string;
  review?: "approved" | "changes_requested" | "review_required" | "commented";
  mergeable: boolean | null;
  /** Why it cannot merge now, in words; absent when it can. */
  blocker?: string;
  /** Origin issue keys (or #numbers) the pull request closes. */
  closes: string[];
}

export type PullRequestCardTone = "ready" | "waiting" | "blocked" | "done";

export function pullRequestCardTone(card: Pick<OriginPullRequestCard, "state" | "blocker" | "checks">): PullRequestCardTone {
  if (card.state === "merged" || card.state === "closed") return "done";
  if (card.blocker) return card.checks === "pending" ? "waiting" : "blocked";
  return "ready";
}
