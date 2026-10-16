import type { Bot } from "@/state/store";
import { firstUnreadMessageId } from "./unread-divider";

/** Replies the person has not seen yet. Only the open thread's messages are loaded, so another unread thread counts as one. */
export function unreadReplies(bot: Pick<Bot, "threadId" | "unread" | "tasks" | "messages">): number {
  const tasks = bot.tasks?.length ? bot.tasks : [{ threadId: bot.threadId, unread: bot.unread }];
  let count = 0;
  for (const task of tasks) {
    if (!task.unread || ("routineRunId" in task && task.routineRunId) || ("archivedAt" in task && task.archivedAt !== undefined)) continue;
    if (task.threadId !== bot.threadId || !bot.messages?.length) { count += 1; continue; }
    const cursor = "lastReadMessageId" in task ? task.lastReadMessageId : undefined;
    const first = firstUnreadMessageId(bot.messages, cursor);
    const from = first ? bot.messages.findIndex((message) => message.id === first) : -1;
    const replies = from < 0 ? 0 : bot.messages.slice(from).filter((message) => message.role === "bot").length;
    count += Math.max(1, replies);
  }
  return count;
}
