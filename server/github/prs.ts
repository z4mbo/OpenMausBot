import { z } from "zod";
import { jobPayload } from "./store.ts";
import { repositoryPath, withInstallation } from "./app.ts";
import { GitHubHttpError, githubRequest, type GitHubService } from "./service.ts";

const sha = z.string().regex(/^[a-f0-9]{40,64}$/i);
const githubPR = z.object({
  number: z.number().int().positive(), html_url: z.url(), node_id: z.string(), state: z.enum(["open", "closed"]), draft: z.boolean(),
  merged: z.boolean().optional(), merged_at: z.string().nullable().optional(), updated_at: z.string(),
  head: z.object({ ref: z.string(), sha, repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ sha, repo: z.object({ full_name: z.string() }) }),
  mergeable: z.boolean().nullable().optional(), body: z.string().nullable().optional(),
});
type GitHubPR = z.infer<typeof githubPR>;
export type PRSnapshot = { number: number; url: string; branch: string; headSha: string; baseSha: string; state: "draft" | "open" | "closed" | "merged"; checks: string; review: string; mergeable: boolean | null; githubUpdatedAt: number };

type TaskDoc = { _id: string; title: string; description?: string; githubTaskBranch?: string; githubIssueNumber?: number };
type Context = { project: { repoUrl?: string }; task: TaskDoc; existingPR?: { number: number } | null };
type Target = { _id: string; projectId: string; url: string; number: number };
type OpenedPR = { status: "opened"; number: number; url: string; state: string; id: string };
/** The person a draft pull request is opened for, as git records them. */
export type PRAuthor = { name: string; email: string; login: string | null };
type OpenAsMember = (request: { head: string; base: string; title: string; body: string }) => Promise<number | null>;

const trailerPart = (value: string) => value.replace(/[\r\n<>]+/g, " ").trim();
export const coAuthorTrailer = (author: PRAuthor | null) => author ? `Co-authored-by: ${trailerPart(author.name)} <${trailerPart(author.email)}>` : "";

export function taskBranch(task: { _id: string; title: string; githubTaskBranch?: string }): string {
  return task.githubTaskBranch ?? `origin/ORI-${task._id.slice(-4).toUpperCase()}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "") || "task"}`;
}

export function checksSummary(runs: { status: string; conclusion: string | null }[], truncated: boolean): string {
  if (runs.some((run) => run.status === "completed" && !["success", "neutral", "skipped"].includes(run.conclusion ?? ""))) return "failure";
  if (truncated) return "unknown";
  if (runs.some((run) => run.status !== "completed")) return "pending";
  return runs.length ? "success" : "none";
}

function toSnapshot(pr: GitHubPR, repo: string, checks: string, review: string): PRSnapshot {
  const updatedAt = Date.parse(pr.updated_at);
  if (!Number.isFinite(updatedAt) || pr.base.repo.full_name.toLowerCase() !== repo.toLowerCase() || pr.html_url.toLowerCase() !== `https://github.com/${repo}/pull/${pr.number}`.toLowerCase()) throw new Error("Unexpected PR repository or timestamp");
  return {
    number: pr.number, url: pr.html_url, branch: pr.head.ref, headSha: pr.head.sha, baseSha: pr.base.sha,
    state: pr.merged || pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open",
    checks, review, mergeable: pr.mergeable ?? null, githubUpdatedAt: updatedAt,
  };
}

/** Check Runs only: commit statuses need statuses:read, which the App does not request. */
export async function readPRSnapshot(service: GitHubService, repoUrl: string, number: number, token: string): Promise<PRSnapshot> {
  const path = repositoryPath(repoUrl), repo = path.slice("/repos/".length);
  const pr = githubPR.parse(await githubRequest(service, `${path}/pulls/${number}`, token));
  const [checks, review] = await Promise.all([
    githubRequest<{ total_count: number; check_runs: { status: string; conclusion: string | null }[] }>(service, `${path}/commits/${pr.head.sha}/check-runs?filter=latest&per_page=100`, token),
    githubRequest<{ data?: { node?: { reviewDecision?: string | null } }; errors?: unknown[] }>(service, "/graphql", token, { method: "POST", body: JSON.stringify({ query: "query($id:ID!){node(id:$id){... on PullRequest{reviewDecision}}}", variables: { id: pr.node_id } }) }),
  ]);
  const latest = githubPR.parse(await githubRequest(service, `${path}/pulls/${number}`, token));
  if (latest.head.sha !== pr.head.sha || latest.updated_at !== pr.updated_at || latest.state !== pr.state || latest.draft !== pr.draft || latest.merged_at !== pr.merged_at) throw new Error("PR changed while synchronizing; retry");
  const decision = review.errors?.length ? "unknown" : review.data?.node?.reviewDecision?.toLowerCase() ?? "review_required";
  return toSnapshot(latest, repo, checksSummary(checks.check_runs, checks.total_count > checks.check_runs.length), decision);
}

const definitiveRejection = (error: unknown) => error instanceof GitHubHttpError && [400, 401, 403, 404, 422, 429].includes(error.status);

async function openPR(service: GitHubService, repoUrl: string, taskId: string, branch: string, title: string, body: string, token: string, author: PRAuthor | null, asMember?: OpenAsMember) {
  const { store } = service;
  const path = repositoryPath(repoUrl), repo = path.slice("/repos/".length), owner = repo.split("/")[0];
  const metadata = await githubRequest<{ default_branch: string }>(service, path, token);
  const base = metadata.default_branch;
  if (branch === base) throw new Error("Task branch must differ from the base branch");
  await githubRequest(service, `${path}/git/ref/heads/${encodeURIComponent(base)}`, token);
  const head = await githubRequest<{ object: { sha: string } }>(service, `${path}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  if (!head.object.sha) throw new Error("Push the task branch first");
  const marker = `<!-- origin-task:${taskId} -->`;
  const key = `pr:${taskId}:${repo.toLowerCase()}:${branch}`;
  if (!store.lockJob(key)) throw new Error("PR operation in progress; retry the same request ID");
  try {
    const saved = jobPayload(store.readJob(key));
    const matches = await githubRequest<{ number: number; body?: string; head: { ref: string } }[]>(service, `${path}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`, token);
    let number = typeof saved.number === "number" ? saved.number : undefined;
    number ??= matches.find((pr) => pr.head.ref === branch && pr.body?.includes(marker))?.number;
    if (!number && saved.started) throw new Error("Previous PR creation result is uncertain; reconciliation or owner inspection required before retrying");
    if (!number) {
      store.saveJob(key, "working", { started: true });
      try {
        number = await asMember?.({ head: branch, base, title, body: `${body}\n\n${marker}`.trim() }) ?? undefined;
        number ??= (await githubRequest<{ number: number }>(service, `${path}/pulls`, token, {
          method: "POST", body: JSON.stringify({ head: branch, base, title, body: [body, coAuthorTrailer(author), marker].filter(Boolean).join("\n\n").trim(), draft: true }),
        })).number;
        store.saveJob(key, "working", { number });
      } catch (error) {
        if (definitiveRejection(error)) store.saveJob(key, "working");
        throw error;
      }
    }
    const snapshot = await readPRSnapshot(service, repoUrl, number, token);
    if (snapshot.branch !== branch) throw new Error("GitHub returned an unexpected task branch");
    store.saveJob(key, "done", { number });
    return snapshot;
  } catch (error) {
    const previous = store.readJob(key);
    store.saveJob(key, "error", previous?.payload ? JSON.parse(previous.payload) : undefined);
    throw error;
  }
}

/** GitHub cannot open a PR without a diff, so a new task branch gets a visible plan commit first. */
async function prepareDraftBranch(service: GitHubService, context: Context, appToken: string, author: PRAuthor | null) {
  const { project, task } = context;
  const path = repositoryPath(project.repoUrl ?? ""), branch = taskBranch(task);
  const metadata = await githubRequest<{ default_branch: string }>(service, path, appToken);
  const base = await githubRequest<{ object: { sha: string } }>(service, `${path}/git/ref/heads/${encodeURIComponent(metadata.default_branch)}`, appToken);
  try { await githubRequest(service, `${path}/git/refs`, appToken, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }) }); }
  catch (error) { if (!(error instanceof GitHubHttpError) || error.status !== 422) throw error; }
  const file = `.origin/tasks/${task._id}.md`, marker = `<!-- origin-task:${task._id} -->`;
  let existing: { content?: string; encoding?: string } | undefined;
  try { existing = await githubRequest(service, `${path}/contents/${file}?ref=${encodeURIComponent(branch)}`, appToken); }
  catch (error) { if (!(error instanceof GitHubHttpError) || error.status !== 404) throw error; }
  if (existing) {
    if (existing.encoding !== "base64" || !Buffer.from(existing.content ?? "", "base64").toString().includes(marker)) throw new Error("Existing task branch has an unrelated plan");
  } else {
    const head = await githubRequest<{ object: { sha: string } }>(service, `${path}/git/ref/heads/${encodeURIComponent(branch)}`, appToken);
    if (head.object.sha !== base.object.sha) throw new Error("Existing branch is not an empty task branch");
    await githubRequest(service, `${path}/contents/${file}`, appToken, { method: "PUT", body: JSON.stringify({ branch, message: [`Plan Origin task: ${task.title}`, coAuthorTrailer(author)].filter(Boolean).join("\n\n"), content: Buffer.from(`# ${task.title}\n\n${task.description ?? ""}\n\n${marker}\n`).toString("base64") }) });
  }
  return branch;
}

/** Merging the draft closes the task's GitHub issue, which completes it in Origin. */
export function draftBody(task: Pick<TaskDoc, "description" | "githubIssueNumber">): string {
  return [task.description?.trim(), task.githubIssueNumber ? `Closes #${task.githubIssueNumber}` : ""].filter(Boolean).join("\n\n");
}

/**
 * Opens the issue's draft pull request under the person's own linked GitHub account when they have one, so GitHub
 * attributes it to them; otherwise the App opens it, with the person as co-author of its plan commit.
 */
export async function createTaskPR(service: GitHubService, sessionToken: string, projectId: string, taskId: string) {
  const context = await service.bridge<Context>("prHumanContext", { sessionToken, projectId, taskId, choosePR: true });
  const author = await Promise.resolve().then(() => service.convex().query("githubLinks:gitIdentity", { sessionToken })).catch(() => null) as PRAuthor | null;
  const asMember: OpenAsMember | undefined = service.action && (async (request) => {
    const opened = await service.action!<{ state: string; number?: number }>("githubPulls:openAsMember", { sessionToken, projectId, taskId, ...request });
    return opened.state === "opened" && opened.number ? opened.number : null;
  });
  const repoUrl = context.project.repoUrl ?? "";
  const key = `draft-task:${taskId}:${repoUrl.toLowerCase()}`;
  if (!service.store.lockJob(key)) throw new Error("Task PR creation in progress; retry shortly");
  try {
    const snapshot = await withInstallation(service, projectId, repoUrl, async (appToken) => {
      const current = await service.bridge<Context>("prHumanContext", { sessionToken, projectId, taskId });
      if (repositoryPath(current.project.repoUrl ?? "") !== repositoryPath(repoUrl)) throw new Error("PR repository changed during authorization");
      if (context.existingPR) return readPRSnapshot(service, repoUrl, context.existingPR.number, appToken);
      const branch = await prepareDraftBranch(service, context, appToken, author);
      return openPR(service, repoUrl, taskId, branch, context.task.title, draftBody(context.task), appToken, author, asMember);
    });
    const result = await service.bridge<OpenedPR>("prFinalize", { sessionToken, projectId, taskId, snapshot });
    return { ...result, ok: true, message: `Linked draft PR #${result.number}` };
  } finally { service.store.saveJob(key, "done"); }
}

/** An old check event must never attach its results to a newer head. */
async function syncPRTarget(service: GitHubService, target: Target, eventHeadSha?: string) {
  const repoUrl = target.url.split("/pull/")[0];
  const sequence = await service.bridge<number | null>("prBeginSync", { id: target._id });
  if (sequence === null) return;
  const snapshot = await withInstallation(service, target.projectId, repoUrl, (token) => readPRSnapshot(service, repoUrl, target.number, token));
  if (eventHeadSha && eventHeadSha !== snapshot.headSha) return;
  await service.bridge("prSync", { id: target._id, sequence, snapshot });
}

export async function syncPREvent(service: GitHubService, repoUrl: string, numbers: number[], headSha?: string) {
  const targets = await service.bridge<Target[]>("prEventTargets", { repoUrl, numbers, ...(headSha ? { headSha } : {}) });
  for (const target of targets) await syncPRTarget(service, target, headSha);
}

const NEXT_PR_STATE: Record<string, string> = { draft: "open", open: "closed", closed: "draft" };

/** Pages through draft, open and closed-unmerged PRs in turn, so a reopened PR is seen even when its webhook was missed. */
export async function syncPRPage(service: GitHubService) {
  const key = "pr-sync-cursor";
  const saved = jobPayload(service.store.readJob(key));
  const cursor = typeof saved.cursor === "string" ? saved.cursor : null;
  const state = typeof saved.state === "string" && saved.state in NEXT_PR_STATE ? saved.state : "draft";
  const page = await service.bridge<{ rows: Target[]; nextCursor: string | null }>("prTargets", { cursor, state });
  const results = await Promise.allSettled(page.rows.map((target) => syncPRTarget(service, target)));
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed) console.warn(`GitHub PR reconciliation: ${failed} targets need retry or App permission approval`);
  service.store.saveJob(key, "done", { cursor: page.nextCursor, state: page.nextCursor ? state : NEXT_PR_STATE[state] });
}
