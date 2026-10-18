// Privacy invariants: call audio is only ever held in memory for one transcription request and never written anywhere;
// the transcript lives in memory for the call and is dropped once it is summarised, unless the people in the call keep it.
import { readFileSync } from "node:fs";
import { writeFileAtomic } from "./atomic.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

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
 * Speech-to-text splits and spells names freely ("G G's", "ggs"), so the name is matched with its letters run together. */
export function wakeRequest(said: string, name: string): { request: string } | null {
  const target = compact(name);
  if (!target) return null;
  const tokens = words(said);
  for (let index = 0; index < tokens.length; index++) {
    if (!GREETINGS.has(tokens[index]!.word)) continue;
    let joined = "";
    for (let end = index + 1; end < Math.min(tokens.length, index + 6); end++) {
      joined += tokens[end]!.word;
      if (joined === target || (target.endsWith("s") && joined === target.slice(0, -1))) {
        return { request: said.slice(tokens[end]!.end).replace(/^[\s,.:;!?-]+/, "").trim() };
      }
      if (joined.length >= target.length) break;
    }
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

export type CallAgentScope = { teamId: string; room: string; name: string; user: { userId: string; name: string; username?: string } };

export interface CallAgentDeps {
  bot(botId: string): CallAgentBot | null;
  /** Whether `botId` is the one agent this call may bring in: the workspace's chief, or the project's. */
  allowed(input: { auth: RequestAuth; botId: string; room: string }): boolean;
  /** The chief's spoken answer to `prompt`, from a turn in its own chat. */
  ask(input: { auth: RequestAuth; botId: string; prompt: string }): Promise<string>;
  summarize(input: { botId: string; prompt: string }): Promise<string>;
  /** Posts the summary card, and the transcript when it was kept, in the chief's chat. */
  post(input: { botId: string; widget: Record<string, unknown>; fallback: string; transcript?: string }): void;
  transcribe(input: { audio: Uint8Array; mime: string; settings: CallAgentSettings }): Promise<string>;
  settings(): CallAgentSettings;
  log?(line: string): void;
  now?(): number;
}

type EndedView = { botId: string; name: string; status: "summarizing" | "posted" | "failed"; error?: string; at: number };

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

interface Session {
  key: string;
  scope: CallAgentScope;
  bot: CallAgentBot;
  addedBy: string;
  startedAt: number;
  lines: CaptionLine[];
  nextId: number;
  people: Map<string, string>;
  keepTranscript: boolean;
  thinking: boolean;
  awaiting: { userId: string; until: number } | null;
}

export class CallAgentError extends Error {}

const keyOf = (scope: Pick<CallAgentScope, "teamId" | "room">) => `${scope.teamId}\n${scope.room}`;
const speakerName = (user: CallAgentScope["user"]) => user.username || user.name || "Someone";

export function createCallAgents(deps: CallAgentDeps) {
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const ended = new Map<string, EndedView & { people: Set<string> }>();
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

  const append = (session: Session, line: Omit<CaptionLine, "id" | "at">): CaptionLine => {
    const entry: CaptionLine = { ...line, text: line.text.slice(0, MAX_LINE), id: session.nextId++, at: now() };
    session.lines.push(entry);
    if (session.lines.length > MAX_LINES) session.lines.splice(0, session.lines.length - MAX_LINES);
    return entry;
  };

  const view = (session: Session): CallAgentView => ({
    botId: session.bot.id, name: session.bot.name, addedBy: session.addedBy, startedAt: session.startedAt,
    state: session.thinking ? "thinking" : "listening", engine: deps.settings().transcription.engine, keepTranscript: session.keepTranscript,
    ...(session.awaiting && session.awaiting.until > now() ? { awaiting: session.people.get(session.awaiting.userId) ?? "someone" } : {}),
  });

  const respond = async (session: Session, auth: RequestAuth, speaker: string, request: string) => {
    session.thinking = true;
    session.awaiting = null;
    try {
      const prompt = askPrompt({
        callName: session.scope.name, agent: session.bot.name, speaker, request,
        transcript: transcriptText(session.lines.slice(-CONTEXT_LINES - 1, -1), CONTEXT_CHARS),
      });
      const reply = spokenReply(await deps.ask({ auth, botId: session.bot.id, prompt }));
      if (sessions.get(session.key) === session && reply) append(session, { speaker: session.bot.name, text: reply, agent: true });
    } catch (error) {
      if (sessions.get(session.key) === session) {
        append(session, { speaker: session.bot.name, text: `I couldn't answer that (${error instanceof Error ? error.message : "unknown error"}).`, agent: true });
      }
    } finally {
      session.thinking = false;
    }
  };

  const hear = (session: Session, auth: RequestAuth, user: CallAgentScope["user"], said: string): CaptionLine | null => {
    const clean = said.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const speaker = speakerName(user);
    session.people.set(user.userId, speaker);
    const line = append(session, { speaker, userId: user.userId, text: clean });
    if (session.thinking) return line;
    const wake = wakeRequest(clean, session.bot.name);
    if (wake && wake.request) void respond(session, auth, speaker, wake.request);
    else if (wake) session.awaiting = { userId: user.userId, until: now() + WAKE_FOLLOW_UP_MS };
    else if (session.awaiting?.userId === user.userId && session.awaiting.until > now()) void respond(session, auth, speaker, clean);
    return line;
  };

  const finish = async (session: Session) => {
    sessions.delete(session.key);
    const lines = session.lines;
    const people = new Set(session.people.keys());
    people.add(session.addedBy);
    const record: EndedView & { people: Set<string> } = { botId: session.bot.id, name: session.bot.name, status: "summarizing", at: now(), people };
    ended.set(session.key, record);
    session.lines = [];
    if (!lines.some((line) => !line.agent)) {
      ended.delete(session.key);
      return;
    }
    const transcript = transcriptText(lines, SUMMARY_CHARS);
    try {
      const raw = await deps.summarize({ botId: session.bot.id, prompt: summaryPrompt({ callName: session.scope.name, chief: session.bot.name, transcript }) });
      const { widget, fallback } = summaryWidget({
        callName: session.scope.name, summary: parseSummary(raw), people: [...session.people.values()],
        minutes: Math.max(1, Math.round((now() - session.startedAt) / 60_000)), when: new Date(session.startedAt).toISOString().slice(0, 16).replace("T", " "),
      });
      deps.post({ botId: session.bot.id, widget, fallback, ...(session.keepTranscript ? { transcript } : {}) });
      record.status = "posted";
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : "The summary could not be written";
      deps.log?.(`call agent: the summary for ${session.bot.name} failed`);
    }
    record.at = now();
  };

  const requireSession = (scope: CallAgentScope) => {
    const session = sessions.get(keyOf(scope));
    if (!session) throw new CallAgentError("No agent is in this call");
    return session;
  };

  return {
    /** What everyone in the call sees: who is listening, and the captions after `after`. */
    state(scope: CallAgentScope, after: number) {
      const session = sessions.get(keyOf(scope));
      const done = ended.get(keyOf(scope));
      const recent = done && done.at + ENDED_VISIBLE_MS > now() && done.people.has(scope.user.userId)
        ? { botId: done.botId, name: done.name, status: done.status, ...(done.error ? { error: done.error } : {}), at: done.at } : null;
      if (!session) return { agent: null, lines: [] as CaptionLine[], cursor: 0, ended: recent };
      session.people.set(scope.user.userId, session.people.get(scope.user.userId) ?? speakerName(scope.user));
      return { agent: view(session), lines: session.lines.filter((line) => line.id > after).slice(-50), cursor: session.nextId - 1, ended: null };
    },
    join(scope: CallAgentScope, auth: RequestAuth, botId: string, present: readonly string[]) {
      if (!present.includes(scope.user.userId)) throw new CallAgentError("Join the call first");
      const bot = deps.bot(botId);
      if (!bot || !deps.allowed({ auth, botId, room: scope.room })) throw new CallAgentError("This agent can't join this call");
      const existing = sessions.get(keyOf(scope));
      if (existing) {
        if (existing.bot.id !== botId) throw new CallAgentError(`${existing.bot.name} is already in this call`);
        return view(existing);
      }
      const session: Session = {
        key: keyOf(scope), scope, bot, addedBy: speakerName(scope.user), startedAt: now(), lines: [], nextId: 1,
        people: new Map([[scope.user.userId, speakerName(scope.user)]]), keepTranscript: deps.settings().keepTranscript, thinking: false, awaiting: null,
      };
      sessions.set(session.key, session);
      ended.delete(session.key);
      return view(session);
    },
    leave(scope: CallAgentScope, present: readonly string[]) {
      if (!present.includes(scope.user.userId)) throw new CallAgentError("Join the call first");
      const session = requireSession(scope);
      void finish(session);
      return { ok: true };
    },
    keep(scope: CallAgentScope, keep: boolean, present: readonly string[]) {
      if (!present.includes(scope.user.userId)) throw new CallAgentError("Join the call first");
      requireSession(scope).keepTranscript = keep;
      return { ok: true };
    },
    line(scope: CallAgentScope, auth: RequestAuth, said: string, present: readonly string[]) {
      if (!present.includes(scope.user.userId)) throw new CallAgentError("Join the call first");
      const session = requireSession(scope);
      limit(`line:${scope.user.userId}`, LINES_PER_MINUTE);
      return { line: hear(session, auth, scope.user, said) };
    },
    /** The audio goes to the transcription engine and is gone when this returns: only the text is kept. */
    async audio(scope: CallAgentScope, auth: RequestAuth, audio: Uint8Array, mime: string, present: readonly string[]) {
      if (!present.includes(scope.user.userId)) throw new CallAgentError("Join the call first");
      const session = requireSession(scope);
      const settings = deps.settings();
      if (settings.transcription.engine === "browser") throw new CallAgentError("This workspace transcribes in the browser");
      limit(`audio:${scope.user.userId}`, AUDIO_PER_MINUTE);
      const said = await deps.transcribe({ audio, mime, settings });
      if (sessions.get(session.key) !== session) return { line: null };
      return { line: hear(session, auth, scope.user, said) };
    },
    /** Ends the agent's part in calls nobody is in any more, which summarises them. */
    sweep(present: (scope: CallAgentScope) => readonly string[]) {
      for (const session of sessions.values()) {
        if (!present(session.scope).length) void finish(session);
      }
      for (const [key, done] of ended) if (done.at + ENDED_VISIBLE_MS <= now()) ended.delete(key);
    },
    active: () => sessions.size,
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
