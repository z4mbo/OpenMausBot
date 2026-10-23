import { randomUUID } from "node:crypto";
import { createAgentCard } from "../chat-widgets.ts";
import { awaitBotReply, CallAgentError, createCallAgents, recordCallNotes, transcribeWith, type CallAgentSettings } from "../origin-call-agent.ts";
import { createChatAgent } from "../origin-chat-agent.ts";
import { connectedConvex } from "../origin-members.ts";
import { convexCallRooms } from "../origin-realtime-backend.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { Store } from "../store.ts";

export interface ProjectBotAgentDeps {
  store: Store;
  visible(auth: RequestAuth, botId: string): boolean;
  projectOf(botId: string): string | null | undefined;
  send(auth: RequestAuth, input: { botId: string; threadId: string; text: string; sendId: string; via?: "call" }): Promise<unknown>;
  write(botId: string, prompt: string, timeoutMs: number): Promise<string>;
  keys(): { groq?: string; openai?: string };
  settings(): CallAgentSettings;
}

/** The project bot in its team chat (answering @-tags) and in its calls (listening and summarizing). */
export function createProjectBotAgents(deps: ProjectBotAgentDeps) {
  const { store } = deps;
  const ask = ({ auth, botId, prompt, via, timeoutMs }: { auth: RequestAuth; botId: string; prompt: string; via?: "call"; timeoutMs: number }): Promise<string> => {
    const bot = store.bot(botId);
    if (!bot || !deps.visible(auth, botId)) return Promise.reject(new CallAgentError("That agent is not available to you"));
    return awaitBotReply(store, bot.threadId, async () => {
      await deps.send(auth, { botId, threadId: bot.threadId, text: prompt, sendId: randomUUID().replaceAll("-", ""), ...(via ? { via } : {}) });
    }, timeoutMs);
  };
  const chatAgent = createChatAgent({
    find: ({ auth, projectId }) => {
      const chief = store.bots.find((bot) => bot.chiefOfStaff && !bot.hidden && deps.projectOf(bot.id) === projectId && deps.visible(auth, bot.id));
      return chief ? { id: chief.id, name: chief.name } : null;
    },
    ask: (input) => ask({ ...input, timeoutMs: 180_000 }),
    log: (line) => console.log(line),
  });
  const callAgents = createCallAgents({
    bot: (botId) => {
      const bot = store.bot(botId);
      return bot && !bot.hidden ? { id: bot.id, name: bot.name } : null;
    },
    allowed: ({ auth, botId, room }) => {
      const bot = store.bot(botId);
      if (!bot?.chiefOfStaff || !deps.visible(auth, botId)) return false;
      return !room || deps.projectOf(botId) === room;
    },
    ask: (input) => ask({ ...input, via: "call", timeoutMs: 120_000 }),
    rooms: convexCallRooms(connectedConvex),
    summarize: ({ botId, prompt }) => deps.write(botId, prompt, 180_000),
    post: ({ botId, widget, fallback, transcript }) => {
      const bot = store.bot(botId);
      if (!bot) return;
      const card = createAgentCard({ store, bot, threadId: bot.threadId, input: { tool: "show_widget", widget, fallback_text: fallback } });
      if (!card.ok) store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: fallback });
      if (transcript) store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: `Call transcript\n\n${transcript}` });
    },
    transcribe: ({ audio, mime, settings }) => transcribeWith({ audio, mime, settings, keys: deps.keys() }),
    settings: deps.settings, record: (input) => recordCallNotes(input),
    log: (line) => console.log(line),
  });
  return { chatAgent, callAgents };
}
