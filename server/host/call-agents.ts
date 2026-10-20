import { randomUUID } from "node:crypto";
import { createAgentCard } from "../chat-widgets.ts";
import type { AppConfig } from "../config.ts";
import type { ApiRequestBudget, ModelSelection, ProviderInstance } from "../contracts.ts";
import { awaitBotReply, CallAgentError, createCallAgents, createCallAgentSettingsRoutes, readCallAgentSettings, transcribeWith } from "../origin-call-agent.ts";
import { recordCallNotes } from "../origin-call-notes.ts";
import type { RequestAuth } from "../request-auth.ts";
import { helperSelection } from "../side-jobs.ts";
import type { BotRecord, Store } from "../store.ts";

export function createCallAgentHost(deps: {
  file: string;
  store: Store;
  cfg: AppConfig;
  instance(instanceId: string): ProviderInstance | null;
  providerRefusal(instance: ProviderInstance): string | undefined;
  hostedModels(): { allows(selection: ModelSelection): boolean; error(): string } | null | undefined;
  visible(auth: RequestAuth, botId: string): boolean;
  project(botId: string): string | null | undefined;
  send(bot: BotRecord, auth: RequestAuth, prompt: string, sendId: string): Promise<void>;
  assertBudget(): void;
  unpricedApiBudget(botId: string, service: string): void;
  apiBudget(instance: ProviderInstance, botId: string, model?: string): Promise<ApiRequestBudget | undefined>;
}) {
  const { cfg, store } = deps;
  let callAgentSettings = readCallAgentSettings(deps.file);
  const settingsRoute = createCallAgentSettingsRoutes({
    file: deps.file,
    keys: () => ({ groq: Boolean(cfg.groq?.key), openai: Boolean(cfg.openai?.key) }),
    changed: (settings) => { callAgentSettings = settings; },
  });
  /** No model named: the engine's own quick-call choice, its cheapest, rather than the chief's chat model. */
  function callSummaryWriter(bot: BotRecord): { instance: ProviderInstance; model?: string } {
    const chosen = callAgentSettings.summarizer.instanceId
      ? { instanceId: callAgentSettings.summarizer.instanceId, ...(callAgentSettings.summarizer.model ? { model: callAgentSettings.summarizer.model } : {}) }
      : helperSelection(cfg) ?? { instanceId: bot.modelSelection.instanceId };
    const instance = deps.instance(chosen.instanceId);
    if (!instance?.enabled || !instance.generateText) throw new CallAgentError("The call summary model can't write text; pick another in Settings");
    const refusal = deps.providerRefusal(instance);
    if (refusal) throw new CallAgentError(refusal);
    const hostedModels = deps.hostedModels();
    if (hostedModels && chosen.instanceId !== bot.modelSelection.instanceId && !(chosen.model && hostedModels.allows({ instanceId: chosen.instanceId, model: chosen.model }))) {
      throw new CallAgentError(hostedModels.error());
    }
    return { instance, ...(chosen.model ? { model: chosen.model } : {}) };
  }
  const summarize = async ({ botId, prompt }: { botId: string; prompt: string }) => {
    const bot = store.bot(botId);
    if (!bot) throw new CallAgentError("The chief no longer exists");
    const writer = callSummaryWriter(bot);
    deps.assertBudget();
    return writer.instance.generateText!(prompt, { ...(writer.model ? { model: writer.model } : {}), apiBudget: await deps.apiBudget(writer.instance, botId, writer.model), timeoutMs: 180_000 });
  };
  const callAgents = createCallAgents({
    bot: (botId) => {
      const bot = store.bot(botId);
      return bot && !bot.hidden ? { id: bot.id, name: bot.name } : null;
    },
    allowed: ({ auth, botId, room }) => {
      const bot = store.bot(botId);
      if (!bot?.chiefOfStaff || !deps.visible(auth, botId)) return false;
      return !room || deps.project(botId) === room;
    },
    ask: ({ auth, botId, prompt }) => {
      const bot = store.bot(botId);
      if (!bot || !deps.visible(auth, botId)) return Promise.reject(new CallAgentError("That agent is not available to you"));
      return awaitBotReply(store, bot.threadId, async () => {
        await deps.send(bot, auth, prompt, randomUUID().replaceAll("-", ""));
      }, 120_000);
    },
    summarize,
    post: ({ botId, widget, fallback, transcript }) => {
      const bot = store.bot(botId);
      if (!bot) return;
      const card = createAgentCard({ store, bot, threadId: bot.threadId, input: { tool: "show_widget", widget, fallback_text: fallback } });
      if (!card.ok) store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: fallback });
      if (transcript) store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: `Call transcript\n\n${transcript}` });
    },
    transcribe: ({ botId, audio, mime, settings }) => {
      let loopback = false;
      if (settings.transcription.engine === "local") {
        try {
          const url = new URL(settings.transcription.baseUrl);
          loopback = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
            && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        } catch {}
      }
      if (settings.transcription.engine !== "browser" && !loopback) {
        deps.assertBudget();
        deps.unpricedApiBudget(botId, "Call transcription");
      }
      return transcribeWith({ audio, mime, settings, keys: { groq: cfg.groq?.key, openai: cfg.openai?.key } });
    },
    settings: () => callAgentSettings,
    record: input => recordCallNotes(input),
    log: (line) => console.log(line),
  });
  return { settingsRoute, callAgents, summarize };
}
