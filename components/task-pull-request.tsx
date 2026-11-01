"use client";
import { GitPullRequest } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { localApi } from "@/lib/client-api";

type PullRequest = Pick<Doc<"taskPullRequests">, "_id" | "url" | "number" | "state" | "checks" | "review" | "mergeable">;

/** Pull requests linked to an issue, one compact line each. */
export function TaskPullRequests({ prs }: { prs: PullRequest[] }) {
  return <>{prs.map(pr => {
    const facts = [pr.state, pr.checks && pr.checks !== "unknown" ? `checks ${pr.checks}` : "", pr.review && pr.review !== "none" ? pr.review.replace(/_/g, " ") : "", pr.mergeable === false ? "conflicts" : ""].filter(Boolean);
    return <a key={pr._id} className="issue-github-link" href={pr.url} target="_blank" rel="noreferrer"><GitPullRequest size={14} /><span>#{pr.number}</span><small>{facts.join(" · ")}</small></a>;
  })}</>;
}

/** Asks the server to open a (draft) pull request for the issue; resolves to the server's message. */
export async function createTaskPullRequest(projectId: Id<"projects">, taskId: Id<"tasks">, sessionToken: string) {
  const result = await localApi<{ message: string }>("/api/github/pull-requests", sessionToken, { method: "POST", json: { projectId, taskId } });
  return result.message;
}
