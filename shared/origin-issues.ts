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
  githubIssueNumber?: number;
}

const closingLine = (issue: BriefedIssue) => (issue.githubIssueNumber ? ` whose description says "Closes #${issue.githubIssueNumber}"` : " that references the issue key");
const facts = (issue: BriefedIssue) => [
  issue.description ? `\n${issue.description}\n` : "",
  `Priority ${issue.priority}${issue.dueDate ? `, due ${issue.dueDate}` : ""}${issue.labels.length ? `, labels: ${issue.labels.join(", ")}` : ""}.`,
];

/** What an agent is told when an issue is handed to it, from the Issues page or by its Chief. */
export function issueBrief(issue: BriefedIssue): string {
  return [
    `You're assigned issue ${issue.key}: "${issue.title}" (Origin project ${issue.projectName}, issue id ${issue.id}${issue.githubIssueNumber ? `, GitHub issue #${issue.githubIssueNumber}` : ""}).`,
    ...facts(issue),
    "",
    "1. Read the issue with origin_get_issue and move it to In progress with origin_update_issue if it is not there yet.",
    "2. Work in the project's local repo on a new branch named after the issue key.",
    `3. Commit, push the branch and open a pull request${closingLine(issue)}.`,
    "4. Call origin_complete_issue with the pull request link and a short summary: it sends the pull request to the project's Chief, who reviews and merges it, and merging completes the issue.",
    "Ask me before anything you can't undo.",
  ].filter((line) => line !== "").join("\n");
}

/** What a project's Chief is told when an issue is handed to it, or marked complete while it still needs its pull request. */
export function implementBrief(issue: BriefedIssue): string {
  const github = issue.githubIssueNumber ? `GitHub issue #${issue.githubIssueNumber}` : "its GitHub issue";
  return [
    `Get issue ${issue.key}: "${issue.title}" (Origin project ${issue.projectName}, issue id ${issue.id}${issue.githubIssueNumber ? `, GitHub issue #${issue.githubIssueNumber}` : ""}) implemented. It completes when its pull request merges.`,
    ...facts(issue),
    "",
    "1. Move it to In progress with origin_update_issue if it is not there yet, then hand it with origin_assign_issue to the agent of this project best suited to it; implement it yourself only if none fits.",
    `2. The agent works on a new branch named after the issue key, opens a pull request${closingLine(issue)} and calls origin_complete_issue with its link, which sends it back to you.`,
    `3. Review it with origin_review_pr and merge it with origin_merge_pr once its checks pass; merging closes ${github} and completes ${issue.key}.`,
    "Ask me before anything you can't undo.",
  ].filter((line) => line !== "").join("\n");
}
