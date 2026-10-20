import { SHIP_PROVIDER_LABEL, type DeploymentState, type ShipAction, type ShipDeployment, type ShipRelease, type ShipTarget, type ShipTargetStatus } from "../../../shared/origin-ship";

export const STATE_LABEL: Record<DeploymentState, string> = { queued: "Queued", building: "Building", ready: "Ready", error: "Failed", canceled: "Canceled" };
export const STATE_TONE: Record<DeploymentState, string> = {
  queued: "text-warning", building: "text-warning", ready: "text-success", error: "text-danger", canceled: "text-ink-tertiary",
};
export const STATE_DOT: Record<DeploymentState, string> = {
  queued: "bg-warning/70", building: "bg-warning motion-safe:animate-pulse", ready: "bg-success", error: "bg-danger", canceled: "bg-ink-tertiary/60",
};
export const ACTION_LABEL: Record<Exclude<ShipAction, "deploy">, string> = { redeploy: "Redeploy", promote: "Promote", rollback: "Roll back" };

export function timeAgo(at: number, now = Date.now()): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The deployment serving production, else the newest production one, else the newest of any. */
export function liveDeployment(status: ShipTargetStatus | undefined): ShipDeployment | undefined {
  const rows = status?.deployments ?? [];
  return rows.find((row) => row.current) ?? rows.find((row) => row.production && row.state === "ready") ?? rows[0];
}

/** The address a target's card links: the deployment serving production, or the site address set on the target. */
export function productionUrl(target: ShipTarget, status: ShipTargetStatus | undefined): string | undefined {
  return target.siteUrl ?? status?.deployments.find((row) => row.current)?.url;
}

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function confirmText(target: ShipTarget, action: ShipAction, deployment?: ShipDeployment): string {
  const commit = deployment?.commitSha ? ` (${deployment.commitSha.slice(0, 7)})` : "";
  if (action === "deploy") {
    return target.provider === "github-actions" ? `Run ${target.ref} on ${target.branch}?` : `Deploy ${target.branch} to ${target.name} on ${SHIP_PROVIDER_LABEL[target.provider]}?`;
  }
  if (action === "promote") return `Promote this preview${commit} to production on ${target.name}?`;
  if (action === "rollback") return `Roll ${target.name} back to this deployment${commit}?`;
  return `Rebuild this deployment${commit} on ${target.name}?`;
}

/** What approving a release does, in order, for its confirmation. */
export function releaseSteps(release: Pick<ShipRelease, "tag" | "announce" | "targetId">, targets: readonly ShipTarget[]): string[] {
  const target = release.targetId ? targets.find((row) => row._id === release.targetId) : undefined;
  return [
    `Tag ${release.tag} on GitHub and publish its notes`,
    ...(target ? [`Deploy ${target.name} to production`] : []),
    ...(release.announce ? ["Draft an announcement in Broadcast for approval"] : []),
  ];
}

/** The request a person sends the Chief to ship the merged work. */
export function shipBrief(projectName: string, targets: readonly ShipTarget[]): string {
  const production = targets.find((target) => target.provider !== "github-actions") ?? targets[0];
  return [
    `Ship the merged work of ${projectName} to production.`,
    `Check what is merged and deployed with origin_ship_status, then draft the release with origin_release_draft${production ? ` (deploy_target "${production.name}", announce true)` : " (announce true)"}.`,
    "Write the notes for our users. I review and approve the release in Ship, which deploys it and drafts the announcement for Broadcast.",
  ].join(" ");
}
