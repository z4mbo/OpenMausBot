// Privacy invariants: call audio is only ever held in memory for one transcription request and never written anywhere;
// the transcript lives in memory for the call and is dropped once it is summarised, unless the people in the call keep it.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import type { CallNotesInput } from "./origin-call-notes.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export { recordCallNotes } from "./origin-call-notes.ts";

export type TranscriptionEngine = "local" | "groq" | "openai" | "browser";

/** `origin-call-agent.json`: how a call's agent hears and summarises. Edited from Settings by an admin. */
export interface CallAgentSettings {
  transcription: {
    /** "local": an OpenAI-compatible `/audio/transcriptions` server on this computer (faster-whisper-server, speaches,
     * LocalAI). "groq" and "openai" use the keys saved under Connections. "browser": each person's browser speech
     * recognition, where it has one. */
    engine: TranscriptionEngine;
    /** The local server's OpenAI-compatible base URL, ending in /v1. */
    baseUrl: string;
    /** Empty: the engine's default model. */
    model: string;
  };
  summarizer: {
    /** A connected engine instance. Empty: the workspace helper model, else the chief's own engine. */
    instanceId: string;
    /** One of that instance's models. Empty: the instance's quick-call choice. */
    model: string;
  };
  /** Whether a call keeps its transcript in the chief's chat after the summary unless someone in the call changes it. */
  keepTranscript: boolean;
}

export const DEFAULT_CALL_AGENT_SETTINGS: CallAgentSettings = {
  transcription: { engine: "local", baseUrl: "http://127.0.0.1:8000/v1", model: "" },
  summarizer: { instanceId: "", model: "" },
  keepTranscript: false,
};

export const DEFAULT_TRANSCRIPTION_MODELS: Record<Exclude<TranscriptionEngine, "browser">, string> = {
  local: "Systran/faster-whisper-small",
  groq: "whisper-large-v3-turbo",
  openai: "gpt-4o-mini-transcribe",
};

const ENGINES: readonly TranscriptionEngine[] = ["local", "groq", "openai", "browser"];
const MAX_LINE = 600;
const MAX_LINES = 3_000;
const CONTEXT_LINES = 40;
const CONTEXT_CHARS = 6_000;
const SUMMARY_CHARS = 60_000;
const WAKE_FOLLOW_UP_MS = 10_000;
const ENDED_VISIBLE_MS = 10 * 60_000;
const AUDIO_PER_MINUTE = 90;
const LINES_PER_MINUTE = 120;
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

export function parseCallAgentSettings(value: unknown): CallAgentSettings {
  const input = record(value);
  const transcription = record(input.transcription);
  const summarizer = record(input.summarizer);
  const engine = ENGINES.includes(transcription.engine as TranscriptionEngine) ? transcription.engine as TranscriptionEngine : DEFAULT_CALL_AGENT_SETTINGS.transcription.engine;
  const baseUrl = text(transcription.baseUrl).trim().replace(/\/+$/, "");
  return {
    transcription: {
      engine,
      baseUrl: /^https?:\/\/[^\s]{1,300}$/.test(baseUrl) ? baseUrl : DEFAULT_CALL_AGENT_SETTINGS.transcription.baseUrl,
      model: text(transcription.model).trim().slice(0, 200),
    },
    summarizer: { instanceId: text(summarizer.instanceId).trim().slice(0, 200), model: text(summarizer.model).trim().slice(0, 300) },
    keepTranscript: input.keepTranscript === true,
  };
}

export function readCallAgentSettings(file: string): CallAgentSettings {
  try {
    return parseCallAgentSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return parseCallAgentSettings({});
  }
}

export function writeCallAgentSettings(file: string, settings: CallAgentSettings): void {
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

const words = (value: string) => [...value.matchAll(/[\p{L}\p{N}']+/gu)].map((match) => ({
  word: match[0].toLowerCase().replace(/'/g, ""), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length,
}));
const compact = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const GREETINGS = new Set(["hey", "hi", "hello", "ok", "okay", "ehi", "ehy", "ciao"]);

/** "hey GGs, what do you think?" for an agent named GGs: `request` is what follows the name, empty when only the name was said.
 * The name also wakes it without a greeting when it opens the sentence ("GGs, what do you think?"), and any of `names`
 * (the agent's own and its project's) works. Speech-to-text splits and spells names freely ("G G's", "ggs"), so a name
 * is matched with its letters run together. */
export function wakeRequest(said: string, names: string | readonly string[]): { request: string } | null {
  const targets = (typeof names === "string" ? [names] : names).map(compact).filter(Boolean);
  if (!targets.length) return null;
  const tokens = words(said);
  const nameEndingAt = (from: number): number | null => {
    for (const target of targets) {
      let joined = "";
      for (let end = from; end < Math.min(tokens.length, from + 6); end++) {
        joined += tokens[end]!.word;
        if (joined === target || (target.endsWith("s") && joined === target.slice(0, -1))) return end;
        if (joined.length >= target.length) break;
      }
    }
    return null;
  };
  const request = (end: number) => ({ request: said.slice(tokens[end]!.end).replace(/^[\s,.:;!?-]+/, "").trim() });
  const opening = nameEndingAt(0);
  if (opening !== null) return request(opening);
  for (let index = 0; index < tokens.length; index++) {
    if (!GREETINGS.has(tokens[index]!.word)) continue;
    const end = nameEndingAt(index + 1);
    if (end !== null) return request(end);
  }
  return null;
}

export type CallSummary = { keyPoints: string[]; decisions: string[]; actionItems: { title: string; owner?: string }[] };

const strings = (value: unknown, max: number, chars: number): string[] =>
  (Array.isArray(value) ? value : []).map((item) => text(item).trim().slice(0, chars)).filter(Boolean).slice(0, max);

const jsonObject = (raw: string): Record<string, unknown> | null => {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (!json) return null;
  try {
    return record(JSON.parse(json));
  } catch {
    return null;
  }
};

/** A small model's answer: JSON when it followed the instructions, otherwise its bullet lines as key points. */
export function parseSummary(raw: string): CallSummary {
  const value = jsonObject(raw);
  if (value) {
    const actionItems = (Array.isArray(value.actionItems) ? value.actionItems : []).map((item) => {
      if (typeof item === "string") return { title: item.trim().slice(0, 200) };
      const entry = record(item);
      const owner = text(entry.owner).trim().slice(0, 60);
      return { title: text(entry.title).trim().slice(0, 200), ...(owner ? { owner } : {}) };
    }).filter((item) => item.title).slice(0, 15);
    return { keyPoints: strings(value.keyPoints, 10, 400), decisions: strings(value.decisions, 10, 400), actionItems };
  }
  const lines = raw.split("\n").map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  return { keyPoints: lines.slice(0, 10).map((line) => line.slice(0, 400)), decisions: [], actionItems: [] };
}

export type CaptionLine = { id: number; at: number; speaker: string; userId?: string; text: string; agent?: true };

export function transcriptText(lines: readonly Pick<CaptionLine, "speaker" | "text">[], maxChars: number): string {
  const out: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = `${lines[index]!.speaker}: ${lines[index]!.text}`;
    if (size + line.length > maxChars) break;
    out.unshift(line);
    size += line.length + 1;
  }
  return out.join("\n");
}

export function summaryPrompt(input: { callName: string; chief: string; transcript: string }): string {
  return [
    `Summarise this call transcript from the "${input.callName}" call for ${input.chief}, the team's lead agent.`,
    `Reply with JSON only, in the transcript's language: {"keyPoints": string[], "decisions": string[], "actionItems": [{"title": string, "owner": string | null}]}.`,
    "At most 8 key points, 8 decisions and 10 action items. Each action item is one concrete task that could become an issue. Leave a list empty rather than inventing.",
    "The transcript is speech recognition output from the people in the call, so names and words may be misheard.",
    "",
    "<transcript>",
    input.transcript,
    "</transcript>",
  ].join("\n");
}

export function askPrompt(input: { callName: string; agent: string; speaker: string; request: string; transcript: string }): string {
  return [
    `[Live call: ${input.callName}] You are ${input.agent}, listening in on this call. ${input.speaker} just addressed you by name.`,
    "Your answer is read aloud to everyone in the call: two or three short spoken sentences, no markdown, no lists, no links.",
    "",
    "Recent call transcript (speech recognition, may contain mistakes):",
    input.transcript || "(nothing yet)",
    "",
    `${input.speaker} asked: ${input.request}`,
  ].join("\n");
}

/** Spoken and shown as a caption, so formatting marks go. */
export function spokenReply(reply: string): string {
  return reply.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, 1_200);
}

const clipped = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** The card posted in the chief's chat: checked action items go back to the chief as the person's next message. */
export function summaryWidget(input: { callName: string; summary: CallSummary; people: readonly string[]; minutes: number; when: string }): { widget: Record<string, unknown>; fallback: string } {
  const { summary } = input;
  const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n");
  const children: Record<string, unknown>[] = [];
  const section = (title: string, items: readonly string[]) => {
    if (!items.length) return;
    children.push({ type: "Text", value: title, weight: "semibold", size: "sm" }, { type: "Markdown", value: clipped(list(items), 6_000) });
  };
  section("Key points", summary.keyPoints);
  section("Decisions", summary.decisions);
  if (summary.actionItems.length) {
    children.push({ type: "Text", value: "Action items", weight: "semibold", size: "sm" });
    summary.actionItems.forEach((item, index) => children.push({
      type: "Checkbox", name: `item${index + 1}`, defaultChecked: true,
      label: clipped(item.owner ? `${item.title} (${item.owner})` : item.title, 120),
    }));
  }
  if (!children.length) children.push({ type: "Text", value: "Nothing to note from this call." });
  const caption = clipped(`${input.when} · ${input.minutes} min${input.people.length ? ` · ${input.people.join(", ")}` : ""}`, 240);
  const widget: Record<string, unknown> = {
    type: "Card",
    title: clipped(`Call summary · ${input.callName}`, 120),
    caption,
    children,
    ...(summary.actionItems.length
      ? { confirm: { label: "Create issues", action: { type: "call.create_issues" } }, cancel: { label: "Discuss", action: { type: "call.discuss" } } }
      : {}),
  };
  const fallback = [
    `Call summary · ${input.callName} (${caption})`,
    summary.keyPoints.length ? `Key points:\n${list(summary.keyPoints)}` : "",
    summary.decisions.length ? `Decisions:\n${list(summary.decisions)}` : "",
    summary.actionItems.length ? `Action items (create an issue in Draft for each checked one with the Origin issue tools unless the person explicitly chooses another column):\n${list(summary.actionItems.map((item) => item.owner ? `${item.title} (${item.owner})` : item.title))}` : "",
  ].filter(Boolean).join("\n\n");
  return { widget, fallback };
}

export interface CallAgentBot { id: string; name: string }

export type CallAgentScope = { teamId: string; room: string; name: string; user: { userId: string; name: string; username?: string }; token?: string };

/** The agent's place in one call, as every member's app reads it. */
export type SharedCallAgent = {
  botId: string;
  name: string;
  /** Other names that wake it, such as its project's. */
  aliases: string[];
  addedBy: string;
  /** The app that answers for the agent: the one that brought it in, or took over when that app went quiet. */
  hostId: string;
  startedAt: number;
  heartbeatAt: number;
  keepTranscript: boolean;
  thinking: boolean;
  awaiting?: { userId: string; name: string; until: number };
  /** Someone removed the agent; its host summarises the call. */
  ending?: true;
  ended?: { status: "summarizing" | "posted" | "failed"; error?: string; at: number; people: string[] };
};

/** Where a call's agent and captions live, so every member's app sees the same call. */
export interface CallRoomPort {
  read(scope: CallAgentScope, after: number): Promise<{ agent: { state: SharedCallAgent; updatedAt: number } | null; lines: CaptionLine[] }>;
  /** Replaces the agent's state when it still is `expected` (its `updatedAt`, or null for none); null removes it and its captions. */
  set(scope: CallAgentScope, state: SharedCallAgent | null, expected?: number | null): Promise<{ changed: boolean; updatedAt: number | null }>;
  add(scope: CallAgentScope, line: Omit<CaptionLine, "id" | "at">): Promise<CaptionLine>;
}

/** One app's calls, for an app with no Origin deployment and for tests. */
export function memoryCallRooms(now: () => number = Date.now): CallRoomPort {
  const rooms = new Map<string, { agent: { state: SharedCallAgent; updatedAt: number } | null; lines: CaptionLine[]; nextId: number }>();
  const room = (scope: CallAgentScope) => {
    const key = `${scope.teamId}\n${scope.room}`;
    let found = rooms.get(key);
    if (!found) rooms.set(key, found = { agent: null, lines: [], nextId: 1 });
    return found;
  };
  return {
    read: async (scope, after) => {
      const found = room(scope);
      return { agent: found.agent ? { state: structuredClone(found.agent.state), updatedAt: found.agent.updatedAt } : null, lines: found.lines.filter((line) => line.id > after) };
    },
    set: async (scope, state, expected) => {
      const found = room(scope);
      if (expected !== undefined && (found.agent?.updatedAt ?? null) !== expected) return { changed: false, updatedAt: found.agent?.updatedAt ?? null };
      if (!state) {
        found.agent = null;
        found.lines = [];
        return { changed: true, updatedAt: null };
      }
      const updatedAt = Math.max(now(), (found.agent?.updatedAt ?? 0) + 1);
      found.agent = { state: structuredClone(state), updatedAt };
      return { changed: true, updatedAt };
    },
    add: async (scope, line) => {
      const found = room(scope);
      if (!found.agent) throw new CallAgentError("No agent is in this call");
      const entry: CaptionLine = { ...line, id: found.nextId++, at: now() };
      found.lines.push(entry);
      if (found.lines.length > MAX_LINES) found.lines.splice(0, found.lines.length - MAX_LINES);
      return entry;
    },
  };
}

export interface CallAgentDeps {
  bot(botId: string): CallAgentBot | null;
  /** Whether `botId` is the one agent this call may bring in: the workspace's chief, or the project's. */
  allowed(input: { auth: RequestAuth; botId: string; room: string }): boolean;
  /** The chief's spoken answer to `prompt`, from a turn in its own chat. */
  ask(input: { auth: RequestAuth; botId: string; prompt: string }): Promise<string>;
  summarize(input: { botId: string; prompt: string }): Promise<string>;
  /** Posts the summary card, and the transcript when it was kept, in the chief's chat. */
  post(input: { botId: string; widget: Record<string, unknown>; fallback: string; transcript?: string }): void;
  /** Keeps the summary and action items in Origin; the transcript only when the call kept it. */
  record?(input: CallNotesInput): Promise<unknown>;
  transcribe(input: { botId: string; audio: Uint8Array; mime: string; settings: CallAgentSettings }): Promise<string>;
  settings(): CallAgentSettings;
  /** Shared call state; defaults to this app alone. */
  rooms?: CallRoomPort;
  log?(line: string): void;
  now?(): number;
}

export type CallAgentView = {
  botId: string;
  name: string;
  addedBy: string;
  startedAt: number;
  state: "listening" | "thinking";
  engine: TranscriptionEngine;
  keepTranscript: boolean;
  /** Set after someone said only the agent's name: their next sentence is the question. */
  awaiting?: string;
};

/** What this app holds for a call whose agent it answers for: whose turn asks, and how far it has read. */
interface Hosted {
  scope: CallAgentScope;
  auth: RequestAuth;
  cursor: number;
  busy: boolean;
}

export class CallAgentError extends Error {}

const keyOf = (scope: Pick<CallAgentScope, "teamId" | "room">) => `${scope.teamId}\n${scope.room}`;
const speakerName = (user: CallAgentScope["user"]) => user.username || user.name || "Someone";
const HOST_QUIET_MS = 45_000;
const HEARTBEAT_MS = 15_000;
const POLL_MS = 1_500;

export function createCallAgents(deps: CallAgentDeps) {
  const now = deps.now ?? Date.now;
  const rooms = deps.rooms ?? memoryCallRooms(now);
  const hostId = randomUUID();
  const hosted = new Map<string, Hosted>();
  const rates = new Map<string, { count: number; reset: number }>();

  const limit = (key: string, max: number) => {
    const at = now();
    const entry = rates.get(key);
    if (!entry || entry.reset <= at) {
      if (rates.size > 2_000) rates.clear();
      rates.set(key, { count: 1, reset: at + 60_000 });
      return;
    }
    if (++entry.count > max) throw new CallAgentError("Too many requests; slow down");
  };

  const live = (agent: { state: SharedCallAgent } | null) => (agent && !agent.state.ended ? agent.state : null);

  const view = (agent: SharedCallAgent): CallAgentView => ({
    botId: agent.botId, name: agent.name, addedBy: agent.addedBy, startedAt: agent.startedAt,
    state: agent.thinking ? "thinking" : "listening", engine: deps.settings().transcription.engine, keepTranscript: agent.keepTranscript,
    ...(agent.awaiting && agent.awaiting.until > now() ? { awaiting: agent.awaiting.name } : {}),
  });

  /** Read-modify-write of the shared state, retried when another app changed it in between. */
  const update = async (scope: CallAgentScope, change: (agent: SharedCallAgent) => SharedCallAgent | null): Promise<SharedCallAgent | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { agent } = await rooms.read(scope, Number.MAX_SAFE_INTEGER);
      const current = live(agent);
      if (!current || !agent) return null;
      const next = change(structuredClone(current));
      if (!next) return current;
      if ((await rooms.set(scope, next, agent.updatedAt)).changed) return next;
    }
    throw new CallAgentError("The call changed; try again");
  };

  const respond = async (host: Hosted, agent: SharedCallAgent, speaker: string, request: string, context: CaptionLine[]) => {
    const { scope } = host;
    await update(scope, (state) => ({ ...state, thinking: true, awaiting: undefined } as SharedCallAgent));
    try {
      const prompt = askPrompt({ callName: scope.name, agent: agent.name, speaker, request, transcript: transcriptText(context.slice(-CONTEXT_LINES - 1, -1), CONTEXT_CHARS) });
      const reply = spokenReply(await deps.ask({ auth: host.auth, botId: agent.botId, prompt }));
      if (reply && hosted.get(keyOf(scope)) === host) await rooms.add(scope, { speaker: agent.name, text: reply, agent: true });
    } catch (error) {
      if (hosted.get(keyOf(scope)) === host) {
        await rooms.add(scope, { speaker: agent.name, text: `I couldn't answer that (${error instanceof Error ? error.message : "unknown error"}).`, agent: true }).catch(() => undefined);
      }
    } finally {
      await update(scope, (state) => ({ ...state, thinking: false })).catch(() => undefined);
    }
  };

  /** The host reads the captions it has not seen and answers when someone addressed the agent. */
  const process = async (host: Hosted): Promise<void> => {
    if (host.busy) return;
    host.busy = true;
    try {
      const { agent, lines } = await rooms.read(host.scope, 0);
      const state = live(agent);
      if (!state || state.hostId !== hostId) {
        if (agent?.state.ended || !state) hosted.delete(keyOf(host.scope));
        return;
      }
      if (state.ending) {
        await finish(host, state, lines);
        return;
      }
      if (now() - state.heartbeatAt > HEARTBEAT_MS) await update(host.scope, (current) => ({ ...current, heartbeatAt: now() }));
      let latest = state;
      const refresh = async () => { latest = live((await rooms.read(host.scope, Number.MAX_SAFE_INTEGER)).agent) ?? latest; };
      for (const line of lines.filter((entry) => entry.id > host.cursor)) {
        host.cursor = line.id;
        if (line.agent || !line.userId || latest.thinking) continue;
        const wake = wakeRequest(line.text, [latest.name, ...latest.aliases]);
        const context = lines.filter((entry) => entry.id <= line.id);
        if (wake?.request) await respond(host, latest, line.speaker, wake.request, context);
        else if (wake) await update(host.scope, (current) => ({ ...current, awaiting: { userId: line.userId!, name: line.speaker, until: now() + WAKE_FOLLOW_UP_MS } }));
        else if (latest.awaiting?.userId === line.userId && latest.awaiting.until > now()) await respond(host, latest, line.speaker, line.text, context);
        else continue;
        await refresh();
      }
    } finally {
      host.busy = false;
    }
  };

  const finish = async (host: Hosted, agent: SharedCallAgent, lines: CaptionLine[]) => {
    const { scope } = host;
    hosted.delete(keyOf(scope));
    const people = [...new Set([...lines.filter((line) => !line.agent && line.userId).map((line) => line.userId!), scope.user.userId])];
    const ended = async (status: "summarizing" | "posted" | "failed", error?: string) => {
      await rooms.set(scope, null);
      await rooms.set(scope, { ...agent, ending: undefined, thinking: false, ended: { status, ...(error ? { error } : {}), at: now(), people } } as SharedCallAgent);
    };
    if (!lines.some((line) => !line.agent)) {
      await rooms.set(scope, null);
      return;
    }
    const transcript = transcriptText(lines, SUMMARY_CHARS);
    await ended("summarizing");
    try {
      const raw = await deps.summarize({ botId: agent.botId, prompt: summaryPrompt({ callName: scope.name, chief: agent.name, transcript }) });
      const summary = parseSummary(raw);
      const minutes = Math.max(1, Math.round((now() - agent.startedAt) / 60_000));
      const speakers = [...new Set(lines.filter((line) => !line.agent).map((line) => line.speaker))];
      const { widget, fallback } = summaryWidget({ callName: scope.name, summary, people: speakers, minutes, when: new Date(agent.startedAt).toISOString().slice(0, 16).replace("T", " ") });
      deps.post({ botId: agent.botId, widget, fallback, ...(agent.keepTranscript ? { transcript } : {}) });
      void deps.record?.({
        room: scope.room, callName: scope.name, startedAt: agent.startedAt, minutes, summary, ...(agent.keepTranscript ? { transcript } : {}),
      })?.catch(() => deps.log?.(`call agent: Origin did not keep the notes of ${scope.name}`));
      await ended("posted");
    } catch (error) {
      deps.log?.(`call agent: the summary for ${agent.name} failed`);
      await ended("failed", error instanceof Error ? error.message : "The summary could not be written");
    }
  };

  const host = (scope: CallAgentScope, auth: RequestAuth, cursor: number): Hosted => {
    const existing = hosted.get(keyOf(scope));
    if (existing) return existing;
    const entry: Hosted = { scope, auth, cursor, busy: false };
    hosted.set(keyOf(scope), entry);
    return entry;
  };

  /** Runs the host's pass now when this app answers for the call, so its own captions are answered without waiting for the poll. */
  const nudge = async (scope: CallAgentScope) => {
    const entry = hosted.get(keyOf(scope));
    if (entry) await process(entry);
  };

  const timer = deps.rooms ? setInterval(() => { for (const entry of hosted.values()) void process(entry).catch(() => undefined); }, POLL_MS) : null;
  timer?.unref?.();

  const requirePresent = (scope: CallAgentScope, present: readonly string[]) => {
    if (!present.includes(scope.user.userId)) throw new CallAgentError("Join the call first");
  };

  const hear = async (scope: CallAgentScope, said: string): Promise<CaptionLine | null> => {
    const clean = said.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const line = await rooms.add(scope, { speaker: speakerName(scope.user), userId: scope.user.userId, text: clean.slice(0, MAX_LINE) });
    void nudge(scope).catch(() => undefined);
    return line;
  };

  return {
    /** What everyone in the call sees: who is listening, and the captions after `after`. */
    async state(scope: CallAgentScope, after: number) {
      const { agent, lines } = await rooms.read(scope, after);
      const ended = agent?.state.ended;
      if (ended) {
        const recent = ended.at + ENDED_VISIBLE_MS > now() && ended.people.includes(scope.user.userId)
          ? { botId: agent.state.botId, name: agent.state.name, status: ended.status, ...(ended.error ? { error: ended.error } : {}), at: ended.at } : null;
        return { agent: null, lines: [] as CaptionLine[], cursor: 0, ended: recent };
      }
      if (!agent) return { agent: null, lines: [] as CaptionLine[], cursor: 0, ended: null };
      return { agent: view(agent.state), lines: lines.slice(-50), cursor: lines.at(-1)?.id ?? after, ended: null };
    },
    async join(scope: CallAgentScope, auth: RequestAuth, botId: string, present: readonly string[], aliases: readonly string[] = []) {
      requirePresent(scope, present);
      const bot = deps.bot(botId);
      if (!bot || !deps.allowed({ auth, botId, room: scope.room })) throw new CallAgentError("This agent can't join this call");
      const { agent } = await rooms.read(scope, Number.MAX_SAFE_INTEGER);
      const current = live(agent);
      if (current && now() - current.heartbeatAt <= HOST_QUIET_MS) {
        if (current.botId !== botId) throw new CallAgentError(`${current.name} is already in this call`);
        return view(current);
      }
      const state: SharedCallAgent = {
        botId, name: bot.name, aliases: aliases.filter((alias) => alias.trim() && alias !== bot.name).slice(0, 4), addedBy: speakerName(scope.user), hostId,
        startedAt: current?.startedAt ?? now(), heartbeatAt: now(), keepTranscript: current?.keepTranscript ?? deps.settings().keepTranscript, thinking: false,
      };
      if (!current) await rooms.set(scope, null);
      const { changed } = await rooms.set(scope, state, current ? agent!.updatedAt : null);
      if (!changed) throw new CallAgentError("The call changed; try again");
      const { lines } = await rooms.read(scope, 0);
      host(scope, auth, lines.at(-1)?.id ?? 0);
      return view(state);
    },
    async leave(scope: CallAgentScope, present: readonly string[]) {
      requirePresent(scope, present);
      const next = await update(scope, (state) => ({ ...state, ending: true }));
      if (!next) throw new CallAgentError("No agent is in this call");
      void nudge(scope).catch(() => undefined);
      return { ok: true };
    },
    async keep(scope: CallAgentScope, keep: boolean, present: readonly string[]) {
      requirePresent(scope, present);
      if (!await update(scope, (state) => ({ ...state, keepTranscript: keep }))) throw new CallAgentError("No agent is in this call");
      return { ok: true };
    },
    async line(scope: CallAgentScope, _auth: RequestAuth, said: string, present: readonly string[]) {
      requirePresent(scope, present);
      limit(`line:${scope.user.userId}`, LINES_PER_MINUTE);
      return { line: await hear(scope, said) };
    },
    /** The audio goes to the transcription engine and is gone when this returns: only the text is kept. Each person's app transcribes their own voice. */
    async audio(scope: CallAgentScope, _auth: RequestAuth, audio: Uint8Array, mime: string, present: readonly string[]) {
      requirePresent(scope, present);
      const settings = deps.settings();
      if (settings.transcription.engine === "browser") throw new CallAgentError("This workspace transcribes in the browser");
      const agent = live((await rooms.read(scope, Number.MAX_SAFE_INTEGER)).agent);
      if (!agent) throw new CallAgentError("No agent is in this call");
      limit(`audio:${scope.user.userId}`, AUDIO_PER_MINUTE);
      const said = await deps.transcribe({ botId: agent.botId, audio, mime, settings });
      const current = live((await rooms.read(scope, Number.MAX_SAFE_INTEGER)).agent);
      if (!current || current.botId !== agent.botId || current.startedAt !== agent.startedAt) return { line: null };
      return { line: await hear(scope, said) };
    },
    /** Ends the agent's part in calls this app answers for once nobody is in them, which summarises them. */
    async sweep(present: (scope: CallAgentScope) => Promise<readonly string[]> | readonly string[]) {
      for (const entry of hosted.values()) {
        if ((await present(entry.scope)).length) continue;
        await update(entry.scope, (state) => ({ ...state, ending: true })).catch(() => undefined);
        await process(entry).catch(() => undefined);
      }
    },
    active: () => hosted.size,
    close: () => { if (timer) clearInterval(timer); },
  };
}

export type CallAgents = ReturnType<typeof createCallAgents>;

/** Admin only: these paths are not on the client allowlist. */
export function createCallAgentSettingsRoutes(input: { file: string; keys(): { groq: boolean; openai: boolean }; changed?(settings: CallAgentSettings): void }): RouteHandler {
  return async ({ path, method, req, res, json, readBody }) => {
    if (path !== "/api/origin-call-agent/settings") return PASS;
    res.setHeader("cache-control", "no-store");
    if (method === "GET") return json(res, 200, { settings: readCallAgentSettings(input.file), keys: input.keys(), defaults: DEFAULT_TRANSCRIPTION_MODELS });
    if (method !== "PUT") return PASS;
    const settings = parseCallAgentSettings(await readBody(req, 16_000));
    writeCallAgentSettings(input.file, settings);
    input.changed?.(settings);
    return json(res, 200, { settings, keys: input.keys(), defaults: DEFAULT_TRANSCRIPTION_MODELS });
  };
}

type ReplyChange ={ type: string; threadId?: string; message?: { role: string; kind?: string; text?: string; turnTerminal?: boolean } };

/** The text of the first finished bot answer in `threadId` after `start` sends the question. */
export function awaitBotReply(store: { onChange(listener: (change: ReplyChange) => void): () => void }, threadId: string, start: () => Promise<void>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error: Error | null, reply = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve(reply);
    };
    const timer = setTimeout(() => settle(new CallAgentError("took too long to answer")), timeoutMs);
    const unsubscribe = store.onChange((change) => {
      const message = change.message;
      if ((change.type !== "message" && change.type !== "message.patch") || change.threadId !== threadId || !message) return;
      if (message.role !== "user" && message.kind === "text" && message.turnTerminal && message.text?.trim()) {
        const reply = message.text;
        queueMicrotask(() => settle(null, reply));
      }
    });
    start().catch((error: unknown) => settle(error instanceof Error ? error : new CallAgentError("could not reach the agent")));
  });
}

type Fetch = typeof fetch;

/** One OpenAI-compatible `/audio/transcriptions` request; the audio stays in memory. */
export async function transcribeWith(input: {
  audio: Uint8Array; mime: string; settings: CallAgentSettings; keys: { groq?: string; openai?: string }; fetch?: Fetch;
}): Promise<string> {
  const { engine, baseUrl, model } = input.settings.transcription;
  if (engine === "browser") throw new CallAgentError("This workspace transcribes in the browser");
  const base = engine === "local" ? baseUrl : engine === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
  const key = engine === "groq" ? input.keys.groq : engine === "openai" ? input.keys.openai : undefined;
  if (engine !== "local" && !key) throw new CallAgentError(`Add a ${engine === "groq" ? "Groq" : "OpenAI"} key under Connections to transcribe calls`);
  const form = new FormData();
  const type = /^audio\/[\w.+-]+(?:;[\w=.,\s-]*)?$/.test(input.mime) ? input.mime : "audio/webm";
  const extension = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : type.includes("wav") ? "wav" : "webm";
  form.append("file", new Blob([new Uint8Array(input.audio)], { type }), `speech.${extension}`);
  form.append("model", model || DEFAULT_TRANSCRIPTION_MODELS[engine]);
  form.append("response_format", "json");
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(`${base}/audio/transcriptions`, {
      method: "POST", body: form, headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CallAgentError(engine === "local" ? `No speech-to-text server answered at ${base}` : "The transcription service could not be reached");
  }
  if (!response.ok) throw new CallAgentError(`Transcription failed (${response.status})`);
  const body = record(await response.json().catch(() => ({})));
  return text(body.text).trim();
}
