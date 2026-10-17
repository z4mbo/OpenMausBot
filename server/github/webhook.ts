import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_MAX_BYTES = 1_000_000;
export const WEBHOOK_EVENTS: ReadonlySet<string> = new Set(["issues", "pull_request", "pull_request_review", "check_suite", "check_run"]);

export function verifyGitHubSignature(body: string, signature: string, secret: string): boolean {
  return Buffer.byteLength(body) <= WEBHOOK_MAX_BYTES && /^sha256=[a-f0-9]{64}$/.test(signature)
    && timingSafeEqual(Buffer.from(signature.slice(7), "hex"), createHmac("sha256", secret).update(body).digest());
}

export interface GitHubEvent { repoUrl: string; numbers: number[]; headSha?: string; deliveryId: string; fingerprint: string }

export function parseGitHubEvent(body: string, kind: string, deliveryId: string): GitHubEvent {
  if (!/^[\w-]{1,200}$/.test(deliveryId)) throw new Error("Delivery ID required");
  const payload = JSON.parse(body) as Record<string, any>;
  const repo: unknown = payload.repository?.full_name;
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) throw new Error("Invalid repository");
  const check = kind === "check_run" || kind === "check_suite";
  const item = kind === "check_run" ? payload.check_run : payload.check_suite;
  const numbers: unknown[] = kind === "issues" ? [payload.issue?.number]
    : kind === "pull_request" || kind === "pull_request_review" ? [payload.pull_request?.number]
    : Array.isArray(item?.pull_requests) ? item.pull_requests.map((pr: { number?: unknown }) => pr.number) : [];
  if (numbers.length > 100 || numbers.some((n) => !Number.isSafeInteger(n) || Number(n) < 1) || (!check && !numbers.length)) throw new Error("Invalid issue or PR number");
  const headSha: unknown = check ? item?.head_sha : undefined;
  if (check && (typeof headSha !== "string" || !/^[a-f0-9]{40,64}$/i.test(headSha))) throw new Error("Invalid head SHA");
  return {
    repoUrl: `https://github.com/${repo}`,
    numbers: numbers as number[],
    ...(typeof headSha === "string" ? { headSha } : {}),
    deliveryId,
    fingerprint: createHash("sha256").update(`${kind}\n${body}`).digest("hex"),
  };
}
