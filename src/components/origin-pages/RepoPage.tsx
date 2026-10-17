import { CircleCheck, CircleDot, ExternalLink, FolderGit2, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, Loader2, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";
import { cloudAction, useCloudQuery } from "@/lib/origin-cloud";
import { originGitHub } from "@/lib/origin-github";
import { cn } from "@/lib/cn";
import type { CloudBoard, CloudCommit, CloudProject, CloudPullRequest, CloudTaskPullRequest } from "./cloud-types";
import { fmtDate, githubRepoHref, githubRepoLabel, shortSha, taskKey } from "./repo-url";
import { CloudGate, EmptyState, Loading, Notice, PageHeader, cardClass, ghostButton, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";

export function RepoPage({ onOpenSettings, ...props }: OriginPageProps & { onOpenSettings?(): void }) {
  return <CloudGate {...props} label="Repo">{({ project, projectId, canEdit, isAdmin }) => <Repo project={project} projectId={projectId} canEdit={canEdit} isAdmin={isAdmin} onOpenSettings={onOpenSettings} />}</CloudGate>;
}

const prStateStyle: Record<CloudPullRequest["state"], { icon: typeof GitPullRequest; tone: string }> = {
  open: { icon: GitPullRequest, tone: "text-success" },
  merged: { icon: GitMerge, tone: "text-accent-text" },
  closed: { icon: GitPullRequestClosed, tone: "text-danger" },
};

function Repo({ project, projectId, canEdit, isAdmin, onOpenSettings }: { project: CloudProject; projectId: string; canEdit: boolean; isAdmin: boolean; onOpenSettings?(): void }) {
  const href = githubRepoHref(project.repoUrl);
  const pulls = useCloudQuery<CloudPullRequest[]>("github:listPullRequests", href ? { projectId } : "skip");
  const commits = useCloudQuery<CloudCommit[]>("commits:list", href ? { projectId } : "skip");
  const board = useCloudQuery<CloudBoard>("tasks:board", href ? { projectId } : "skip");
  const [message, setMessage] = useState("");
  const action = useAction();

  if (!project.repoUrl) {
    return <EmptyState icon={<FolderGit2 size={22} />} title="No repository linked" body="Add the project's GitHub repository in Settings to see its pull requests and commits here, and let its agents open pull requests."
      action={onOpenSettings && <button type="button" className={primaryButton} onClick={onOpenSettings}><Settings size={14} />Open settings</button>} />;
  }

  const sync = () => action.run(async () => {
    const [repo, history] = await Promise.all([
      cloudAction<{ ok: boolean; issueCount: number; pullRequestCount: number; error?: string }>("github:syncRepo", { projectId }),
      cloudAction<{ ok: boolean; count: number; error?: string }>("commits:syncGitHub", { projectId }),
    ]);
    const errors = [repo.error, history.error].filter(Boolean);
    setMessage(errors.length ? errors.join(" ") : `Synced ${repo.pullRequestCount} pull requests and ${history.count} commits.`);
  }, "Could not sync with GitHub");

  const taskByBranch = new Map((board?.tasks ?? []).filter((task) => task.githubTaskBranch).map((task) => [task.githubTaskBranch!, task]));

  return (
    <section className={pageClass} aria-label="Repo">
      <PageHeader title="Repo">
        {href && <a className={ghostButton} href={href} target="_blank" rel="noreferrer"><FolderGit2 size={14} />{githubRepoLabel(project.repoUrl)}<ExternalLink size={12} /></a>}
        {canEdit && href && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void sync()}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Sync
        </button>}
      </PageHeader>
      {!href && <div className="mb-3"><Notice tone="danger">{project.repoUrl} is not a GitHub repository address.</Notice></div>}
      {project.githubRepoState === "error" && project.githubRepoError && <div className="mb-3"><Notice tone="danger">{project.githubRepoError}</Notice></div>}
      {project.githubRepoState === "awaiting_connection" && <div className="mb-3 flex flex-wrap items-center gap-2"><Notice>A workspace admin needs to connect GitHub in Settings before this repository can sync.</Notice>
        {isAdmin && project.teamId && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void action.run(async () => {
          await originGitHub.connectWorkspace(project.teamId!, projectId);
          setMessage("Finish connecting GitHub in your browser, then come back here.");
        }, "Could not connect GitHub")}>Connect GitHub</button>}
      </div>}
      {message && <div className="mb-3"><Notice>{message}</Notice></div>}
      {action.error && <div className="mb-3"><Notice tone="danger">{action.error}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cn(cardClass, "flex min-w-0 flex-col")} aria-label="Pull requests">
          <header className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2.5">
            <GitPullRequest size={15} className="text-ink-secondary" /><strong className="text-[13px] font-semibold text-ink">Pull requests</strong>
            <span className="text-[12px] text-ink-tertiary">{pulls?.length ?? ""}</span>
          </header>
          {pulls === undefined ? <div className="px-4"><Loading label="Loading pull requests" variant="inline" /></div> : !pulls.length ? <p className="px-4 py-8 text-center text-[12.5px] text-ink-tertiary">No pull requests yet{canEdit ? ". Sync to fetch them from GitHub." : "."}</p> : (
            <ul className="divide-y divide-hairline/30">
              {pulls.map((pr) => {
                const style = prStateStyle[pr.state];
                const Icon = style.icon;
                const task = pr.branch ? taskByBranch.get(pr.branch) : undefined;
                return (
                  <li key={pr._id}>
                    <a href={pr.url} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-raised/30">
                      <Icon size={15} className={cn("mt-0.5 shrink-0", style.tone)} aria-label={pr.state} />
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[13px] font-medium text-ink">{pr.title}</strong>
                        <span className="flex flex-wrap gap-x-2 text-[11.5px] text-ink-tertiary">
                          <span>#{pr.number}</span><span className="capitalize">{pr.state}</span>
                          {pr.author && <span>{pr.author}</span>}
                          {pr.branch && <code className="truncate">{pr.branch}</code>}
                          <span>{fmtDate(pr.updatedAt)}</span>
                        </span>
                        {task && <TaskPullRequestStatus taskId={task._id} number={pr.number} label={taskKey(task._id)} />}
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={cn(cardClass, "flex min-w-0 flex-col")} aria-label="Commits">
          <header className="flex items-center gap-2 border-b border-hairline/40 px-4 py-2.5">
            <GitCommitHorizontal size={15} className="text-ink-secondary" /><strong className="text-[13px] font-semibold text-ink">Recent commits</strong>
            <span className="text-[12px] text-ink-tertiary">{commits?.length ?? ""}</span>
          </header>
          {commits === undefined ? <div className="px-4"><Loading label="Loading commits" variant="inline" /></div> : !commits.length ? <p className="px-4 py-8 text-center text-[12.5px] text-ink-tertiary">No commits yet{canEdit ? ". Sync to fetch them from GitHub." : "."}</p> : (
            <ul className="divide-y divide-hairline/30">
              {commits.slice(0, 50).map((commit) => (
                <li key={commit._id}>
                  <a href={commit.url || href || undefined} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-raised/30">
                    <CircleDot size={13} className="mt-1 shrink-0 text-ink-tertiary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-medium text-ink">{commit.message.split("\n")[0]}</strong>
                      <span className="flex gap-2 text-[11.5px] text-ink-tertiary"><code>{shortSha(commit.sha)}</code><span>{commit.author}</span><span>{fmtDate(commit.committedAt)}</span></span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function TaskPullRequestStatus({ taskId, number, label }: { taskId: string; number: number; label: string }) {
  const prs = useCloudQuery<CloudTaskPullRequest[]>("taskPRs:list", { taskId });
  const pr = prs?.find((item) => item.number === number);
  if (!pr) return <span className="mt-1 block text-[11.5px] text-ink-tertiary">Issue {label}</span>;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-secondary">
      <span>Issue {label}</span>
      <span className="flex items-center gap-1"><CircleCheck size={11} aria-hidden="true" />Checks: {pr.checks}</span>
      <span>Review: {pr.review}</span>
      <span>Mergeable: {pr.mergeable == null ? "unknown" : pr.mergeable ? "yes" : "no"}</span>
    </span>
  );
}
