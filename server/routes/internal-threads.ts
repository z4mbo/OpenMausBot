import { chiefTidies } from "../chief-of-staff.ts";
import type { Coordinator } from "../coordinator.ts";
import { canReachPeer, coordinatorSupervises, reachablePeers } from "../peer-roster.ts";
import { isWorkspaceSection } from "../../shared/origin-workspaces.ts";
import { redactSecretsInText as scrub } from "../../shared/redact.ts";
import { audienceWithin, roomFeeds, sameAudience } from "../bot-visibility.ts";
import type { BotRecord, GroupRecord, Store, TaskRecord } from "../store.ts";
import { PASS, type RouteHandler } from "./table.ts";

type ThreadState = "running" | "waiting-on-you" | "queued" | "idle" | "closed";

interface ThreadRow {
  threadId: string; botId: string; botName: string; title: string;
  state: ThreadState;
  unread: boolean; openedAt: number; delegationId?: string; own: boolean;
  openedBy?: string;
}

/** Only dispatch inside the internal capability gate: `from` and `fromThreadId` come from the caller's capability. */
export function createInternalThreadRoutes(deps: {
  store: Pick<Store, "bot" | "bots" | "tasks" | "taskByThread" | "appendMessage" | "patchTask" | "setTaskClosedBy" | "activePath" | "groupByThread">;
  coordinator: Pick<Coordinator, "awaitingAnswer" | "parkedDirect" | "activeDirect">;
  from: BotRecord;
  fromThreadId: string;
  ownsThread(botId: string, threadId: string): boolean;
  /** A turn that may use the lent Mac sees only owner-only conversations: a title is words too. */
  shown(threadId: string): boolean;
  threadBusy(botId: string, threadId: string): boolean;
  queuedThreadPosition(botId: string, threadId: string): number | null;
}): RouteHandler {
  const { store, coordinator, from, fromThreadId } = deps;
  const supervises = (peer: BotRecord) => Boolean(!from.hidden && !store.groupByThread(fromThreadId) && isWorkspaceSection(from.section) && coordinatorSupervises(from, peer) && canReachPeer(from, peer));
  const readableRoom = (room: GroupRecord, threadId: string) => {
    if (!deps.shown(threadId) || !audienceWithin(from.visibility, room.audienceFloor)) return false;
    const members = room.memberIds.map((id) => store.bot(id));
    if (members.some((member) => !member || member.id !== from.id && !canReachPeer(from, member))) return false;
    return roomFeeds(members.map((member) => member?.visibility), from.visibility);
  };
  const readable = (task: TaskRecord): boolean => {
    const seen = new Set<string>();
    let current: TaskRecord | undefined = task;
    while (current) {
      if (seen.has(current.threadId) || seen.size >= 20 || !deps.shown(current.threadId)) return false;
      seen.add(current.threadId);
      const opener = current.openedBy;
      if (!opener?.threadId) return !opener?.roomLane;
      const room = store.groupByThread(opener.threadId);
      if (room) return readableRoom(room, opener.threadId);
      const source = store.bot(opener.botId);
      if (opener.roomLane || !source || !sameAudience(from.visibility, source.visibility) || source.id !== from.id && !canReachPeer(from, source)) return false;
      current = store.taskByThread(source.id, opener.threadId);
      if (!current) return false;
    }
    return false;
  };
  return async ({ res, url, path, method, json }) => {
    if (method === "GET" && path === "/api/internal/agent-transcript") {
      if (!deps.ownsThread(from.id, fromThreadId) || store.groupByThread(fromThreadId)) return json(res, 403, { error: "Read agent transcripts from your own direct conversation" });
      const target = store.bot(url.searchParams.get("targetBotId") ?? "");
      const threadId = url.searchParams.get("threadId") ?? "";
      const task = target && store.taskByThread(target.id, threadId);
      if (!target || !task || !supervises(target) || !readable(task)) return json(res, 404, { error: "No supervised agent conversation; call list_threads" });
      const rawLimit = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, Math.trunc(rawLimit)) : 30;
      const path = store.activePath(threadId);
      let remaining = 20_000;
      let truncated = path.length > limit;
      const messages = path.slice(-limit).reverse().flatMap((message) => {
        if (remaining <= 0) { truncated = true; return []; }
        let messageRemaining = Math.min(4_000, remaining);
        const excerpt = (value: string) => {
          const full = scrub(value);
          const text = full.slice(0, messageRemaining);
          truncated ||= text.length < full.length;
          messageRemaining -= text.length;
          remaining -= text.length;
          return text;
        };
        const text = excerpt(message.text ?? "");
        const tool = message.tool ? {
          name: excerpt(message.tool.name.slice(0, 200)), ok: message.tool.ok,
          ...(message.tool.input ? { input: excerpt(message.tool.input) } : {}),
          ...(message.tool.output ? { output: excerpt(message.tool.output) } : {}),
        } : undefined;
        return [{ id: message.id, role: message.role, text, ...(tool ? { tool } : {}) }];
      }).reverse();
      return json(res, 200, { botId: target.id, threadId, title: scrub(task.title).slice(0, 250), messages, truncated });
    }
    if (method === "GET" && path === "/api/internal/threads") {
      if (!deps.ownsThread(from.id, fromThreadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const rows: ThreadRow[] = [];
      const stateOf = (bot: BotRecord, task: TaskRecord) => {
        if (task.activity === "waiting-on-you" || coordinator.awaitingAnswer(task.threadId)) return "waiting-on-you" as const;
        if (deps.threadBusy(bot.id, task.threadId)) return "running" as const;
        if (coordinator.parkedDirect(task.threadId)) return "waiting-on-you" as const;
        if (deps.queuedThreadPosition(bot.id, task.threadId) !== null) return "queued" as const;
        if (coordinator.activeDirect(task.threadId)) return "queued" as const;
        if (task.closedBy) return "closed" as const;
        return "idle" as const;
      };
      for (const task of store.tasks(from.id)) {
        if (!deps.shown(task.threadId)) continue;
        rows.push({
          threadId: task.threadId, botId: from.id, botName: from.name, title: task.title,
          state: stateOf(from, task), unread: task.unread === true, openedAt: task.openedBy?.at ?? task.createdAt,
          delegationId: task.openedBy?.delegationId, own: true,
        });
      }
      for (const peer of reachablePeers(store.bots, from)) {
        for (const task of store.tasks(peer.id)) {
          const opener = task.openedBy;
          if (!deps.shown(task.threadId)) continue;
          const mine = opener?.botId === from.id;
          const managed = supervises(peer);
          if (managed && !readable(task)) continue;
          if (!mine && !managed && (!opener || !chiefTidies(from, task, store.bot(opener.botId)))) continue;
          rows.push({
            threadId: task.threadId, botId: peer.id, botName: peer.name, title: task.title,
            state: stateOf(peer, task), unread: task.unread === true, openedAt: opener?.at ?? task.createdAt,
            delegationId: opener?.delegationId, own: false,
            ...(mine || !opener ? {} : { openedBy: opener.name }),
          });
        }
      }
      rows.sort((a, b) => b.openedAt - a.openedAt);
      return json(res, 200, { threads: rows.slice(0, 100) });
    }
    // close_thread folds a thread, never deletes it (a person's confirmed action), and never while it runs.
    const closeMatch = method === "POST" ? path.match(/^\/api\/internal\/threads\/([\w-]+)\/close$/) : null;
    if (!closeMatch) return PASS;
    if (!deps.ownsThread(from.id, fromThreadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const threadId = closeMatch[1]!;
    const owner = [from, ...reachablePeers(store.bots, from)].find((bot) => store.taskByThread(bot.id, threadId));
    const task = owner ? store.taskByThread(owner.id, threadId) : undefined;
    if (!owner || !task) return json(res, 404, { error: "no such thread — call list_threads for the ones you can see" });
    if (owner.id !== from.id && task.openedBy?.botId !== from.id && !chiefTidies(from, task, task.openedBy ? store.bot(task.openedBy.botId) : undefined)) {
      return json(res, 403, { error: "that thread is not yours to close — only the bot that opened it, its own bot, or (for a thread a bot opened) a Chief of Staff can" });
    }
    if (threadId === fromThreadId) return json(res, 400, { error: "you cannot close the thread you are speaking in — finish your turn instead" });
    if (coordinator.awaitingAnswer(threadId)) {
      return json(res, 409, { error: `#${task.title} is waiting on the person's answer to its question — it continues once they reply there, so leave it open` });
    }
    if (deps.threadBusy(owner.id, threadId) || deps.queuedThreadPosition(owner.id, threadId) !== null || coordinator.activeDirect(threadId)) {
      return json(res, 409, { error: `#${task.title} is still running — wait for it to finish (list_threads), or the person can stop it from the app` });
    }
    if (task.closedBy) {
      return json(res, 200, { closed: true, alreadyClosed: true, threadId, title: task.title, botName: owner.name, closedBy: task.closedBy.name });
    }
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: from.id, name: from.name, color: from.color },
      tool: { name: `Closed by @${from.name}`, ok: true },
    });
    if (task.unread) store.patchTask(owner.id, threadId, { unread: false });
    store.setTaskClosedBy(owner.id, threadId, { botId: from.id, name: from.name, at: Date.now() });
    return json(res, 200, { closed: true, threadId, title: task.title, botName: owner.name });
  };
}
