import type { OriginPullRequestCard } from "../../shared/origin-pull-request.ts";
import { mergeBlocker, type PullDetail } from "./review.ts";

export function pullRequestCard(pr: PullDetail, projectId: string, projectName: string, issueKeys: Map<number, string>): OriginPullRequestCard {
  const blocker = mergeBlocker(pr);
  return {
    projectId, ...(projectName ? { projectName } : {}), number: pr.number, title: pr.title, url: pr.url, state: pr.state,
    ...(pr.author ? { author: pr.author } : {}), ...(pr.branch ? { branch: pr.branch } : {}), baseBranch: pr.baseBranch, headSha: pr.headSha,
    additions: pr.additions, deletions: pr.deletions, files: pr.files.length, checks: pr.checks ?? "unknown", ...(pr.review ? { review: pr.review } : {}),
    mergeable: pr.mergeable, ...(blocker ? { blocker } : {}), closes: pr.closes.map((n) => issueKeys.get(n) ?? `#${n}`),
  };
}
