import { nextReleaseTag, type DeploymentState, type MergedPull, type ReleaseCandidate, type ShipDeployment, type ShipTarget } from "../../shared/origin-ship.ts";
import { parseGitHubRepo } from "../github/repo.ts";
import { withProjectGitHub } from "../github/review.ts";
import { GitHubHttpError, type GitHubService } from "../github/service.ts";
import { DEPLOYMENTS_SHOWN, providerRequest, ShipError, type ShipHttp } from "./providers.ts";

type Json = Record<string, unknown>;

/** Ship's GitHub work on a project's repository, through the project's own GitHub connection. */
export interface ShipGitHub {
  candidate(projectId: string, repoUrl: string): Promise<ReleaseCandidate & { bodies: Record<number, string> }>;
  createRelease(projectId: string, repoUrl: string, release: { tag: string; title: string; notes: string }): Promise<{ url: string }>;
  runs(projectId: string, repoUrl: string, target: ShipTarget): Promise<ShipDeployment[]>;
  dispatch(projectId: string, repoUrl: string, target: ShipTarget): Promise<void>;
  rerun(projectId: string, repoUrl: string, runId: string): Promise<void>;
}

const ACTIONS = { actions: "write" } as const;
const CANDIDATE_PULLS = 50;

const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function repoPath(repoUrl: string): string {
  const repo = parseGitHubRepo(repoUrl);
  if (!repo) throw new ShipError("Link a GitHub repository to this project first.", 409);
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
}

function runState(status: string, conclusion: string): DeploymentState {
  if (status !== "completed") return status === "in_progress" ? "building" : "queued";
  if (conclusion === "success") return "ready";
  if (conclusion === "cancelled" || conclusion === "skipped") return "canceled";
  return "error";
}

/** `connection` runs one call with a token for the repository; `extra` asks for permissions beyond pull requests. */
export function shipGitHub(http: ShipHttp, connection: <T>(projectId: string, repoUrl: string, fn: (token: string) => Promise<T>, extra?: Readonly<Record<string, string>>) => Promise<T>): ShipGitHub {
  const call = <T = Json>(token: string, path: string, init?: { method?: string; body?: unknown }) => providerRequest<T>(http, "github", path, token, init);
  return {
    candidate: (projectId, repoUrl) => connection(projectId, repoUrl, async (token) => {
      const path = repoPath(repoUrl);
      const repository = record(await call(token, path));
      const defaultBranch = text(repository.default_branch) || "main";
      const latest = await call(token, `${path}/releases/latest`).catch((error: unknown) => {
        if (error instanceof ShipError && error.status === 404) return null;
        throw error;
      });
      let lastTag = text(record(latest).tag_name) || null;
      if (!lastTag) lastTag = text(list(await call(token, `${path}/tags?per_page=1`))[0]?.name) || null;
      const since = lastTag ? Date.parse(text(record(record(record(await call(token, `${path}/commits/${encodeURIComponent(lastTag)}`)).commit).committer).date)) : 0;
      const rows = list(await call(token, `${path}/pulls?state=closed&base=${encodeURIComponent(defaultBranch)}&sort=updated&direction=desc&per_page=100`));
      const bodies: Record<number, string> = {};
      const pulls: MergedPull[] = rows.filter((row) => text(row.merged_at) && Date.parse(text(row.merged_at)) > (Number.isFinite(since) ? since : 0))
        .sort((a, b) => Date.parse(text(a.merged_at)) - Date.parse(text(b.merged_at))).slice(-CANDIDATE_PULLS)
        .map((row) => {
          const number = Number(row.number);
          bodies[number] = text(row.body).slice(0, 2_000);
          return {
            number, title: text(row.title).slice(0, 300), url: text(row.html_url), mergedAt: Date.parse(text(row.merged_at)),
            ...(text(record(row.user).login) ? { author: text(record(row.user).login) } : {}), labels: list(row.labels).map((label) => text(label.name)).filter(Boolean).slice(0, 10),
          };
        });
      return { defaultBranch, lastTag, suggestedTag: nextReleaseTag(lastTag, pulls), pulls, bodies };
    }),
    createRelease: (projectId, repoUrl, release) => connection(projectId, repoUrl, async (token) => {
      const path = repoPath(repoUrl);
      const repository = record(await call(token, path));
      const created = record(await call(token, `${path}/releases`, {
        body: { tag_name: release.tag, target_commitish: text(repository.default_branch) || "main", name: release.title, body: release.notes, draft: false, prerelease: false },
      }));
      const url = text(created.html_url);
      if (!url.startsWith("https://")) throw new ShipError("GitHub did not return the new release.");
      return { url };
    }),
    runs: (projectId, repoUrl, target) => connection(projectId, repoUrl, async (token) => {
      const data = record(await call(token, `${repoPath(repoUrl)}/actions/workflows/${encodeURIComponent(target.ref)}/runs?per_page=${DEPLOYMENTS_SHOWN}`));
      const runs = list(data.workflow_runs);
      const live = runs.find((run) => text(run.head_branch) === target.branch && runState(text(run.status), text(run.conclusion)) === "ready");
      return runs.map((run): ShipDeployment => {
        const state = runState(text(run.status), text(run.conclusion));
        const production = text(run.head_branch) === target.branch;
        const pr = Number(list(run.pull_requests)[0]?.number);
        return {
          id: String(run.id), state, inspectUrl: text(run.html_url), createdAt: Date.parse(text(run.created_at)) || 0, production, current: run === live,
          ...(run === live && target.siteUrl ? { url: target.siteUrl } : {}), ...(text(run.head_sha) ? { commitSha: text(run.head_sha) } : {}),
          ...(text(run.display_title) ? { commitMessage: text(run.display_title).split("\n")[0] } : {}), ...(text(run.head_branch) ? { branch: text(run.head_branch) } : {}),
          ...(Number.isSafeInteger(pr) && pr > 0 ? { pullRequest: pr } : {}), actions: state === "queued" || state === "building" ? [] : ["redeploy"],
        };
      });
    }, ACTIONS),
    dispatch: (projectId, repoUrl, target) => connection(projectId, repoUrl, async (token) => {
      await call(token, `${repoPath(repoUrl)}/actions/workflows/${encodeURIComponent(target.ref)}/dispatches`, { body: { ref: target.branch } });
    }, ACTIONS),
    rerun: (projectId, repoUrl, runId) => connection(projectId, repoUrl, async (token) => {
      if (!/^\d{1,20}$/.test(runId)) throw new ShipError("Pick a workflow run.", 400);
      await call(token, `${repoPath(repoUrl)}/actions/runs/${runId}/rerun`, { method: "POST" });
    }, ACTIONS),
  };
}

/** Security: the call runs with the project's own connection only after it is checked to be the repository Origin names. */
export function projectShipGitHub(http: ShipHttp, service: () => GitHubService): ShipGitHub {
  return shipGitHub(http, (projectId, repoUrl, fn, extra) => withProjectGitHub(service(), projectId, (token, connected) => {
    const expected = parseGitHubRepo(repoUrl), actual = parseGitHubRepo(connected);
    if (!expected || !actual || `${expected.owner}/${expected.repo}`.toLowerCase() !== `${actual.owner}/${actual.repo}`.toLowerCase()) throw new ShipError("The project's repository changed; reload and try again.", 409);
    return fn(token);
  }, extra).catch((error: unknown) => {
    // GitHub answers 422 when an App installation token asks for a permission the installation was never granted.
    if (extra?.actions && error instanceof GitHubHttpError && error.status === 422) throw new ShipError("The Origin GitHub App needs Actions: write on this repository to run workflows. Accept the new permission in GitHub's App settings.", 403);
    throw error;
  }));
}

/** Test hook: a loopback GitHub stand-in that takes any token, for the isolated fixture. */
export function loopbackShipGitHub(http: ShipHttp & { origin: string }): ShipGitHub {
  return shipGitHub(http, (_projectId, _repoUrl, fn) => fn("loopback"));
}
