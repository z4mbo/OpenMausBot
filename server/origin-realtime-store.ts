import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface WorkspaceUser {
  userId: string;
  name: string;
  username?: string;
  email: string;
  avatarUrl?: string | null;
  teamId: string;
  role: string;
}

export type ChatAttachment = { id: string; name: string; size: number; contentType: string; projectId?: string };
export type ChatReference = { type: "project" | "issue"; id: string; projectId: string; label: string };
export type ChatMention = { userId: string; name: string };
export type ChatMessage = {
  id: string; authorUserId: string; authorName: string; authorEmail: string; avatarUrl?: string | null;
  body: string; createdAt: number; editedAt?: number; replyTo?: string; pinned?: boolean;
  attachments?: ChatAttachment[]; references?: ChatReference[]; mentions?: ChatMention[]; reactions?: Record<string, string[]>;
};
export type DirectConversation = { id: string; otherUserId: string; lastMessage?: ChatMessage; unread: number };
export type CallParticipant = {
  userId: string; name: string; username?: string; email: string; avatarUrl?: string | null;
  audioEnabled: boolean; videoEnabled: boolean; screenSharing?: boolean; joinedAt: number; lastSeenAt: number;
};
export type CallSignalKind = "offer" | "answer" | "candidate";
export type CallSignal = { id: string; fromUserId: string; toUserId: string; fromJoinedAt?: number; toJoinedAt?: number; kind: CallSignalKind; payload: string; createdAt: number };
export type MentionNotice = { teamId: string; actorId: string; messageId: string; userIds: string[] };

export const CHAT_REACTIONS = ["like", "heart", "celebrate", "eyes"] as const;
export const CALL_ROOM_LIMIT = 8;
const PARTICIPANT_TTL_MS = 30_000;
const SIGNAL_TTL_MS = 120_000;
const PAGE = 100;

export class RealtimeError extends Error {}

export type Conversation = "" | `dm:${string}:${string}` | `project:${string}`;
export interface ChatScope { user: WorkspaceUser; conversation: Conversation }
export interface CallScope { user: WorkspaceUser; room: string }

function requireWriter(user: WorkspaceUser) {
  if (user.role === "viewer") throw new RealtimeError("View-only workspace access");
}

export function directConversationId(a: string, b: string): `dm:${string}:${string}` {
  const [first, second] = [a, b].sort();
  return `dm:${first}:${second}`;
}

export function openRealtimeStore(file: string, now: () => number = Date.now) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, team TEXT NOT NULL, conversation TEXT NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(team, conversation, created);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, team TEXT NOT NULL, conversation TEXT NOT NULL, author TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS direct_conversations (id TEXT NOT NULL, team TEXT NOT NULL, user_a TEXT NOT NULL, user_b TEXT NOT NULL, PRIMARY KEY(team, id));
    CREATE TABLE IF NOT EXISTS chat_reads (team TEXT NOT NULL, conversation TEXT NOT NULL, user TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY(team, conversation, user));
    CREATE TABLE IF NOT EXISTS mention_outbox (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (team TEXT NOT NULL, room TEXT NOT NULL, user TEXT NOT NULL, seen INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(team, room, user));
    CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, team TEXT NOT NULL, room TEXT NOT NULL, recipient TEXT NOT NULL, sender TEXT NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS signals_recipient ON signals(team, room, recipient);
    CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);

  const transaction = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const limit = (key: string, maximum: number, durationMs: number) => {
    const at = now();
    const row = db.prepare("INSERT INTO request_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING count")
      .get(key, at + durationMs, at, at, at + durationMs) as { count: number };
    if (row.count > maximum) throw new RealtimeError("Too many requests. Please try again shortly.");
  };

  const messageById = ({ user, conversation }: ChatScope, id: string): ChatMessage => {
    const row = db.prepare("SELECT payload FROM messages WHERE team=? AND conversation=? AND id=?").get(user.teamId, conversation, id) as { payload: string } | undefined;
    if (!row) throw new RealtimeError("Message not found");
    return JSON.parse(row.payload) as ChatMessage;
  };

  const page = (rows: { payload: string }[]) => rows.reverse().map((row) => JSON.parse(row.payload) as ChatMessage);

  const pruneCalls = () => {
    db.prepare("DELETE FROM participants WHERE seen<?").run(now() - PARTICIPANT_TTL_MS);
    db.prepare("DELETE FROM signals WHERE created<?").run(now() - SIGNAL_TTL_MS);
  };

  const participants = ({ user, room }: CallScope): CallParticipant[] => {
    pruneCalls();
    return (db.prepare("SELECT payload FROM participants WHERE team=? AND room=? ORDER BY seen").all(user.teamId, room) as { payload: string }[])
      .map((row) => JSON.parse(row.payload) as CallParticipant);
  };

  const presence = (scope: CallScope, media: { audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }, heartbeat: boolean): CallParticipant => {
    const { user, room } = scope;
    requireWriter(user);
    const active = participants(scope);
    const previous = active.find((participant) => participant.userId === user.userId);
    if (active.length >= CALL_ROOM_LIMIT && !previous) throw new RealtimeError(`This call is full (${CALL_ROOM_LIMIT} people)`);
    if (!heartbeat) db.prepare("DELETE FROM signals WHERE team=? AND room=? AND (sender=? OR recipient=?)").run(user.teamId, room, user.userId, user.userId);
    const at = now();
    const participant: CallParticipant = {
      userId: user.userId, name: user.name, ...(user.username ? { username: user.username } : {}), email: user.email, avatarUrl: user.avatarUrl ?? null,
      ...media, joinedAt: heartbeat && previous ? previous.joinedAt : Math.max(at, (previous?.joinedAt ?? 0) + 1), lastSeenAt: at,
    };
    db.prepare("INSERT INTO participants VALUES(?,?,?,?,?) ON CONFLICT(team,room,user) DO UPDATE SET seen=excluded.seen, payload=excluded.payload")
      .run(user.teamId, room, user.userId, at, JSON.stringify(participant));
    return participant;
  };

  return {
    close: () => db.close(),
    limit,

    directConversationMember(user: WorkspaceUser, conversation: string): boolean {
      return Boolean(db.prepare("SELECT id FROM direct_conversations WHERE team=? AND id=? AND (user_a=? OR user_b=?)").get(user.teamId, conversation, user.userId, user.userId));
    },

    openDirectConversation(user: WorkspaceUser, recipientId: string): Conversation {
      requireWriter(user);
      if (!recipientId || recipientId === user.userId) throw new RealtimeError("Choose another workspace member");
      const [first, second] = [user.userId, recipientId].sort();
      const id = directConversationId(first, second);
      db.prepare("INSERT OR IGNORE INTO direct_conversations(id,team,user_a,user_b) VALUES(?,?,?,?)").run(id, user.teamId, first, second);
      return id;
    },

    directConversations(user: WorkspaceUser): DirectConversation[] {
      const rows = db.prepare(`SELECT c.id, CASE WHEN c.user_a=? THEN c.user_b ELSE c.user_a END AS otherUserId,
        (SELECT payload FROM messages WHERE team=c.team AND conversation=c.id ORDER BY created DESC LIMIT 1) AS last,
        (SELECT count(*) FROM messages m WHERE m.team=c.team AND m.conversation=c.id AND m.created>COALESCE(r.seen,0) AND json_extract(m.payload,'$.authorUserId')<>?) AS unread
        FROM direct_conversations c LEFT JOIN chat_reads r ON r.team=c.team AND r.conversation=c.id AND r.user=?
        WHERE c.team=? AND (c.user_a=? OR c.user_b=?)`).all(user.userId, user.userId, user.userId, user.teamId, user.userId, user.userId) as { id: string; otherUserId: string; last: string | null; unread: number }[];
      return rows.map(({ last, ...row }) => ({ ...row, ...(last ? { lastMessage: JSON.parse(last) as ChatMessage } : {}) }))
        .sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
    },

    markRead(scope: ChatScope, messageId: string): void {
      const message = messageById(scope, messageId);
      db.prepare("INSERT INTO chat_reads VALUES(?,?,?,?) ON CONFLICT(team,conversation,user) DO UPDATE SET seen=MAX(seen,excluded.seen)")
        .run(scope.user.teamId, scope.conversation, scope.user.userId, message.createdAt);
    },

    messages({ user, conversation }: ChatScope, before?: number): ChatMessage[] {
      return page(db.prepare("SELECT payload FROM messages WHERE team=? AND conversation=? AND created<? ORDER BY created DESC LIMIT ?")
        .all(user.teamId, conversation, before ?? now() + 1, PAGE) as { payload: string }[]);
    },

    search(scope: ChatScope, search: string, before?: number): ChatMessage[] {
      const text = search.trim().slice(0, 160);
      if (!text) return [];
      limit(`chat-search:${scope.user.teamId}:${scope.user.userId}`, 90, 60_000);
      return page(db.prepare("SELECT payload FROM messages WHERE team=? AND conversation=? AND created<? AND instr(lower(json_extract(payload,'$.body')),lower(?))>0 ORDER BY created DESC LIMIT ?")
        .all(scope.user.teamId, scope.conversation, before ?? now() + 1, text, PAGE) as { payload: string }[]);
    },

    context(scope: ChatScope, id: string): ChatMessage[] {
      const message = messageById(scope, id);
      return page(db.prepare("SELECT payload FROM messages WHERE team=? AND conversation=? AND created<? ORDER BY created DESC LIMIT ?")
        .all(scope.user.teamId, scope.conversation, message.createdAt + 1, PAGE) as { payload: string }[]);
    },

    send(scope: ChatScope, body: string, extras: { attachmentIds?: string[]; references?: ChatReference[]; replyTo?: string; mentions?: ChatMention[]; notifyUserIds?: string[] } = {}): ChatMessage {
      const { user, conversation } = scope;
      requireWriter(user);
      limit(`chat:${user.teamId}:${user.userId}`, 40, 60_000);
      if (typeof body !== "string" || body.length > 8000) throw new RealtimeError("Message must be under 8,000 characters");
      const attachments = (extras.attachmentIds ?? []).slice(0, 8).map((id) => {
        const file = db.prepare("SELECT payload FROM files WHERE id=? AND team=? AND author=? AND conversation=?").get(id, user.teamId, user.userId, conversation) as { payload: string } | undefined;
        if (!file) throw new RealtimeError("Attachment not found");
        return JSON.parse(file.payload) as ChatAttachment;
      });
      const references = (extras.references ?? []).slice(0, 12);
      const mentions = extras.mentions ?? [];
      if (!body.trim() && !attachments.length && !references.length && !mentions.length) throw new RealtimeError("Write a message or add an attachment");
      if (extras.replyTo) messageById(scope, extras.replyTo);
      const message: ChatMessage = {
        id: randomUUID(), authorUserId: user.userId, authorName: user.name || user.email, authorEmail: user.email, avatarUrl: user.avatarUrl ?? null,
        body: body.trim(), createdAt: now(), attachments, references, mentions, ...(extras.replyTo ? { replyTo: extras.replyTo } : {}),
      };
      transaction(() => {
        db.prepare("INSERT INTO messages(id,team,conversation,created,payload) VALUES(?,?,?,?,?)").run(message.id, user.teamId, conversation, message.createdAt, JSON.stringify(message));
        const userIds = [...new Set([...mentions.map((mention) => mention.userId), ...(extras.notifyUserIds ?? [])])].filter((id) => id !== user.userId).slice(0, 20);
        if (userIds.length && !conversation.startsWith("dm:")) {
          const notice: MentionNotice = { teamId: user.teamId, actorId: user.userId, messageId: message.id, userIds };
          db.prepare("INSERT INTO mention_outbox VALUES(?,?)").run(message.id, JSON.stringify(notice));
        }
      });
      return message;
    },

    edit(scope: ChatScope, id: string, change: { body?: unknown; reaction?: unknown; pinned?: unknown; delete?: unknown }): ChatMessage | null {
      const { user, conversation } = scope;
      requireWriter(user);
      return transaction(() => {
        const message = messageById(scope, id);
        if (change.delete === true || change.body !== undefined) {
          if (message.authorUserId !== user.userId) throw new RealtimeError("Only the author can edit or delete this message");
          if (change.delete === true) {
            db.prepare("DELETE FROM messages WHERE team=? AND conversation=? AND id=?").run(user.teamId, conversation, id);
            return null;
          }
          if (typeof change.body !== "string" || !change.body.trim() || change.body.length > 8000) throw new RealtimeError("Enter a message under 8,000 characters");
          message.body = change.body.trim();
          message.editedAt = now();
        }
        if (change.reaction !== undefined) {
          if (typeof change.reaction !== "string" || !(CHAT_REACTIONS as readonly string[]).includes(change.reaction)) throw new RealtimeError("Unknown reaction");
          const reactions = message.reactions ?? {};
          const users = reactions[change.reaction] ?? [];
          reactions[change.reaction] = users.includes(user.userId) ? users.filter((userId) => userId !== user.userId) : [...users, user.userId];
          message.reactions = reactions;
        }
        if (typeof change.pinned === "boolean") message.pinned = change.pinned;
        db.prepare("UPDATE messages SET payload=? WHERE team=? AND conversation=? AND id=?").run(JSON.stringify(message), user.teamId, conversation, id);
        return message;
      });
    },

    registerFile({ user, conversation }: ChatScope, file: ChatAttachment): void {
      requireWriter(user);
      db.prepare("INSERT INTO files(id,team,conversation,author,payload) VALUES(?,?,?,?,?)").run(file.id, user.teamId, conversation, user.userId, JSON.stringify(file));
    },

    file({ user, conversation }: ChatScope, id: string): ChatAttachment {
      const row = db.prepare("SELECT payload FROM files WHERE team=? AND conversation=? AND id=?").get(user.teamId, conversation, id) as { payload: string } | undefined;
      if (!row) throw new RealtimeError("File not found");
      return JSON.parse(row.payload) as ChatAttachment;
    },

    pendingMentions(max = 20): { id: string; notice: MentionNotice }[] {
      return (db.prepare("SELECT id, payload FROM mention_outbox LIMIT ?").all(max) as { id: string; payload: string }[])
        .map((row) => ({ id: row.id, notice: JSON.parse(row.payload) as MentionNotice }));
    },

    mentionDelivered(id: string): void {
      db.prepare("DELETE FROM mention_outbox WHERE id=?").run(id);
    },

    participants,

    join: (scope: CallScope, media: { audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => presence(scope, media, false),
    heartbeat: (scope: CallScope, media: { audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean }) => presence(scope, media, true),

    leave({ user, room }: CallScope): void {
      db.prepare("DELETE FROM participants WHERE team=? AND room=? AND user=?").run(user.teamId, room, user.userId);
      db.prepare("DELETE FROM signals WHERE team=? AND room=? AND (sender=? OR recipient=?)").run(user.teamId, room, user.userId, user.userId);
    },

    sendSignal(scope: CallScope, toUserId: string, kind: CallSignalKind, payload: string, fromJoinedAt?: number, toJoinedAt?: number): CallSignal | null {
      const { user, room } = scope;
      requireWriter(user);
      if (toUserId === user.userId || !["offer", "answer", "candidate"].includes(kind) || typeof payload !== "string" || !payload || payload.length > 80_000) {
        throw new RealtimeError("Invalid call signal");
      }
      const active = participants(scope);
      const sender = active.find((participant) => participant.userId === user.userId);
      const recipient = active.find((participant) => participant.userId === toUserId);
      if (!sender || !recipient) throw new RealtimeError("Both people must be in this call");
      if ((fromJoinedAt !== undefined && fromJoinedAt !== sender.joinedAt) || (toJoinedAt !== undefined && toJoinedAt !== recipient.joinedAt)) return null;
      const signal: CallSignal = { id: randomUUID(), fromUserId: user.userId, toUserId, fromJoinedAt: sender.joinedAt, toJoinedAt: recipient.joinedAt, kind, payload, createdAt: now() };
      db.prepare("INSERT INTO signals VALUES(?,?,?,?,?,?,?)").run(signal.id, user.teamId, room, toUserId, user.userId, signal.createdAt, JSON.stringify(signal));
      return signal;
    },

    signals({ user, room }: CallScope): CallSignal[] {
      return (db.prepare("SELECT payload FROM signals WHERE team=? AND room=? AND recipient=? AND created>? ORDER BY created LIMIT 120").all(user.teamId, room, user.userId, now() - SIGNAL_TTL_MS) as { payload: string }[])
        .map((row) => JSON.parse(row.payload) as CallSignal);
    },

    ackSignals({ user, room }: CallScope, ids: readonly string[]): void {
      const remove = db.prepare("DELETE FROM signals WHERE team=? AND room=? AND recipient=? AND id=?");
      for (const id of ids.slice(0, 120)) remove.run(user.teamId, room, user.userId, id);
    },
  };
}

export type RealtimeStore = ReturnType<typeof openRealtimeStore>;
