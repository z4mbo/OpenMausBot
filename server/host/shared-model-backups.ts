import { approvalModeFor } from "../../shared/approval-mode.ts";
import type { ModelSelection, ProviderInstance, ProviderSnapshot } from "../contracts.ts";
import { chooseModelBackup } from "../model-backup.ts";
import type { ModelSelectionCheck } from "../model-selection-check.ts";
import type { HostedRequest } from "../origin-hosted-requests.ts";
import type { SharedAgentsDeps } from "../origin-shared-agents.ts";
import type { Message, Store } from "../store.ts";

export function createSharedModelBackups(deps: {
  store: Pick<Store, "projectBotForTask" | "bot" | "taskByThread" | "messagesFor">;
  instance(instanceId: string): ProviderInstance | null;
  checkedLocal(selection: ModelSelection, current: undefined, requireAvailable: boolean): ModelSelectionCheck;
  providerRefusal(instance: ProviderInstance): string | undefined;
  validateHosted(botId: string, selection: ModelSelection, allowMetered: boolean): Promise<{ provider: string }>;
  fallbackRefusal(instance: ProviderInstance, botId: string, model: string, snapshot: ProviderSnapshot, allowApi: boolean): string | undefined;
  start(botId: string, text: string, options: { threadId: string; userMessage: Message; quotaFallbackVisited: string[]; quotaFallbackBlocked: string[]; quotaFallbackBlockedAccounts: string[] }): Promise<Message>;
}): Required<Pick<SharedAgentsDeps, "nextHostedBackup" | "startHostedSender">> {
  const { store } = deps;
  return {
    nextHostedBackup: async (request, current) => {
      const bot = store.projectBotForTask(request.botId, request.threadId);
      if (!bot || approvalModeFor(bot) !== "ask") return null;
      const picked = await chooseModelBackup({ chain: store.bot(bot.id)?.fallback ?? [], visited: new Set(request.visited), blockedAccounts: new Set(request.blockedAccounts), current,
        prepare: async selection => {
          if (selection.source) return { provider: (await deps.validateHosted(bot.id, selection, store.bot(bot.id)?.fallbackApiAllowed === true)).provider };
          const checked = deps.checkedLocal(selection, undefined, true);
          if (!checked.ok) return null;
          const target = deps.instance(checked.selection.instanceId);
          const task = store.taskByThread(bot.id, request.threadId);
          const cwd = task?.cwd !== undefined ? task.cwd : bot.cwd;
          if (!target?.enabled || deps.providerRefusal(target) || !cwd) return null;
          const snapshot = await target.snapshot();
          if (snapshot.state !== "available" || snapshot.authenticated === false || deps.fallbackRefusal(target, bot.id, selection.model, snapshot, store.bot(bot.id)?.fallbackApiAllowed === true)) return null;
          return { provider: target.driverKind };
        } });
      return picked ? { selection: picked.selection, provider: picked.value.provider } : null;
    },
    startHostedSender: async (request: HostedRequest) => {
      const message = store.messagesFor(request.threadId).find(message => message.id === request.messageId);
      if (!message?.text) throw new Error("The original shared request is missing");
      await deps.start(request.botId, message.text, { threadId: request.threadId, userMessage: message,
        quotaFallbackVisited: request.visited, quotaFallbackBlockedAccounts: request.blockedAccounts,
        quotaFallbackBlocked: request.blockedAccounts.flatMap(key => { try { const parts = JSON.parse(key); return Array.isArray(parts) && parts.length === 1 && typeof parts[0] === "string" ? [parts[0]] : []; } catch { return []; } }) });
    },
  };
}
