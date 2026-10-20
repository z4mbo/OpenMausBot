import type { Message } from "@/state/store";
import { OriginDesignCard } from "./OriginDesignCard";
import { OriginIssuesCard } from "./OriginIssuesCard";
import { OriginPullRequestCard } from "./OriginPullRequestCard";
import { OriginStudioCard } from "./OriginStudioCard";

export const hasOriginToolCard = (message: Message): boolean => Boolean(message.originIssues || message.originPullRequest || message.originStudio || message.originDesign);

/** The UI an Origin tool's result shows in chat: issue cards, a pull request, Studio media and presets, or a design. */
export function OriginToolCard({ message }: { message: Message }) {
  if (message.originIssues) return <OriginIssuesCard message={message} />;
  if (message.originPullRequest) return <OriginPullRequestCard message={message} />;
  if (message.originDesign) return <OriginDesignCard message={message} />;
  return <OriginStudioCard message={message} />;
}
