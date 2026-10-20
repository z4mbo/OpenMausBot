import type { HandoffView } from "./coordinator.ts";
import { buildNotification, type Notification } from "./notify.ts";
import type { BotRecord, Store } from "./store.ts";

export function appendDelegationRequest(input: {
  store: Pick<Store, "messagesFor" | "appendMessage" | "bot">;
  node: HandoffView;
  resumed: boolean;
  request: { id: string; botIds: string[] };
  sender?: BotRecord | null;
  bot: BotRecord;
  routine: boolean;
  notify(notification: Notification | null): void;
}): void {
  const { store, node, request, sender, bot } = input;
  if (input.resumed || store.messagesFor(node.threadId).some(message => message.roomRequest?.id === request.id && message.roomRequest.phase === "request")) return;
  store.appendMessage(node.threadId, { role: "bot", kind: "text", roomRequest: { id: request.id, phase: "request" },
    ...(sender ? { from: { botId: sender.id, name: sender.name, color: sender.color } } : {}),
    text: `${request.botIds.map(id => `@${store.bot(id)?.name ?? "Teammate"}`).join(" ")} ${node.text}` });
  if (node.parentId && !input.routine) input.notify(buildNotification("delegation-started", bot, node.threadId, node.text, { avatarUrl: bot.avatarUrl }));
}
