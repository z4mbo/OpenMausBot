import type { Message } from "@/state/store";
import { OriginIssuesCard } from "./OriginIssuesCard";
import { OriginPullRequestCard } from "./OriginPullRequestCard";
import { OriginChatCardView } from "./origin-cards/OriginChatCardView";

export const hasOriginToolCard = (message: Message): boolean => Boolean(message.originIssues || message.originPullRequest || message.originCard);

/** The UI an Origin tool's result shows in chat: issue cards, a pull request, or the post, asset, vault, repository, feedback or call it returned. */
export function OriginToolCard({ message }: { message: Message }) {
  if (message.originIssues) return <OriginIssuesCard message={message} />;
  if (message.originPullRequest) return <OriginPullRequestCard message={message} />;
  return <OriginChatCardView message={message} />;
}
