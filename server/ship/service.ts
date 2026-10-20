import type { BroadcastChannel } from "../../shared/broadcast.ts";
import {
  cleanReleaseNotes, fallbackReleaseNotes, releaseAnnouncement, releaseNotesPrompt, SHIP_PROVIDER_KEY, SHIP_PROVIDER_LABEL,
  type MergedPull, type ShipAction, type ShipDeployment, type ShipOverview, type ShipPreview, type ShipStatus, type ShipTarget, type ShipTargetStatus,
} from "../../shared/origin-ship.ts";
import { parseGitHubRepo } from "../github/repo.ts";
import type { OriginCloudClient } from "../origin-cloud.ts";
import type { ShipGitHub } from "./github.ts";
import { ShipError, type KeyedProvider, type ProviderClient, type ShipHttp } from "./providers.ts";

/** What Ship works with on this computer: the member's provider tokens, the project's GitHub connection and a cheap writer. */
export interface ShipRuntime {
  http: ShipHttp;
  providers: Record<KeyedProvider, ProviderClient>;
  github: ShipGitHub | null;
  /** Security: the member's own provider token, or one shared with the project or workspace, read only on this computer and never returned to a client or model. */
  token(provider: KeyedProvider, projectId?: string): string | null;
  /** The cheap model that writes release notes for a project's Chief; absent, notes come from pull request titles. */
  summarize?(input: { botId: string; prompt: string }): Promise<string>;
  /** Text-only Broadcast channels this computer can publish to. */
  channels(): BroadcastChannel[];
  now(): number;
}

/** A project as the signed-in person or the connected Origin account sees it. */
export interface ShipScope {
  client: OriginCloudClient;
  sessionToken: string;
  projectId: string;
}

const CACHE_MS = 8_000;
const cache = new Map<string, { at: number; value: Promise<ShipTargetStatus> }>();

export async function shipOverview(scope: ShipScope): Promise<ShipOverview> {
  return await scope.client.query("ship:overview", { sessionToken: scope.sessionToken, projectId: scope.projectId }) as ShipOverview;
}

function repoOf(overview: ShipOverview) {
  return overview.repoUrl ? parseGitHubRepo(overview.repoUrl) : null;
}

async function loadTarget(runtime: ShipRuntime, scope: ShipScope, overview: ShipOverview, target: ShipTarget): Promise<ShipTargetStatus> {
  const empty = { targetId: target._id, deployments: [] as ShipDeployment[] };
  if (target.provider === "github-actions") {
    if (!overview.repoUrl) return { ...empty, connected: false, error: "Link the project's GitHub repository first." };
    if (!runtime.github) return { ...empty, connected: false, error: "GitHub is not available on this computer." };
    return { ...empty, connected: true, deployments: await runtime.github.runs(scope.projectId, overview.repoUrl, target) };
  }
  const provider = SHIP_PROVIDER_KEY[target.provider]!;
  const token = runtime.token(provider, scope.projectId);
  if (!token) return { ...empty, connected: false };
  return { ...empty, connected: true, deployments: await runtime.providers[provider].deployments(target, token) };
}

function targetStatus(runtime: ShipRuntime, scope: ShipScope, overview: ShipOverview, target: ShipTarget, fresh = false): Promise<ShipTargetStatus> {
  const key = `${scope.projectId}:${target._id}:${target.updatedAt}:${runtime.token(SHIP_PROVIDER_KEY[target.provider] ?? "vercel", scope.projectId) ? 1 : 0}`;
  const hit = cache.get(key);
  if (!fresh && hit && runtime.now() - hit.at < CACHE_MS) return hit.value;
  const value = loadTarget(runtime, scope, overview, target).catch((error: unknown) => {
    cache.delete(key);
    return { targetId: target._id, connected: true, deployments: [], error: error instanceof Error ? error.message : String(error) };
  });
  cache.set(key, { at: runtime.now(), value });
  return value;
}

export function forgetShipCache(): void {
  cache.clear();
}

export async function shipStatus(runtime: ShipRuntime, scope: ShipScope, overview?: ShipOverview, fresh = false): Promise<ShipStatus> {
  const resolved = overview ?? await shipOverview(scope);
  const targets = await Promise.all(resolved.targets.map((target) => targetStatus(runtime, scope, resolved, target, fresh)));
  return { targets, keys: { vercel: Boolean(runtime.token("vercel", scope.projectId)), netlify: Boolean(runtime.token("netlify", scope.projectId)), cloudflare: Boolean(runtime.token("cloudflare", scope.projectId)) } };
}

export function findTarget(overview: ShipOverview, wanted: string): ShipTarget | undefined {
  const key = wanted.trim().toLowerCase();
  return overview.targets.find((target) => target._id === wanted) ?? overview.targets.find((target) => target.name.toLowerCase() === key);
}

/** Runs a deploy action on a target for a project admin, after checking the provider allows it on that deployment. */
export async function shipAct(runtime: ShipRuntime, scope: ShipScope, overview: ShipOverview, target: ShipTarget, action: ShipAction, deploymentId?: string): Promise<string> {
  if (!overview.isAdmin) throw new ShipError("Deploying needs a project admin.", 403);
  let deployment: ShipDeployment | undefined;
  if (action !== "deploy") {
    const status = await targetStatus(runtime, scope, overview, target, true);
    if (status.error) throw new ShipError(status.error);
    deployment = status.deployments.find((candidate) => candidate.id === deploymentId);
    if (!deployment) throw new ShipError(`${target.name} has no recent deployment ${String(deploymentId ?? "").slice(0, 40)}.`, 404);
    if (!(deployment.actions as string[]).includes(action)) throw new ShipError(`That deployment cannot ${action === "rollback" ? "be rolled back to" : action === "promote" ? "be promoted" : "be redeployed"} on ${SHIP_PROVIDER_LABEL[target.provider]}.`, 409);
  }
  let said: string;
  if (target.provider === "github-actions") {
    if (!overview.repoUrl || !runtime.github) throw new ShipError("Link the project's GitHub repository first.", 409);
    if (action === "deploy") {
      await runtime.github.dispatch(scope.projectId, overview.repoUrl, target);
      said = `GitHub Actions started ${target.ref} on ${target.branch}.`;
    } else if (action === "redeploy" && deployment) {
      await runtime.github.rerun(scope.projectId, overview.repoUrl, deployment.id);
      said = `GitHub Actions is re-running that ${target.ref} run.`;
    } else {
      throw new ShipError("GitHub Actions runs can only be started or re-run.", 400);
    }
  } else {
    const provider = SHIP_PROVIDER_KEY[target.provider]!;
    const token = runtime.token(provider, scope.projectId);
    if (!token) throw new ShipError(`Add your ${SHIP_PROVIDER_LABEL[target.provider]} token in Settings > Integrations first.`, 409);
    said = await runtime.providers[provider].act(target, token, action, deployment, repoOf(overview));
  }
  forgetShipCache();
  return said;
}

/** The newest preview of each pull request's branch on every target that builds previews. */
export async function shipPreviews(runtime: ShipRuntime, scope: ShipScope, pulls: readonly { number: number; branch: string }[]): Promise<Record<number, ShipPreview[]>> {
  const overview = await shipOverview(scope);
  const targets = overview.targets.filter((target) => target.provider !== "github-actions");
  const statuses = await Promise.all(targets.map((target) => targetStatus(runtime, scope, overview, target)));
  const found: Record<number, ShipPreview[]> = {};
  for (const pull of pulls) {
    const previews: ShipPreview[] = [];
    targets.forEach((target, index) => {
      const match = statuses[index]!.deployments.filter((deployment) => !deployment.production && deployment.url
        && (deployment.pullRequest === pull.number || (deployment.branch !== undefined && deployment.branch === pull.branch)))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (match) previews.push({ targetId: target._id, targetName: target.name, provider: target.provider, branch: match.branch ?? pull.branch, state: match.state, url: match.url!, createdAt: match.createdAt });
    });
    if (previews.length) found[pull.number] = previews;
  }
  return found;
}

export interface DraftInput {
  projectName: string;
  /** The Chief whose cheap model writes the notes, and who the draft is attributed to when it asked. */
  writer?: { botId: string; name: string };
  attributed?: boolean;
  tag?: string;
  title?: string;
  notes?: string;
  targetId?: string | null;
  announce?: boolean;
}

/** Drafts the next release from the pull requests merged since the last tag, or refreshes the project's open draft. */
export async function draftRelease(runtime: ShipRuntime, scope: ShipScope, input: DraftInput) {
  const overview = await shipOverview(scope);
  if (!overview.canEdit) throw new ShipError("Drafting a release needs edit access to the project.", 403);
  if (!overview.repoUrl) throw new ShipError("Link a GitHub repository to this project first.", 409);
  if (!runtime.github) throw new ShipError("GitHub is not available on this computer.", 409);
  const candidate = await runtime.github.candidate(scope.projectId, overview.repoUrl);
  const tag = input.tag?.trim() || candidate.suggestedTag;
  let notes = input.notes?.trim() ?? "";
  let written = "given";
  if (!notes && candidate.pulls.length && input.writer && runtime.summarize) {
    const prompt = releaseNotesPrompt(input.projectName, tag, candidate.pulls.map((pull) => ({ ...pull, body: candidate.bodies[pull.number] })));
    notes = await runtime.summarize({ botId: input.writer.botId, prompt }).then(cleanReleaseNotes, () => "");
    written = notes ? "model" : "fallback";
  }
  if (!notes) {
    notes = fallbackReleaseNotes(candidate.pulls);
    if (written === "given") written = "fallback";
  }
  const existing = overview.releases.find((release) => release.status === "draft" || release.status === "failed");
  const releaseId = await scope.client.mutation("ship:saveRelease", {
    sessionToken: scope.sessionToken, projectId: scope.projectId, ...(existing ? { releaseId: existing._id } : {}),
    tag, notes, pulls: candidate.pulls as MergedPull[], baseTag: candidate.lastTag ?? "", ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.targetId !== undefined ? { targetId: input.targetId } : {}), ...(input.announce !== undefined ? { announce: input.announce } : {}),
    ...(input.attributed && input.writer ? { agent: input.writer } : {}),
  }) as string;
  return { releaseId, tag, pulls: candidate.pulls, lastTag: candidate.lastTag, defaultBranch: candidate.defaultBranch, notes, written, replaced: Boolean(existing) };
}

type PublishPlan = { tag: string; title: string; notes: string; announce: boolean; repoUrl: string; projectName: string; targetId?: string; agentName?: string; agentBotId?: string };

/** A project admin's approval: tags and publishes the release on GitHub, then deploys and drafts the announcement it asks for. */
export async function publishRelease(runtime: ShipRuntime, scope: ShipScope, releaseId: string, announcer?: { botId: string; name: string }) {
  if (!runtime.github) throw new ShipError("GitHub is not available on this computer.", 409);
  const base = { sessionToken: scope.sessionToken, projectId: scope.projectId, releaseId };
  const plan = await scope.client.mutation("ship:beginPublish", base) as PublishPlan;
  let url: string;
  try {
    ({ url } = await runtime.github.createRelease(scope.projectId, plan.repoUrl, plan));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await scope.client.mutation("ship:finishPublish", { ...base, error: message });
    throw error instanceof ShipError ? error : new ShipError(message);
  }
  const notes: string[] = [];
  const deployed: string[] = [];
  if (plan.targetId) {
    const overview = await shipOverview(scope);
    const target = overview.targets.find((candidate) => candidate._id === plan.targetId);
    if (target) {
      await shipAct(runtime, scope, overview, target, "deploy").then((said) => {
        deployed.push(said);
        notes.push(`Deploy started on ${target.name}.`);
      }, (error: unknown) => {
        const failed = `Deploying ${target.name} failed: ${error instanceof Error ? error.message : String(error)}`;
        deployed.push(failed);
        notes.push(failed);
      });
    }
  }
  let postId: string | undefined;
  if (plan.announce) {
    const author = plan.agentName ? { botId: plan.agentBotId || "origin-ship", name: plan.agentName } : announcer ?? { botId: "origin-ship", name: "Ship" };
    const long = releaseAnnouncement(plan.projectName, plan, url);
    const short = releaseAnnouncement(plan.projectName, { ...plan, notes: "" }, url);
    const channels = runtime.channels();
    postId = await scope.client.mutation("broadcast:save", {
      sessionToken: scope.sessionToken, projectId: scope.projectId, assetIds: [], agent: author,
      variants: (channels.length ? channels : ["x" as const]).map((channel) => ({ channel, text: channel === "x" || channel === "bluesky" ? short : long })),
    }).then(String, (error: unknown) => {
      const failed = `The announcement draft failed: ${error instanceof Error ? error.message : String(error)}`;
      deployed.push(failed);
      notes.push(failed);
      return undefined;
    });
  }
  await scope.client.mutation("ship:finishPublish", { ...base, releaseUrl: url, ...(notes.length ? { deployNote: notes.join(" ") } : {}), ...(postId ? { broadcastPostId: postId } : {}) });
  return { url, tag: plan.tag, deployed, postId };
}
