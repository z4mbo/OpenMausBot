import type { Message } from "@/state/store";
import { OriginDesignCard } from "./OriginDesignCard";
import { OriginIssuesCard } from "./OriginIssuesCard";
import { OriginPullRequestCard } from "./OriginPullRequestCard";
import { OriginStudioCard } from "./OriginStudioCard";
import { OriginChatCardView } from "./origin-cards/OriginChatCardView";

export const hasOriginToolCard = (message: Message): boolean => Boolean(message.originIssues || message.originPullRequest || message.originStudio || message.originDesign || message.originCard);

/** The UI an Origin tool's result shows in chat: issue cards, a pull request, Studio media and presets, a design, or the post, asset, vault, repository, feedback or call it returned. */
export function OriginToolCard({ message }: { message: Message }) {
  if (message.originIssues) return <OriginIssuesCard message={message} />;
  if (message.originPullRequest) return <OriginPullRequestCard message={message} />;
  if (message.originDesign) return <OriginDesignCard message={message} />;
  if (message.originCard) return <OriginChatCardView message={message} />;
  return <OriginStudioCard message={message} />;
}
