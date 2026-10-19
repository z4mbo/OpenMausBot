import { parseToolScope } from "../shared/tool-scope.ts";
import type { MausColor } from "../shared/wire.ts";
import { soulHash, writeSoulMirror } from "./bot-folder.ts";
import { newId, type ModelSelection } from "./contracts.ts";
import { pickBotName } from "./names.ts";
import type { BotRecord, Message, StoreChange } from "./store.ts";

export interface OriginImportRecord {
  deployment: string;
  kind: "workspace" | "project";
  cloudId: string;
  workspaceId?: string;
  memberIds: string[];
}

export type NewBotProfile = Partial<Pick<BotRecord, "name" | "title" | "description" | "soul" | "color" | "mascotExpression" | "mascotBody" | "modelSelection" | "section" | "cwd" | "visibility" | "toolScope">>;

interface BotCreationDeps {
  bots(): BotRecord[];
  bot(id: string): BotRecord | null;
  newBotSelection(requested?: ModelSelection): ModelSelection;
  saveBots(bots: BotRecord[]): void;
  emit(change: StoreChange): void;
  appendMessage(threadId: string, message: Omit<Message, "id" | "at" | "parentId">): Message;
  colors: readonly MausColor[];
  untitledThread: string;
  sectionKey(section?: string | null): string;
}

export function createBotCreation(deps: BotCreationDeps) {
  function prepareBot(profile: NewBotProfile, pending: readonly BotRecord[] = []): BotRecord {
    const toolScope = parseToolScope(profile.toolScope);
    if (!toolScope.ok) throw new Error(toolScope.error);
    const name = profile.name?.trim() || pickBotName([...deps.bots(), ...pending].map((b) => b.name));
    const section = deps.sectionKey(profile.section);
    const bot: BotRecord = {
      id: newId(),
      threadId: newId(),
      name,
      title: profile.title ?? "",
      description: profile.description ?? "",
      soul: profile.soul ?? "",
      soulHash: soulHash(profile.soul ?? ""),
      notifications: true,
      color: profile.color ?? deps.colors[(deps.bots().length + pending.length) % deps.colors.length],
      ...(profile.mascotExpression ? { mascotExpression: profile.mascotExpression } : {}),
      ...(profile.mascotBody ? { mascotBody: profile.mascotBody } : {}),
      // Restricted from its first frame: no one else is ever told it exists.
      ...(profile.visibility && profile.visibility !== "everyone" ? { visibility: structuredClone(profile.visibility) } : {}),
      ...(toolScope.scope ? { toolScope: toolScope.scope } : {}),
      unread: false,
      modelSelection: deps.newBotSelection(profile.modelSelection),
      resumeCursors: {},
      createdAt: Date.now(),
    };
    if (section) bot.section = section;
    if (profile.cwd) bot.cwd = profile.cwd;
    bot.tasks = [{
      threadId: bot.threadId,
      title: deps.untitledThread,
      createdAt: bot.createdAt,
      updatedAt: bot.createdAt,
      resumeCursors: {},
      unread: false,
      activity: "idle",
      busy: false,
    }];
    return bot;
  }

  function publishNewBot(bot: BotRecord, seedMessages: boolean): void {
    try {
      writeSoulMirror(bot.id, bot.soul ?? "");
    } catch (e) {
      console.warn(`[bot-folder] could not write SOUL.md mirror for ${bot.id}: ${(e as Error).message}`);
    }
    // Before its transcript: clients need the bot/thread mapping to place either message.
    deps.emit({ type: "bot", botId: bot.id });
    if (seedMessages) {
      deps.appendMessage(bot.threadId, {
        role: "bot",
        kind: "text",
        text: `Hi, I'm ${bot.name}. What would you like me to do?`,
      });
    }
  }

  function createOriginImport(identity: Omit<OriginImportRecord, "memberIds">, profile: NewBotProfile, members: readonly NewBotProfile[] = []): { bot: BotRecord; members: BotRecord[] } {
    const head = identity.workspaceId ? deps.bot(identity.workspaceId) : null;
    if (identity.workspaceId && !head?.chiefOfStaff) throw new Error("The imported project's workspace head no longer exists");
    const created: BotRecord[] = [];
    for (const fields of [profile, ...[...members].reverse()]) created.push(prepareBot(fields, created));
    const bot = created[0];
    bot.chiefOfStaff = true;
    bot.originImport = { ...identity, memberIds: created.slice(1).map((member) => member.id) };
    const managedSections = head ? [...new Set([...(head.managedSections ?? []), deps.sectionKey(bot.section)])] : [];
    if (managedSections.length > 100) throw new Error("A workspace can manage at most 100 project teams");
    const nextBots = [...[...created].reverse(), ...deps.bots().map((current) => current === head ? { ...current, managedSections } : current)];
    // Security: the complete team and its workspace grant become visible only after the same durable write.
    deps.saveBots(nextBots);
    if (head) head.managedSections = managedSections;
    deps.bots().unshift(...[...created].reverse());
    for (const member of created) publishNewBot(member, true);
    if (head) deps.emit({ type: "bot", botId: head.id });
    return { bot, members: created.slice(1).reverse() };
  }

  return { prepareBot, publishNewBot, createOriginImport };
}
