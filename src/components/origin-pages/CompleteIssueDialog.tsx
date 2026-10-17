import { Check, Copy, ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import { useState } from "react";
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

/** Guides completing a GitHub-backed issue: it is done when a pull request that closes its GitHub issue merges. */
export function CompleteIssueDialog({ project, projectId, task, onClose }: { project: CloudProject; projectId: string; task: CloudTask; onClose(): void }) {
  const action = useAction();
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState("");
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
  const openPullRequest = () => action.run(async () => {
    const result = await originGitHub.openTaskPullRequest(projectId, task._id);
    setOpened(`Draft pull request #${result.number} is open with its branch.`);
    await openExternalLink(result.url);
  }, "Could not open a pull request");

  return (
    <Modal title={`Complete ${taskKey(task._id)}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px] text-ink-secondary">
        <p className="text-[14px] font-medium leading-snug text-ink">Done when its pull request merges</p>
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
              <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void openPullRequest()}>
                {action.busy ? <Loader2 size={14} className="animate-spin" /> : <GitPullRequest size={14} />}Open draft pull request
              </button>
              {task.githubIssueUrl && <a className={ghostButton} href={task.githubIssueUrl} target="_blank" rel="noreferrer">Issue #{number}<ExternalLink size={12} /></a>}
            </>
          ) : (
            <button type="button" className={primaryButton} disabled={action.busy} onClick={() => void mirror()}>
              {action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Create GitHub issue
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
