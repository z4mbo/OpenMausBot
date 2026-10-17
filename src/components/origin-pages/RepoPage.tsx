import {
  CheckCircle2, CircleAlert, CircleDashed, CircleDot, ExternalLink, FolderGit2, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed,
  GitPullRequestDraft, Loader2, RefreshCw, Settings, ThumbsUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { originGitHub, type PullState, type RepoPull, type RepoSnapshot, type ReviewDecision } from "@/lib/origin-github";
import { cn } from "@/lib/cn";
import type { CloudBoard, CloudProject, CloudTask } from "./cloud-types";
import { PersonAvatar } from "./PersonAvatar";
import { errorText, fmtDate, githubRepoHref, githubRepoLabel, shortSha, taskKey } from "./repo-url";
import { CloudGate, EmptyState, Notice, PageHeader, Skeleton, cardClass, ghostButton, pageClass, primaryButton, useAction, type OriginPageProps } from "./ui";

export function RepoPage({ onOpenSettings, ...props }: OriginPageProps & { onOpenSettings?(): void }) {
  return <CloudGate {...props} label="Repo">{({ project, projectId, canEdit, isAdmin }) => <Repo project={project} projectId={projectId} canEdit={canEdit} isAdmin={isAdmin} onOpenSettings={onOpenSettings} />}</CloudGate>;
}

const PULL_STATE: Record<PullState, { icon: typeof GitPullRequest; tone: string; label: string }> = {
  open: { icon: GitPullRequest, tone: "text-success", label: "Open" },
  draft: { icon: GitPullRequestDraft, tone: "text-ink-tertiary", label: "Draft" },
  merged: { icon: GitMerge, tone: "text-accent-text", label: "Merged" },
  closed: { icon: GitPullRequestClosed, tone: "text-danger", label: "Closed" },
};

const REVIEW_LABEL: Record<ReviewDecision, string> = {
  approved: "Approved", changes_requested: "Changes requested", review_required: "Review required", commented: "Commented",
};

const CLOSED_SHOWN = 8;
const card = "rounded-xl border border-hairline/40 bg-panel p-3 transition-[border-color,background-color] duration-150 hover:border-hairline hover:bg-raised/40 motion-safe:animate-msg-in";
const pill = "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-medium";

function useRepository(projectId: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!enabled) return;
    const mine = ++generation.current;
    setLoading(true);
    try {
      const next = await originGitHub.repository(projectId);
      if (mine === generation.current) { setSnapshot(next); setError(""); }
    } catch (cause) {
      if (mine === generation.current) setError(errorText(cause, "Could not reach GitHub"));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [projectId, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { snapshot, error, loading, reload: load };
}

function Repo({ project, projectId, canEdit, isAdmin, onOpenSettings }: { project: CloudProject; projectId: string; canEdit: boolean; isAdmin: boolean; onOpenSettings?(): void }) {
  const href = githubRepoHref(project.repoUrl);
  const board = useCloudQuery<CloudBoard>("tasks:board", href ? { projectId } : "skip");
  const { snapshot, error, loading, reload } = useRepository(projectId, Boolean(href));
  const [message, setMessage] = useState("");
  const action = useAction();

  if (!project.repoUrl) {
    return <EmptyState icon={<FolderGit2 size={22} />} title="No repository linked" body="Link or create the project's GitHub repository in Settings. Its issues, pull requests and commits then show here."
      action={onOpenSettings && <button type="button" className={primaryButton} onClick={onOpenSettings}><Settings size={14} />Open settings</button>} />;
  }

  const pulls = snapshot?.pullRequests ?? [];
  const tasks = board?.tasks ?? [];
  const linked = tasks.filter((task) => task.githubIssueNumber);
  const waiting = tasks.filter((task) => !task.done && !task.githubIssueNumber);
  const pullFor = (number: number) => pulls.find((pr) => pr.closes.includes(number) && pr.state !== "closed");
  const keyFor = (number: number) => linked.find((task) => task.githubIssueNumber === number);
  const assignees = new Map((board?.assignees ?? []).map((person) => [person.email, person]));

  const mirror = () => action.run(async () => {
    const { results } = await originGitHub.mirrorIssues(projectId);
    const failed = results.filter((result) => result.error);
    setMessage(failed.length ? failed[0].error ?? "" : `Created ${results.length} GitHub issue${results.length === 1 ? "" : "s"}.`);
  }, "Could not create the GitHub issues");

  const review = (pr: RepoPull, kind: "approve" | "merge") => action.run(async () => {
    if (kind === "merge" && !window.confirm(`Merge #${pr.number} "${pr.title}" into the default branch? This cannot be undone.`)) return;
    const result = await originGitHub.review(projectId, pr.number, kind);
    setMessage(kind === "merge" ? `Merged #${pr.number}. The issues it closes complete on the next sync.`
      : result.approved ? `Approved #${pr.number}.` : `GitHub posted your review on #${pr.number} as a comment: this connection opened it.`);
    await reload();
  }, kind === "merge" ? "Could not merge" : "Could not approve");

  return (
    <section className={pageClass} aria-label="Repo">
      <PageHeader title="Repo">
        {href && <a className={ghostButton} href={href} target="_blank" rel="noreferrer"><FolderGit2 size={14} />{githubRepoLabel(project.repoUrl)}<ExternalLink size={12} /></a>}
        {href && <button type="button" className={ghostButton} disabled={loading} onClick={() => void reload()} aria-label="Refresh from GitHub">
          <RefreshCw size={14} className={cn(loading && "motion-safe:animate-spin")} />Refresh
        </button>}
      </PageHeader>
      <div className="mb-3 flex flex-col gap-2 empty:hidden">
        {!href && <Notice tone="danger">{project.repoUrl} is not a GitHub repository address.</Notice>}
        {project.githubRepoState === "error" && project.githubRepoError && <Notice tone="danger">{project.githubRepoError}</Notice>}
        {project.githubRepoState === "awaiting_connection" && <div className="flex flex-wrap items-center gap-2"><Notice>A workspace admin connects GitHub before this repository can sync.</Notice>
          {isAdmin && project.teamId && <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void action.run(async () => {
            await originGitHub.connectWorkspace(project.teamId!, projectId);
            setMessage("Finish connecting GitHub in your browser, then come back here.");
          }, "Could not connect GitHub")}>Connect GitHub</button>}
        </div>}
        {error && <Notice tone="danger">{error}</Notice>}
        {message && <Notice>{message}</Notice>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel icon={<CircleDot size={15} />} title="Issues" count={linked.filter((task) => !task.done).length} label="GitHub issues"
          extra={canEdit && waiting.length > 0 && (
            <button type="button" className={cn(ghostButton, "ml-auto min-h-7 px-2 py-1 text-[12px]")} disabled={action.busy} onClick={() => void mirror()}
              title={`${waiting.length} open issue${waiting.length === 1 ? "" : "s"} without a GitHub issue`}>
              {action.busy ? <Loader2 size={12} className="animate-spin" /> : <FolderGit2 size={12} />}Create {waiting.length} on GitHub
            </button>
          )}>
          {board === undefined ? <Placeholder /> : !linked.length ? <Empty>{waiting.length ? "No issue is on GitHub yet." : "No issues yet."}</Empty> : (
            <IssueList tasks={linked} pullFor={pullFor} assignees={assignees} />
          )}
        </Panel>

        <Panel icon={<GitPullRequest size={15} />} title="Pull requests" count={pulls.filter((pr) => pr.state === "open" || pr.state === "draft").length} label="Pull requests">
          {!snapshot && loading ? <Placeholder /> : !pulls.length ? <Empty>{error ? "Unavailable." : "No pull requests yet."}</Empty> : (
            <ul className="flex flex-col gap-2">
              {pulls.map((pr) => (
                <li key={pr.number}>
                  <PullCard pr={pr} issueKey={(number) => { const task = keyFor(number); return task ? taskKey(task._id) : `#${number}`; }}
                    canReview={isAdmin && (pr.state === "open" || pr.state === "draft")} busy={action.busy} onReview={(kind) => void review(pr, kind)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={<GitCommitHorizontal size={15} />} title="Recent commits" count={snapshot?.commits.length} label="Recent commits" className="lg:col-span-2">
          {!snapshot && loading ? <Placeholder /> : !snapshot?.commits.length ? <Empty>{snapshot?.commitsError || (error ? "Unavailable." : "No commits yet.")}</Empty> : (
            <ol className={cn(cardClass, "divide-y divide-hairline/30 overflow-hidden")}>
              {snapshot.commits.map((commit) => (
                <li key={commit.sha} className="motion-safe:animate-msg-in">
                  <a href={commit.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2 text-[13px] transition-colors duration-150 hover:bg-raised/40">
                    <code className="shrink-0 font-mono text-[11.5px] text-ink-tertiary">{shortSha(commit.sha)}</code>
                    <span className="min-w-0 flex-1 truncate text-ink">{commit.message}</span>
                    <span className="hidden shrink-0 text-[12px] text-ink-tertiary sm:inline">{commit.author}</span>
                    <time className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">{fmtDate(commit.committedAt)}</time>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </section>
  );
}

function Panel({ icon, title, count, label, extra, className, children }: { icon: ReactNode; title: string; count?: number; label: string; extra?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-w-0 flex-col", className)} aria-label={label}>
      <header className="mb-2 flex min-h-7 items-center gap-2 px-0.5">
        <span className="text-ink-secondary" aria-hidden="true">{icon}</span>
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        {count !== undefined && <span className="text-[12px] tabular-nums text-ink-tertiary">{count}</span>}
        {extra}
      </header>
      {children}
    </section>
  );
}

function Placeholder() {
  return <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-[68px] rounded-xl" />)}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className={cn(cardClass, "px-4 py-6 text-center text-[12.5px] text-ink-tertiary")}>{children}</p>;
}

function IssueList({ tasks, pullFor, assignees }: { tasks: CloudTask[]; pullFor(number: number): RepoPull | undefined; assignees: Map<string, { email: string; name: string; avatarUrl?: string | null }> }) {
  const open = tasks.filter((task) => !task.done).sort((a, b) => b.updatedAt - a.updatedAt);
  const closed = tasks.filter((task) => task.done).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CLOSED_SHOWN);
  return (
    <ul className="flex flex-col gap-2">
      {[...open, ...closed].map((task) => {
        const pr = pullFor(task.githubIssueNumber!);
        const person = task.assignedToEmail ? assignees.get(task.assignedToEmail) : undefined;
        const state = task.done ? { label: "Done", tone: "bg-success/15 text-success", icon: <CheckCircle2 size={11} /> }
          : task.githubIssueState === "closed" ? { label: "Closed", tone: "bg-raised text-ink-secondary", icon: <CheckCircle2 size={11} /> }
          : { label: "Open", tone: "bg-success/10 text-success", icon: <CircleDot size={11} /> };
        return (
          <li key={task._id}>
            <article className={cn(card, task.done && "opacity-70")}>
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
                <span className="font-mono">{taskKey(task._id)}</span>
                <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="rounded hover:text-ink hover:underline">#{task.githubIssueNumber}</a>
                <span className={cn(pill, "ml-auto", state.tone)}>{state.icon}{state.label}</span>
              </div>
              <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="block text-[13.5px] font-medium leading-snug text-ink [overflow-wrap:anywhere] hover:underline">{task.title}</a>
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-secondary">
                {pr ? (
                  <a href={pr.url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-1 hover:text-ink", PULL_STATE[pr.state].tone)}>
                    {(() => { const Icon = PULL_STATE[pr.state].icon; return <Icon size={12} aria-hidden="true" />; })()}#{pr.number} {PULL_STATE[pr.state].label.toLowerCase()}
                  </a>
                ) : !task.done && <span className="flex items-center gap-1 text-ink-tertiary"><CircleDashed size={12} aria-hidden="true" />No pull request</span>}
                {person ? <span className="ml-auto flex items-center gap-1.5" title={person.name}><PersonAvatar person={person} size={18} /><span className="hidden sm:inline">{person.name}</span></span>
                  : task.assignedToName && <span className="ml-auto">{task.assignedToName}</span>}
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

function ChecksBadge({ checks }: { checks?: string }) {
  if (!checks || checks === "none") return null;
  const tone = checks === "success" ? "bg-success/10 text-success" : checks === "failure" ? "bg-danger/10 text-danger" : "bg-raised text-ink-secondary";
  const icon = checks === "success" ? <CheckCircle2 size={11} /> : checks === "failure" ? <CircleAlert size={11} /> : <Loader2 size={11} className="motion-safe:animate-spin" />;
  const label = checks === "success" ? "Checks pass" : checks === "failure" ? "Checks fail" : checks === "pending" ? "Checks running" : "Checks unknown";
  return <span className={cn(pill, tone)}>{icon}{label}</span>;
}

function PullCard({ pr, issueKey, canReview, busy, onReview }: { pr: RepoPull; issueKey(number: number): string; canReview: boolean; busy: boolean; onReview(kind: "approve" | "merge"): void }) {
  const state = PULL_STATE[pr.state];
  const Icon = state.icon;
  const mergeable = pr.checks === "success" || pr.checks === "none";
  return (
    <article className={cn(card, (pr.state === "closed" || pr.state === "merged") && "opacity-75")}>
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
        <Icon size={13} className={state.tone} aria-hidden="true" />
        <span className={state.tone}>{state.label}</span>
        <span>#{pr.number}</span>
        {pr.branch && <code className="min-w-0 truncate font-mono">{pr.branch}</code>}
        <time className="ml-auto shrink-0 tabular-nums">{fmtDate(pr.updatedAt)}</time>
      </div>
      <a href={pr.url} target="_blank" rel="noreferrer" className="block text-[13.5px] font-medium leading-snug text-ink [overflow-wrap:anywhere] hover:underline">{pr.title}</a>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-secondary">
        <ChecksBadge checks={pr.checks} />
        {pr.review && <span className={cn(pill, pr.review === "approved" ? "bg-accent/10 text-accent-text" : pr.review === "changes_requested" ? "bg-danger/10 text-danger" : "bg-raised text-ink-secondary")}>{REVIEW_LABEL[pr.review]}</span>}
        {pr.closes.map((number) => <span key={number} className={cn(pill, "bg-raised text-ink-secondary")}>Closes {issueKey(number)}</span>)}
        {pr.author && <span className="ml-auto text-ink-tertiary">{pr.author}</span>}
      </div>
      {canReview && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-hairline/30 pt-2.5">
          <a className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} href={pr.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />Open on GitHub</a>
          {pr.review !== "approved" && <button type="button" className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} disabled={busy} onClick={() => onReview("approve")}><ThumbsUp size={12} />Approve</button>}
          <button type="button" className={cn(primaryButton, "ml-auto min-h-7 px-2.5 py-1 text-[12px]")} disabled={busy || !mergeable}
            title={mergeable ? "Merge into the default branch" : "Merge once checks pass"} onClick={() => onReview("merge")}><GitMerge size={12} />Merge</button>
        </div>
      )}
    </article>
  );
}
