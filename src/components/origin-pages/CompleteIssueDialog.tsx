import { Bot as BotIcon, Check, Copy, ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { openExternalLink } from "@/lib/app-links";
import { copyText } from "@/lib/copy-text";
import { originGitHub } from "@/lib/origin-github";
import { cn } from "@/lib/cn";
import type { CloudProject, CloudTask } from "./cloud-types";
import { githubRepoLabel, taskKey } from "./repo-url";
import { Modal, Notice, ghostButton, primaryButton, useAction } from "./ui";

/** Whether completing this issue must go through a merged pull request rather than a click. */
export const completesThroughPullRequest = (project: Pick<CloudProject, "repoUrl">, task: Pick<CloudTask, "githubIssueNumber">) =>
  Boolean(task.githubIssueNumber || project.repoUrl);

/** The project's Chief, who sees an issue marked complete through to a merged pull request. */
export interface IssueImplementer {
  name: string;
  /** Moves the issue to In progress and hands it to the Chief. */
  start(): Promise<void>;
}

/** Completing a GitHub-backed issue: it is done when a pull request that closes its GitHub issue merges. */
export function CompleteIssueDialog({ project, projectId, task, implementer, onClose }: {
  project: CloudProject; projectId: string; task: CloudTask; implementer?: IssueImplementer; onClose(): void;
}) {
  const action = useAction();
  const [opened, setOpened] = useState("");
  const [handed, setHanded] = useState(false);
  const key = taskKey(task._id);
  const number = task.githubIssueNumber;

  const openPullRequest = () => action.run(async () => {
    const result = await originGitHub.openTaskPullRequest(projectId, task._id);
    setOpened(`Draft pull request #${result.number} is open with its branch${number ? ` and closes #${number}` : ""}.`);
    await openExternalLink(result.url);
  }, "Could not open a pull request");
  const hand = (start: () => Promise<void>) => action.run(async () => {
    await start();
    setHanded(true);
  }, "Could not hand the issue over");
  const issueLink = task.githubIssueUrl && <a className={ghostButton} href={task.githubIssueUrl} target="_blank" rel="noreferrer">Issue #{number}<ExternalLink size={12} /></a>;
  const spinner = action.busy ? <Loader2 size={14} className="animate-spin" /> : null;

  return (
    <Modal title={`Complete ${key}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px] text-ink-secondary">
        <p className="text-[14px] font-medium leading-snug text-ink">Done when its pull request merges</p>
        {implementer ? (
          <>
            <div className="flex gap-3 rounded-lg border border-hairline/60 bg-inset px-3 py-2.5">
              <BotIcon size={16} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium text-ink">Handing {key} to {implementer.name} to implement and open a PR</p>
                <p>
                  {implementer.name} gives it to the right agent, which works on a branch and opens a pull request that closes {number ? `#${number}` : "its GitHub issue"}.
                  {" "}{implementer.name} reviews and merges it; GitHub then closes the issue and {key} moves to Done. It moves to In progress now.
                </p>
              </div>
            </div>
            {handed && <Notice>Handed {key} to {implementer.name}. It is In progress; follow it in {implementer.name}'s chat.</Notice>}
            {opened && <Notice>{opened}</Notice>}
            {action.error && <Notice tone="danger">{action.error}</Notice>}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {handed || opened ? (
                <button type="button" className={primaryButton} onClick={onClose}>Done</button>
              ) : (
                <>
                  <button type="button" className={primaryButton} disabled={action.busy} autoFocus onClick={() => void hand(implementer.start)}>
                    {spinner ?? <BotIcon size={14} />}Hand to {implementer.name}
                  </button>
                  {project.repoUrl && (
                    <button type="button" className={ghostButton} disabled={action.busy} onClick={() => void openPullRequest()} title="Opens a draft pull request with an empty branch for a person to work on">
                      <GitPullRequest size={14} />Open an empty draft PR instead
                    </button>
                  )}
                </>
              )}
              {issueLink}
            </div>
          </>
        ) : (
          <Guidance project={project} projectId={projectId} task={task} opened={opened} action={action} onOpenPullRequest={() => void openPullRequest()} issueLink={issueLink} />
        )}
      </div>
    </Modal>
  );
}

function Guidance({ project, projectId, task, opened, action, onOpenPullRequest, issueLink }: {
  project: CloudProject; projectId: string; task: CloudTask; opened: string; action: ReturnType<typeof useAction>; onOpenPullRequest(): void; issueLink: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const number = task.githubIssueNumber;
  const keyword = number ? `Closes #${number}` : "";
  const copy = async () => {
    if ((await copyText(keyword)) !== "copied") return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };
  const mirror = () => action.run(async () => {
    const [result] = (await originGitHub.mirrorIssues(projectId, [task._id])).results;
    if (result?.error) throw new Error(result.error);
  }, "Could not create the GitHub issue");
  const spinner = action.busy ? <Loader2 size={14} className="animate-spin" /> : null;
  return (
    <>
      {number ? (
        <>
          <p>Open a pull request in {githubRepoLabel(project.repoUrl)} whose description says:</p>
          <div className="flex items-center gap-2 rounded-lg border border-hairline/60 bg-inset px-3 py-2">
            <code className="flex-1 font-mono text-[13px] text-ink">{keyword}</code>
            <button type="button" className={cn(ghostButton, "min-h-7 px-2 py-1 text-[12px]")} onClick={() => void copy()} aria-label={`Copy ${keyword}`}>
              {copied ? <Check size={12} className="text-success motion-safe:animate-pop-in" /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p>The project's Chief reviews and merges it; GitHub then closes #{number} and this issue moves to Done.</p>
        </>
      ) : (
        <p>This issue has no GitHub issue yet. Create it first, then open a pull request that closes it.</p>
      )}
      {opened && <Notice>{opened}</Notice>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {number ? (
          <>
            <button type="button" className={primaryButton} disabled={action.busy} onClick={onOpenPullRequest}>
              {spinner ?? <GitPullRequest size={14} />}Open draft pull request
            </button>
            {issueLink}
          </>
        ) : (
          <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void mirror()}>
            {spinner}Create GitHub issue
          </button>
        )}
      </div>
    </>
  );
}
