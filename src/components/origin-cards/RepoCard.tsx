import { CircleDot, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, ShieldAlert, ShieldCheck } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import type { OriginChatCard } from "../../../shared/origin-chat-cards";
import { CHECKS, REVIEWS } from "../OriginPullRequestCard";
import { CardFrame, rowButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "repo" }>;

const PROTECTION = {
  on: { label: "Protected", icon: ShieldCheck, tone: "bg-success/12 text-success" },
  off: { label: "Not protected", icon: ShieldAlert, tone: "bg-warning/12 text-warning" },
  unknown: { label: "Protection unknown", icon: ShieldAlert, tone: "bg-raised/70 text-ink-tertiary" },
} as const;

export function RepoCard({ card }: { card: Card }) {
  const { repo } = card;
  const opener = useItemOpener(card.projectId);
  const protection = PROTECTION[repo.protection];
  const Shield = protection.icon;
  return (
    <CardFrame kind="repo" label={`Repository ${repo.slug}`} icon={GitBranch} title={repo.slug}
      meta={[card.projectName, repo.defaultBranch && `default ${repo.defaultBranch}`].filter(Boolean).join(" · ")}
      openLabel="Open Repo" onOpen={() => opener.open({ kind: "repo" })} openable={opener.openable}>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-medium", protection.tone)}><Shield size={11} aria-hidden="true" />{protection.label}</span>
        <span className="text-[12px] text-ink-tertiary">{repo.pulls.length ? `${repo.pulls.length} open pull request${repo.pulls.length === 1 ? "" : "s"}` : "No open pull requests"}</span>
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-1 text-[12px] text-ink-tertiary outline-none transition-colors duration-(--motion-fast) hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          onClick={() => void openExternalLink(repo.url)}>GitHub<ExternalLink size={11} aria-hidden="true" /></button>
      </div>
      {repo.pulls.length > 0 && (
        <ul className="-mx-2 mt-1.5 flex flex-col gap-0.5" aria-label="Open pull requests">
          {repo.pulls.map((pr) => {
            const checks = pr.checks ? CHECKS[pr.checks] : undefined;
            return (
              <li key={pr.number}>
                <button type="button" className={rowButton} disabled={!opener.openable} title={opener.title ?? pr.title} onClick={() => opener.open({ kind: "repo", itemId: `pr:${pr.number}` })}>
                  <GitPullRequest size={14} className={cn("shrink-0", pr.draft ? "text-ink-tertiary" : "text-success")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{pr.title}</span>
                    <span className="block truncate text-[11.5px] text-ink-tertiary">#{pr.number}{pr.draft ? " · draft" : ""}{pr.branch ? ` · ${pr.branch}` : ""}{pr.review ? ` · ${REVIEWS[pr.review] ?? pr.review}` : ""}</span>
                  </span>
                  {checks && <span className={cn("flex shrink-0 items-center gap-1 text-[11.5px]", checks.tone)}><CircleDot size={11} aria-hidden="true" />{checks.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {repo.commits.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-hairline/30 pt-2" aria-label="Recent commits">
          {repo.commits.map((commit) => (
            <li key={commit.sha} className="flex min-w-0 items-center gap-2 text-[12px]">
              <GitCommitHorizontal size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
              <code className="shrink-0 font-mono text-[11.5px] text-ink-tertiary">{commit.sha.slice(0, 7)}</code>
              <span className="min-w-0 flex-1 truncate text-ink-secondary">{commit.message}</span>
            </li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
}
