import { GitBranch } from "lucide-react";

export function GitHubIssueIndicator({ number }: { number?: number }) {
  if (!number) return null;
  return <span className="github-issue-indicator" role="img" title={`Linked to GitHub issue #${number}`} aria-label={`Linked to GitHub issue #${number}`}><GitBranch size={13} aria-hidden="true" /></span>;
}
