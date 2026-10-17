export type OriginIssuePriority = "low" | "medium" | "high";

/** One Origin issue as an Origin tool showed it in chat. */
export interface OriginIssueCard {
  id: string;
  key: string;
  projectId: string;
  projectName?: string;
  title: string;
  /** The board column, or "Done". */
  status: string;
  done: boolean;
  priority: OriginIssuePriority;
  assignee?: string;
  /** YYYY-MM-DD. */
  due?: string;
  labels?: string[];
}

/** Issues an Origin tool created, changed, fetched or listed; each opens in its project's Issues section. */
export interface OriginIssueCards {
  heading: string;
  issues: OriginIssueCard[];
  /** Matching issues left out of `issues`. */
  more?: number;
}

export const ORIGIN_ISSUE_CARDS_MAX = 12;

export function originIssueKey(id: string): string {
  return `ORI-${id.slice(-4).toUpperCase()}`;
}

export interface BriefedIssue {
  id: string;
  key: string;
  projectName: string;
  title: string;
  description?: string;
  priority: string;
  dueDate?: string;
  labels: readonly string[];
}

/** What an agent is told when an issue is handed to it, from the Issues page or by its Chief. */
export function issueBrief(issue: BriefedIssue): string {
  return [
    `You're assigned issue ${issue.key}: "${issue.title}" (Origin project ${issue.projectName}, issue id ${issue.id}).`,
    issue.description ? `\n${issue.description}\n` : "",
    `Priority ${issue.priority}${issue.dueDate ? `, due ${issue.dueDate}` : ""}${issue.labels.length ? `, labels: ${issue.labels.join(", ")}` : ""}.`,
    "",
    "1. Read the issue with origin_get_issue and move it to In progress with origin_update_issue if it is not there yet.",
    "2. Work in the project's local repo on a new branch named after the issue key.",
    "3. Commit, push the branch and open a pull request that references the issue key.",
    "4. Call origin_complete_issue with the pull request link and a short summary: stage review while the pull request waits for review, done once it is merged or nothing is left to do.",
    "Ask me before anything you can't undo.",
  ].filter((line) => line !== "").join("\n");
}
