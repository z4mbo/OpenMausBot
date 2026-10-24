import type { WireMessage } from "../shared/wire.ts";
import { redactOriginCard } from "../shared/origin-chat-cards.ts";
import { redactSecretsInText } from "./redact.ts";

type ToolCards = Pick<WireMessage, "originIssues" | "originPullRequest" | "originCard">;

export function redactToolCards<T extends ToolCards>(out: T): void {
  if (out.originIssues) out.originIssues = { ...out.originIssues, heading: redactSecretsInText(out.originIssues.heading), issues: out.originIssues.issues.map((issue) => ({ ...issue, title: redactSecretsInText(issue.title) })) };
  if (out.originCard) out.originCard = redactOriginCard(out.originCard, redactSecretsInText);
  if (out.originPullRequest) out.originPullRequest = {
    ...out.originPullRequest,
    title: redactSecretsInText(out.originPullRequest.title),
    ...(out.originPullRequest.blocker === undefined ? {} : { blocker: redactSecretsInText(out.originPullRequest.blocker) }),
  };
}
