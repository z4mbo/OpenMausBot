import type { Message } from "@/state/store";
import { OriginIssuesCard } from "./OriginIssuesCard";
import { OriginPullRequestCard } from "./OriginPullRequestCard";
import { OriginStudioCard } from "./OriginStudioCard";

export const hasOriginToolCard = (message: Message): boolean => Boolean(message.originIssues || message.originPullRequest || message.originStudio);

/** The UI an Origin tool's result shows in chat: issue cards, a pull request, or Studio media and presets. */
export function OriginToolCard({ message }: { message: Message }) {
  if (message.originIssues) return <OriginIssuesCard message={message} />;
  if (message.originPullRequest) return <OriginPullRequestCard message={message} />;
  return <OriginStudioCard message={message} />;
}
