import type { Message } from "@/state/store";
import type { OriginChatCard } from "../../../shared/origin-chat-cards";
import { MessageBoundary } from "../MessageBoundary";
import { AssetsCard } from "./AssetsCard";
import { BroadcastCard } from "./BroadcastCard";
import { CallCard } from "./CallCard";
import { CampaignCard } from "./CampaignCard";
import { FeedbackCard } from "./FeedbackCard";
import { RepoCard } from "./RepoCard";
import { VaultCard } from "./VaultCard";

function ChatCard({ card }: { card: OriginChatCard }) {
  switch (card.kind) {
    case "broadcast": return <BroadcastCard card={card} />;
    case "campaign": return <CampaignCard card={card} />;
    case "assets": return <AssetsCard card={card} />;
    case "vault": return <VaultCard card={card} />;
    case "repo": return <RepoCard card={card} />;
    case "feedback": return <FeedbackCard card={card} />;
    case "call": return <CallCard card={card} />;
    default: return null;
  }
}

export function OriginChatCardView({ message }: { message: Message }) {
  if (!message.originCard) return null;
  return <MessageBoundary fallbackText=""><ChatCard card={message.originCard} /></MessageBoundary>;
}
