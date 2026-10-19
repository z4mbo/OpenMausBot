import { appConfig, GitHubHttpError, githubRequest, type GitHubService } from "./service.ts";
import { repositoryPath, withInstallation } from "./app.ts";
import { checksSummary, syncPREvent } from "./prs.ts";
import type { OriginGitHub } from "../origin-cloud.ts";
import { mirrorTasks, projectConnection, syncGitHubEvent } from "./sync.ts";
import { readClosingIssueNumbers, readClosingIssuesForPulls } from "./closing-issues.ts";

export type PullState = "draft" | "open" | "closed" | "merged";
export type ReviewDecision = "approved" | "changes_requested" | "review_required" | "commented";

export interface PullSummary {
  number: number;
  title: string;
  url: string;
  author?: string;
  branch?: string;
  state: PullState;
  closes: number[];
  updatedAt: number;
  /** Only for open and draft pull requests. */
  checks?: string;
  review?: ReviewDecision;
}

export interface PullDetail extends PullSummary {
  baseBranch: string;
  defaultBranch: string;
  headSha: string;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  files: { name: string; status: string; additions: number; deletions: number }[];
  checkRuns: { name: string; status: string; conclusion: string | null }[];
}

type PullRow = {
  number: number; title?: string; html_url: string; state: "open" | "closed"; draft?: boolean; merged_at?: string | null; merged?: boolean;
  updated_at?: string; body?: string | null; user?: { login?: string }; head: { ref: string; sha: string }; base: { ref: string };
  mergeable?: boolean | null; additions?: number; deletions?: number; node_id?: string;
};
type CheckRuns = { total_count: number; check_runs: { name: string; status: string; conclusion: string | null }[] };

const OPEN_DETAIL_MAX = 15;
const FILES_MAX = 100;

export function pullState(pr: Pick<PullRow, "state" | "draft" | "merged_at" | "merged">): PullState {
  return pr.merged || pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
}

/** Each reviewer's latest decisive review counts, as on GitHub's own pull request page. */
export function reviewDecision(reviews: { user?: { login?: string } | null; state: string }[]): ReviewDecision {
  const latest = new Map<string, string>();
  let commented = false;
  for (const review of reviews) {
    if (review.state === "COMMENTED") { commented = true; continue; }
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latest.set(review.user?.login ?? "", review.state);
  }
  const states = [...latest.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  return commented ? "commented" : "review_required";
}

function summary(pr: PullRow, now: number, closes: number[] = []): PullSummary {
  const updatedAt = pr.updated_at ? Date.parse(pr.updated_at) : NaN;
  return {
    number: pr.number, title: pr.title || `Pull request #${pr.number}`, url: pr.html_url, state: pullState(pr), closes,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : now, branch: pr.head.ref, ...(pr.user?.login ? { author: pr.user.login } : {}),
  };
}

async function reviewOf(service: GitHubService, path: string, number: number, token: string): Promise<ReviewDecision> {
  return reviewDecision(await githubRequest<{ user?: { login?: string } | null; state: string }[]>(service, `${path}/pulls/${number}/reviews?per_page=100`, token));
}

async function checkRuns(service: GitHubService, path: string, sha: string, token: string): Promise<CheckRuns> {
  return githubRequest<CheckRuns>(service, `${path}/commits/${sha}/check-runs?filter=latest&per_page=100`, token);
}

/** Recent pull requests; open and draft ones carry their checks and review decision. */
export async function listPullRequests(service: GitHubService, repoUrl: string, token: string | undefined): Promise<PullSummary[]> {
  const path = repositoryPath(repoUrl);
  const rows = await githubRequest<PullRow[]>(service, `${path}/pulls?state=all&sort=updated&direction=desc&per_page=30`, token ?? "");
  const references = token ? await readClosingIssuesForPulls(service, repoUrl, rows.map((pr) => pr.number), token).catch(() => new Map<number, number[]>()) : new Map<number, number[]>();
  const now = service.now();
  let detailed = 0;
  return Promise.all(rows.map(async (pr) => {
    const base = summary(pr, now, references.get(pr.number));
    if (!token || pr.state !== "open" || detailed++ >= OPEN_DETAIL_MAX) return base;
    const [runs, review] = await Promise.all([
      checkRuns(service, path, pr.head.sha, token).catch(() => null),
      reviewOf(service, path, pr.number, token).catch(() => undefined),
    ]);
    return { ...base, checks: runs ? checksSummary(runs.check_runs, runs.total_count > runs.check_runs.length) : "unknown", ...(review ? { review } : {}) };
  }));
}

export async function readPullRequest(service: GitHubService, repoUrl: string, number: number, token: string): Promise<PullDetail> {
  const path = repositoryPath(repoUrl);
  const [pr, repository, files] = await Promise.all([
    githubRequest<PullRow>(service, `${path}/pulls/${number}`, token),
    githubRequest<{ default_branch: string }>(service, path, token),
    githubRequest<{ filename: string; status: string; additions: number; deletions: number }[]>(service, `${path}/pulls/${number}/files?per_page=${FILES_MAX}`, token),
  ]);
  const [runs, review, closes] = await Promise.all([checkRuns(service, path, pr.head.sha, token), reviewOf(service, path, number, token), readClosingIssueNumbers(service, repoUrl, number, token)]);
  return {
    ...summary(pr, service.now(), closes), checks: checksSummary(runs.check_runs, runs.total_count > runs.check_runs.length), review,
    baseBranch: pr.base.ref, defaultBranch: repository.default_branch, headSha: pr.head.sha, mergeable: pr.mergeable ?? null,
    additions: pr.additions ?? 0, deletions: pr.deletions ?? 0,
    files: files.map((file) => ({ name: file.filename, status: file.status, additions: file.additions, deletions: file.deletions })),
    checkRuns: runs.check_runs.map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion })),
  };
}

/** Why this pull request may not merge now, or null. */
export function mergeBlocker(pr: PullDetail): string | null {
  if (pr.state === "merged") return `#${pr.number} is already merged`;
  if (pr.state === "closed") return `#${pr.number} is closed`;
  if (pr.baseBranch !== pr.defaultBranch) return `#${pr.number} targets ${pr.baseBranch}, not the default branch ${pr.defaultBranch}`;
  if (pr.checks !== "success" && pr.checks !== "none") return `checks on #${pr.number} are ${pr.checks}; merge once they pass`;
  if (pr.review === "changes_requested") return `#${pr.number} has changes requested`;
  if (pr.mergeable === false) return `#${pr.number} has merge conflicts with ${pr.baseBranch}`;
  return null;
}

/** Approves the pull request; GitHub refuses an approval from its own author, which then leaves the comment as a review. */
export async function approvePullRequest(service: GitHubService, repoUrl: string, number: number, token: string, body: string): Promise<{ approved: boolean }> {
  const path = `${repositoryPath(repoUrl)}/pulls/${number}/reviews`;
  try {
    await githubRequest(service, path, token, { method: "POST", body: JSON.stringify({ event: "APPROVE", body }) });
    return { approved: true };
  } catch (error) {
    if (!(error instanceof GitHubHttpError) || error.status !== 422 || !body.trim()) throw error;
    await githubRequest(service, path, token, { method: "POST", body: JSON.stringify({ event: "COMMENT", body }) });
    return { approved: false };
  }
}

/** Merges into the default branch, pinned to the head that was checked, after marking a draft ready. */
export async function mergePullRequest(service: GitHubService, repoUrl: string, number: number, token: string, expectedHeadSha?: string): Promise<{ sha: string; detail: PullDetail }> {
  const detail = await readPullRequest(service, repoUrl, number, token);
  const blocked = mergeBlocker(detail);
  if (blocked) throw new Error(blocked);
  if (expectedHeadSha && expectedHeadSha !== detail.headSha) throw new Error(`#${number} changed since it was reviewed; read it again before merging`);
  if (detail.state === "draft") {
    const pr = await githubRequest<PullRow>(service, `${repositoryPath(repoUrl)}/pulls/${number}`, token);
    await githubRequest(service, "/graphql", token, {
      method: "POST", body: JSON.stringify({ query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}", variables: { id: pr.node_id } }),
    });
  }
  const merged = await githubRequest<{ sha: string; merged: boolean }>(service, `${repositoryPath(repoUrl)}/pulls/${number}/merge`, token, {
    method: "PUT", body: JSON.stringify({ sha: detail.headSha, merge_method: "squash", commit_title: `${detail.title} (#${number})` }),
  });
  if (!merged.merged) throw new Error(`GitHub did not merge #${number}`);
  return { sha: merged.sha, detail };
}

export async function mergeAndComplete(service: GitHubService, projectId: string, repoUrl: string, number: number, token: string, expectedHeadSha?: string): Promise<{ sha: string; completed: number[] }> {
  const { sha, detail } = await mergePullRequest(service, repoUrl, number, token, expectedHeadSha);
  const completed: number[] = [];
  await syncPREvent(service, repoUrl, [number]).catch((error: unknown) => console.warn("Merged pull request sync deferred", number, error instanceof Error ? error.message : error));
  for (const issue of detail.closes) {
    try {
      const observed = await githubRequest<{ number: number; state: string; pull_request?: unknown }>(service, `${repositoryPath(repoUrl)}/issues/${issue}`, token);
      if (observed.number !== issue || !["open", "closed"].includes(observed.state) || observed.pull_request) continue;
      const targets = await syncGitHubEvent(service, repoUrl, issue);
      let applied = false;
      for (const target of targets) {
        if (target.projectId !== projectId) continue;
        const accepted = await service.bridge<boolean>("completeMergedIssue", {
          projectId, taskId: target.taskId, repoUrl, issueNumber: issue,
          pullRequest: { number, headSha: detail.headSha, mergeSha: sha, mergedAt: service.now() },
        });
        applied ||= accepted;
      }
      if (applied) completed.push(issue);
    } catch (error) {
      console.warn("Merged issue sync deferred", projectId, issue, error instanceof Error ? error.message : error);
    }
  }
  return { sha, completed };
}

/** Adds `Closes #issue` to the pull request's description when it does not close that issue yet. */
export async function linkClosingReference(service: GitHubService, repoUrl: string, number: number, issueNumber: number, token: string): Promise<{ added: boolean; pull: PullSummary }> {
  const path = `${repositoryPath(repoUrl)}/pulls/${number}`;
  const pr = await githubRequest<PullRow>(service, path, token);
  const closes = await readClosingIssueNumbers(service, repoUrl, number, token);
  if (closes.includes(issueNumber)) return { added: false, pull: summary(pr, service.now(), closes) };
  if (pr.state !== "open") throw new Error(`#${number} is ${pullState(pr)}; link an open pull request`);
  const body = `${(pr.body ?? "").trimEnd()}\n\nCloses #${issueNumber}`.trim();
  const updated = await githubRequest<PullRow>(service, path, token, { method: "PATCH", body: JSON.stringify({ body }) });
  return { added: true, pull: summary(updated, service.now(), await readClosingIssueNumbers(service, repoUrl, number, token)) };
}

/**
 * Runs `fn` with this project's GitHub credential: the Origin App's installation on the project's repository when the
 * App can mint one, else the project's own connection. Security: never the legacy owner token or another project's.
 */
export async function withProjectGitHub<T>(service: GitHubService, projectId: string, fn: (token: string, repoUrl: string) => Promise<T>): Promise<T> {
  const { repoUrl, token } = await projectConnection(service, projectId);
  const config = appConfig(service);
  if (config?.appId && config.privateKey) return withInstallation(service, projectId, repoUrl, (installation) => fn(installation, repoUrl));
  if (!token) throw new Error("This project has no GitHub connection. A workspace admin connects GitHub in Settings > Integrations and authorizes the repository.");
  return fn(token, repoUrl);
}

/** What the Origin agent tools do on GitHub, each through the project's own connection. */
export function originGitHub(service: GitHubService): OriginGitHub {
  return {
    async mirrorIssue(projectId, taskId) {
      const [result] = await mirrorTasks(service, projectId, [taskId]);
      return result;
    },
    linkPullRequest: (projectId, number, issueNumber) => withProjectGitHub(service, projectId, (token, repoUrl) => linkClosingReference(service, repoUrl, number, issueNumber, token)),
    pullRequests: (projectId) => withProjectGitHub(service, projectId, (token, repoUrl) => listPullRequests(service, repoUrl, token)),
    pullRequest: (projectId, number) => withProjectGitHub(service, projectId, (token, repoUrl) => readPullRequest(service, repoUrl, number, token)),
    approve: (projectId, number, body) => withProjectGitHub(service, projectId, (token, repoUrl) => approvePullRequest(service, repoUrl, number, token, body)),
    merge: (projectId, number, headSha) => withProjectGitHub(service, projectId, (token, repoUrl) => mergeAndComplete(service, projectId, repoUrl, number, token, headSha)),
    repository: (projectId) => withProjectGitHub(service, projectId, async (token, repoUrl) =>
      ({ defaultBranch: (await githubRequest<{ default_branch: string }>(service, repositoryPath(repoUrl), token)).default_branch })),
  };
}
