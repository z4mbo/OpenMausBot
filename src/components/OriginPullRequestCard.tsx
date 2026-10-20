import { useState } from "react";
import { Check, CircleDot, ExternalLink, GitMerge, GitPullRequest, Loader2, X } from "lucide-react";
import type { Message } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { originGitHub } from "@/lib/origin-github";
import { cn } from "@/lib/cn";
import { pullRequestCardTone, type OriginPullRequestCard as Card } from "../../shared/origin-pull-request";
import { CardFrame, quietButton, solidButton } from "./origin-cards/CardFrame";

export const CHECKS: Record<string, { label: string; tone: string }> = {
  success: { label: "Checks passed", tone: "text-success" },
  failure: { label: "Checks failed", tone: "text-danger" },
  pending: { label: "Checks running", tone: "text-warning" },
  none: { label: "No checks", tone: "text-ink-tertiary" },
};
export const REVIEWS: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  commented: "Commented",
};

type Phase = { kind: "idle" } | { kind: "confirm" } | { kind: "working" } | { kind: "merged"; sha: string } | { kind: "error"; text: string };

export function mergeConfirmation(card: Pick<Card, "number" | "baseBranch" | "headSha">): string {
  return `Approve and merge #${card.number} into ${card.baseBranch} at ${card.headSha.slice(0, 7)}? This cannot be undone.`;
}

/** A pull request a Chief read, with Approve & merge behind an explicit confirmation by the person. */
export function OriginPullRequestCard({ message }: { message: Message }) {
  const card = message.originPullRequest;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  if (!card) return null;
  const tone = phase.kind === "merged" ? "done" : pullRequestCardTone(card);
  const checks = CHECKS[card.checks] ?? { label: "Checks unknown", tone: "text-ink-tertiary" };
  const open = card.state === "open" || card.state === "draft";

  const merge = async () => {
    setPhase({ kind: "working" });
    try {
      await originGitHub.review(card.projectId, card.number, "approve", "Approved in Origin.");
      const result = await originGitHub.review(card.projectId, card.number, "merge", undefined, card.headSha);
      setPhase({ kind: "merged", sha: result.sha ?? card.headSha });
    } catch (error) {
      setPhase({ kind: "error", text: error instanceof Error ? error.message : "Could not merge" });
    }
  };

  const meta = `#${card.number}${card.projectName ? ` · ${card.projectName}` : ""}${card.branch ? ` · ${card.branch} → ${card.baseBranch}` : ""}`;
  return (
    <CardFrame kind="pull-request" data={{ "data-origin-pull-request": String(card.number) }} label={`Pull request #${card.number}`}
      icon={tone === "done" ? GitMerge : GitPullRequest} iconClassName={tone === "done" ? undefined : tone === "ready" ? "text-success" : tone === "blocked" ? "text-danger" : "text-ink-tertiary"}
      title={card.title} titleHint={card.title} meta={meta} openLabel="Open on GitHub" openIcon={ExternalLink} onOpen={() => void openExternalLink(card.url)}>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <dt className="sr-only">Size</dt>
        <dd className="tabular-nums text-ink-secondary">
          <span className="text-success">+{card.additions}</span> <span className="text-danger">−{card.deletions}</span> · {card.files} file{card.files === 1 ? "" : "s"}
        </dd>
        <dt className="sr-only">Checks</dt>
        <dd className={cn("flex items-center gap-1", checks.tone)}><CircleDot size={11} aria-hidden="true" />{checks.label}</dd>
        <dt className="sr-only">Review</dt>
        <dd className="text-ink-secondary">{card.review ? REVIEWS[card.review] : "No review yet"}</dd>
        <dt className="sr-only">Closes</dt>
        <dd className="truncate text-ink-secondary">{card.closes.length ? `Closes ${card.closes.join(", ")}` : "Closes no issue"}</dd>
      </dl>

      {phase.kind === "merged" ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-success" role="status">
          <Check size={13} aria-hidden="true" />Merged ({phase.sha.slice(0, 7)}). The issues it closes complete on the next sync.
        </p>
      ) : !open ? (
        <p className="mt-2.5 text-[12px] text-ink-tertiary">{card.state === "merged" ? "Already merged." : "Closed."}</p>
      ) : card.blocker ? (
        <p className="mt-2.5 text-[12px] text-ink-tertiary">Not mergeable now: {card.blocker}.</p>
      ) : phase.kind === "confirm" || phase.kind === "working" ? (
        <div className="mt-2.5 flex flex-col gap-2 motion-safe:animate-pop-in" role="group" aria-label="Confirm merge">
          <p className="text-[12px] text-ink-secondary">{mergeConfirmation(card)}</p>
          <div className="flex gap-2">
            <button type="button" className={solidButton} disabled={phase.kind === "working"} onClick={() => void merge()}>
              {phase.kind === "working" ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />}Merge
            </button>
            <button type="button" className={quietButton} disabled={phase.kind === "working"} onClick={() => setPhase({ kind: "idle" })}>
              <X size={13} />Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {phase.kind === "error" && <p className="text-[12px] text-danger" role="alert">{phase.text}</p>}
          <button type="button" className={cn(solidButton, "self-start")} onClick={() => setPhase({ kind: "confirm" })}>
            <GitMerge size={13} />Approve &amp; merge
          </button>
        </div>
      )}
    </CardFrame>
  );
}
