import type { Message, Task } from "@/state/store";

export type DelegationStatus = "queued" | "working" | "approval" | "done" | "failed";

export function isDelegatedThread(task: Pick<Task, "openedBy">, ownerId: string): boolean {
  return Boolean(task.openedBy && task.openedBy.botId !== ownerId);
}

export function isDelegationChip(message: Message, threadBotId: string): boolean {
  return message.kind === "activity" && message.roomRequest?.phase === "sent" && Boolean(message.threadRef) && message.threadRef!.botId !== threadBotId;
}

export function delegatedRequestIds(messages: readonly Message[], threadBotId: string): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) if (isDelegationChip(message, threadBotId)) ids.add(message.roomRequest!.id);
  return ids;
}

export function resultShownInBlock(message: Message, delegated: ReadonlySet<string>): boolean {
  return message.roomRequest?.phase === "result" && message.tool?.ok === true && delegated.has(message.roomRequest.id);
}

export function delegationSegment(messages: readonly Message[], requestId: string): Message[] {
  const start = messages.findIndex((message) => message.roomRequest?.phase === "request" && message.roomRequest.id === requestId);
  if (start < 0) return [];
  const end = messages.findIndex((message, index) => index > start && message.roomRequest?.phase === "request");
  return messages.slice(start, end < 0 ? undefined : end);
}

export function delegationBrief(request: Message | undefined, agentName: string): string {
  const text = request?.text?.trim() ?? "";
  const mention = `@${agentName}`;
  return (text.startsWith(mention) ? text.slice(mention.length) : text).replace(/\s+/g, " ").trim();
}

export function delegationStatus(segment: readonly Message[], options: { working: boolean; pendingApproval: boolean; failed: boolean }): DelegationStatus {
  if (options.pendingApproval) return "approval";
  if (options.failed) return "failed";
  if (!segment.length) return "queued";
  const settled = segment.findLast((message) => message.turnTerminal);
  if (options.working || !settled) return "working";
  return settled.turnSucceeded === false ? "failed" : "done";
}

export function failedRequestIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) if (message.roomRequest?.phase === "result" && message.tool?.ok === false) ids.add(message.roomRequest.id);
  return ids;
}
