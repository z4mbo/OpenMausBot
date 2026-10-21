import { capped, type OriginChatCard } from "../shared/origin-chat-cards.ts";
import { assetCardItem, feedbackCardItem } from "../shared/origin-chat-card-items.ts";
import type { OriginCloudClient, OriginToolResult } from "./origin-cloud.ts";
import type { BotRecord, Message, Store } from "./store.ts";

type CardFields = Pick<Message, "originIssues" | "originPullRequest" | "originStudio" | "originDesign" | "originCard">;

export function appendOriginCards(
  store: Pick<Store, "appendMessage" | "groupByThread">,
  turn: { threadId: string },
  bot: Pick<BotRecord, "id" | "name" | "color">,
  name: string,
  result: OriginToolResult,
): Omit<OriginToolResult, "cards" | "pullRequest" | "studio" | "design" | "card"> {
  const { cards, pullRequest, studio, design, card, ...answer } = result;
  const shown: CardFields[] = result.isError ? [] : [
    ...(pullRequest ? [{ originPullRequest: pullRequest }] : []),
    ...(cards ? [{ originIssues: cards }] : []),
    ...(studio ? [{ originStudio: studio }] : []),
    ...(design ? [{ originDesign: design }] : []),
    ...(card ? [{ originCard: card }] : []),
  ];
  for (const fields of shown) {
    const message: Omit<Message, "id" | "at"> = { role: "bot", kind: "activity", tool: { name, ok: true }, ...fields };
    if (store.groupByThread(turn.threadId)) message.from = { botId: bot.id, name: bot.name, color: bot.color };
    store.appendMessage(turn.threadId, message);
  }
  return answer;
}

type Args = Record<string, unknown>;
type CloudScope = { client: OriginCloudClient; sessionToken: string; projectId: string };

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

export function assetsCard(projectId: string, projectName: string | undefined, assets: readonly unknown[], heading: string): OriginChatCard {
  const { items, more } = capped(assets.map(assetCardItem));
  return { kind: "assets", projectId, ...(projectName ? { projectName } : {}), heading, assets: items, ...(more ? { more } : {}) };
}

export async function addedAssetCard(scope: CloudScope, projectName: string, assetId: string): Promise<OriginChatCard | undefined> {
  const listed = await scope.client.query("design:list", { projectId: scope.projectId, sessionToken: scope.sessionToken }).catch(() => null);
  const asset = (Array.isArray((listed as Args | null)?.assets) ? (listed as { assets: Args[] }).assets : []).find((candidate) => candidate._id === assetId);
  return asset ? assetsCard(scope.projectId, projectName, [asset], "Added to Assets") : undefined;
}

export function feedbackCard(projectId: string, projectName: string, teamId: string, entries: readonly unknown[], heading: string): OriginChatCard {
  const { items, more } = capped(entries.map(feedbackCardItem));
  return { kind: "feedback", projectId, projectName, teamId, heading, entries: items, ...(more ? { more } : {}) };
}

export async function repoCard(scope: CloudScope, projectName: string, repo: { slug: string; web: string }, defaultBranch: string, open: readonly Args[], linked: ReadonlyMap<string, Args>, commits: readonly Args[]): Promise<OriginChatCard> {
  const protection = await scope.client.query("githubProtection:status", { projectId: scope.projectId, sessionToken: scope.sessionToken }).catch(() => null) as { state?: string } | null;
  const { items: pulls } = capped(open, 6);
  return {
    kind: "repo", projectId: scope.projectId, projectName,
    repo: {
      slug: repo.slug, url: repo.web, ...(defaultBranch ? { defaultBranch } : {}),
      protection: protection?.state === "on" ? "on" : protection ? "off" : "unknown",
      pulls: pulls.map((pr) => {
        const task = linked.get(text(pr.url));
        return {
          number: Number(pr.number), title: clip(text(pr.title), 200), url: text(pr.url), ...(text(pr.branch) ? { branch: text(pr.branch) } : {}),
          ...(text(pr.author) ? { author: text(pr.author) } : {}), ...(pr.draft === true || pr.state === "draft" ? { draft: true } : {}),
          ...(text(task?.checks) ? { checks: text(task?.checks) } : {}), ...(text(task?.review) ? { review: text(task?.review) } : {}),
        };
      }),
      commits: commits.slice(0, 3).map((commit) => ({
        sha: text(commit.sha).slice(0, 40), message: clip(text(commit.message).split("\n")[0] ?? "", 120),
        ...(text(commit.author) ? { author: text(commit.author) } : {}), ...(typeof commit.committedAt === "number" ? { at: commit.committedAt } : {}),
      })),
    },
  };
}

export const CARD_NOTE = "The person sees these as a card in chat they can open; do not repeat them.";
