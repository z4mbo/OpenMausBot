import type { WireMessage } from "../shared/wire.ts";
import { withStudioCardText } from "../shared/origin-studio-cards.ts";
import { redactSecretsInText } from "./redact.ts";

type ToolCards = Pick<WireMessage, "originIssues" | "originStudio" | "originDesign" | "originPullRequest">;

export function redactToolCards<T extends ToolCards>(out: T): void {
  if (out.originIssues) out.originIssues = { ...out.originIssues, heading: redactSecretsInText(out.originIssues.heading), issues: out.originIssues.issues.map((issue) => ({ ...issue, title: redactSecretsInText(issue.title) })) };
  if (out.originStudio) out.originStudio = withStudioCardText(out.originStudio, redactSecretsInText);
  if (out.originDesign) out.originDesign = { ...out.originDesign, heading: redactSecretsInText(out.originDesign.heading), canvasName: redactSecretsInText(out.originDesign.canvasName), frames: out.originDesign.frames.map((frame) => ({ ...frame, name: redactSecretsInText(frame.name) })) };
  if (out.originPullRequest) out.originPullRequest = {
    ...out.originPullRequest,
    title: redactSecretsInText(out.originPullRequest.title),
    ...(out.originPullRequest.blocker === undefined ? {} : { blocker: redactSecretsInText(out.originPullRequest.blocker) }),
  };
}
