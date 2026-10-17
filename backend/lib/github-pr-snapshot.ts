import { z } from "zod";

export const githubPR = z.object({ number: z.number().int().positive(), html_url: z.url(), node_id: z.string(), state: z.enum(["open", "closed"]), draft: z.boolean(), merged: z.boolean().optional(), merged_at: z.string().nullable().optional(), updated_at: z.string(), head: z.object({ ref: z.string(), sha: z.string().regex(/^[a-f0-9]{40,64}$/i), repo: z.object({ full_name: z.string() }).nullable() }), base: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/i), repo: z.object({ full_name: z.string() }) }), mergeable: z.boolean().nullable().optional(), body: z.string().nullable().optional() });
export type GitHubPR = z.infer<typeof githubPR>;
export type PRSnapshot = { number: number; url: string; branch: string; headSha: string; baseSha: string; state: "draft" | "open" | "closed" | "merged"; checks: string; review: string; mergeable: boolean | null; githubUpdatedAt: number };
export function checksSummary(runs: { status: string; conclusion: string | null }[], statuses: { state: string }[], truncated: boolean) {
  if (runs.some(r => r.status === "completed" && !["success", "neutral", "skipped"].includes(r.conclusion ?? "")) || statuses.some(s => ["failure", "error"].includes(s.state))) return "failure";
  if (truncated) return "unknown";
  if (runs.some(r => r.status !== "completed") || statuses.some(s => s.state === "pending")) return "pending";
  return runs.length + statuses.length ? "success" : "none";
}
export function toSnapshot(pr: GitHubPR, repo: string, checks: string, review: string): PRSnapshot {
  const updatedAt = Date.parse(pr.updated_at);
  if (!Number.isFinite(updatedAt) || pr.base.repo.full_name.toLowerCase() !== repo.toLowerCase() || pr.html_url.toLowerCase() !== `https://github.com/${repo}/pull/${pr.number}`.toLowerCase()) throw new Error("Unexpected PR repository or timestamp");
  return { number: pr.number, url: pr.html_url, branch: pr.head.ref, headSha: pr.head.sha, baseSha: pr.base.sha, state: pr.merged || pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open", checks, review, mergeable: pr.mergeable ?? null, githubUpdatedAt: updatedAt };
}
