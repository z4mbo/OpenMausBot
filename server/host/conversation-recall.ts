import { autoRecallEnabled, type AppConfig } from "../config.ts";
import { buildRecall, recallRooms, recallThreadIds } from "../recall.ts";
import type { BotRecord, GroupRecord, Store } from "../store.ts";

export function createConversationRecall(deps: {
  store(): Pick<Store, "botByThread" | "taskByThread" | "groups">;
  cfg: AppConfig;
  cloudHome: boolean;
  cloudOwnerOnlyThread(threadId: string): boolean;
  roomFeedsBot(group: GroupRecord, bot: BotRecord): boolean;
  cloudLendingView(capability: { botId: string; threadId: string; generation: string }): boolean;
}) {
  const { cfg, cloudOwnerOnlyThread, roomFeedsBot, cloudLendingView } = deps;
  const CLOUD_HOME = deps.cloudHome;
  function hostedRequestThread(threadId: string): boolean {
    const store = deps.store();
    const bot = store.botByThread(threadId);
    return Boolean(bot && store.taskByThread(bot.id, threadId)?.hostedRequest);
  }

  function recentWorkFilter(): { include: (threadId: string) => boolean } {
    return { include: threadId => !hostedRequestThread(threadId) && (!CLOUD_HOME || cloudOwnerOnlyThread(threadId)) };
  }

  function recentWorkSources(bot: BotRecord) {
    const store = deps.store();
    return {
      groups: store.groups.filter((group) => !group.memberIds.includes(bot.id) || roomFeedsBot(group, bot)),
      taskByThread: (botId: string, threadId: string) => store.taskByThread(botId, threadId),
    };
  }

  function recallThreads(from: BotRecord, capability: Parameters<typeof cloudLendingView>[0]): { roomByThread: Map<string, GroupRecord>; ownThreads: string[] } {
    const store = deps.store();
    const roomByThread = recallRooms(store.groups, from, roomFeedsBot);
    return { roomByThread, ownThreads: recallThreadIds(from, roomByThread).filter(threadId => !hostedRequestThread(threadId) && (!cloudLendingView(capability) || cloudOwnerOnlyThread(threadId))) };
  }

  /** Other conversations only for a 1:1 turn the person started: another bot, a webhook or a room must not pull a private chat into its reply. */
  function autoRecallPrompt(bot: BotRecord, threadId: string, message: string, opts: { conversations: boolean; userName: string }): string {
    const store = deps.store();
    if (bot.memoryEnabled === false || !autoRecallEnabled(cfg)) return "";
    const roomByThread = opts.conversations ? recallRooms(store.groups, bot, roomFeedsBot) : new Map<string, GroupRecord>();
    const threadIds = opts.conversations
      ? recallThreadIds(bot, roomByThread).filter((id) => id !== threadId && !hostedRequestThread(id) && (!CLOUD_HOME || cloudOwnerOnlyThread(id)))
      : [];
    try {
      const recalled = buildRecall({
        botId: bot.id,
        message,
        threadIds,
        label: (id) => {
          const room = roomByThread.get(id);
          if (room) return `room ${JSON.stringify(room.name)}`;
          const task = store.taskByThread(bot.id, id);
          if (task) return `chat ${JSON.stringify(task.title)}`;
          return id === bot.threadId ? "your main chat" : "an earlier chat";
        },
        author: (hit) => (hit.role === "user" ? hit.peer ?? opts.userName : hit.from ?? bot.name),
      });
      if (recalled) console.log(`auto-recall: ${bot.name} (${bot.id}) got ${recalled.notes} note and ${recalled.conversations} conversation passage(s) in ${threadId}`);
      return recalled?.text ?? "";
    } catch (err) {
      console.warn(`auto-recall failed for ${bot.id}: ${(err as Error).message}`);
      return "";
    }
  }

  return { hostedRequestThread, recentWorkFilter, recentWorkSources, recallThreads, autoRecallPrompt };
}
