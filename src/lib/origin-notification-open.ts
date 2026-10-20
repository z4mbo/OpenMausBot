import { useStore } from "@/state/store";
import { openBot, openBotThread } from "@/state/thread-navigation";
import { requestAgentThreadFocus, requestChatFocus } from "./origin-chat-focus";
import { setChiefSectionOf } from "./origin-chief-section";
import { useCloudLinks } from "./origin-cloud-links";
import { projectBotFor, useOpenOriginIssue } from "./origin-issue-focus";
import { openOriginPage } from "./origin-pages";
import { requestLeadFocus } from "./origin-lead-focus";
import { useShowThreads } from "./thread-preferences";

/** Where an Origin notification points: an issue, a member chat message, or a line of a shared agent thread. */
export interface OriginNotificationTarget {
  projectId?: string;
  taskId?: string;
  messageId?: string;
  conversation?: string;
  agentThreadId?: string;
  leadId?: string;
  available: boolean;
}

export type OpenOutcome = "opened" | "elsewhere" | "gone";

/** Opens what a notification is about; "elsewhere" when its project or thread has not reached this app yet. */
export function useOpenOriginNotification(): (target: OriginNotificationTarget) => OpenOutcome {
  const { state, dispatch } = useStore();
  const { projects } = useCloudLinks();
  const showThreads = useShowThreads();
  const openIssue = useOpenOriginIssue();
  return (target) => {
    const { messageId, conversation, agentThreadId } = target;
    if (messageId && agentThreadId) {
      for (const bot of state.bots) {
        const task = bot.tasks?.find((candidate) => candidate.shared?.cloudThreadId === agentThreadId);
        if (!task) continue;
        requestAgentThreadFocus({ cloudThreadId: agentThreadId, cloudMessageId: messageId });
        setChiefSectionOf(bot.id, "chat");
        openOriginPage(null);
        openBotThread(dispatch, bot, task.threadId, showThreads);
        return "opened";
      }
      return "elsewhere";
    }
    if (messageId && conversation?.startsWith("project:")) {
      const botId = projectBotFor(projects, state.bots, conversation.slice("project:".length));
      const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
      if (!bot) return "elsewhere";
      requestChatFocus({ conversation, messageId });
      setChiefSectionOf(bot.id, "team-chat");
      openOriginPage(null);
      openBot(dispatch, bot, showThreads);
      return "opened";
    }
    if (messageId) {
      if (conversation !== undefined) requestChatFocus({ conversation, messageId });
      openOriginPage("chat");
      return "opened";
    }
    if (target.leadId && target.projectId) {
      if (!target.available) return "gone";
      const botId = projectBotFor(projects, state.bots, target.projectId);
      const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
      if (!bot) return "elsewhere";
      requestLeadFocus({ projectId: target.projectId, leadId: target.leadId });
      setChiefSectionOf(bot.id, "pipeline");
      openOriginPage(null);
      openBot(dispatch, bot, showThreads);
      return "opened";
    }
    if (!target.available || !target.projectId || !target.taskId) return "gone";
    return openIssue({ projectId: target.projectId, issueId: target.taskId }) ? "opened" : "elsewhere";
  };
}
