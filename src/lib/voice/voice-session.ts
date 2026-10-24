import { useSyncExternalStore } from "react";

import type { WireMessage } from "../../../shared/wire";
import type { LiveMediaPhase } from "../live-call-media";
import type { ListenerHooks, VoiceListener } from "./listener";
import { VoiceListenerError } from "./listener";
import {
  stepVoiceSession,
  VOICE_OFF,
  type ReplyVoice,
  type VoiceSessionEffect,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "./session-machine";
import { matchWakePhrase } from "./wake-phrase";

export interface VoiceTarget {
  botId: string;
  threadId: string;
  name: string;
}

export interface VoiceTranscriptLine {
  id: number;
  who: "you" | "agent";
  text: string;
}

export interface VoiceSessionDeps {
  reply: ReplyVoice;
  listener(hooks: ListenerHooks): VoiceListener;
  send(target: VoiceTarget, text: string): void;
  /** Resolves true when the whole answer was spoken, false when it was cut off. */
  speak(target: VoiceTarget, text: string): Promise<boolean>;
  stopSpeaking(): void;
  openLive(target: VoiceTarget): Promise<void>;
  hangUp(): void;
  cue(): void;
  needsAnswerLine(name: string): string;
  now(): number;
}

export interface VoiceWakeSnapshot {
  target: VoiceTarget | null;
  state: VoiceSessionState;
  reply: ReplyVoice;
  transcript: VoiceTranscriptLine[];
}

type ChatMessage = Pick<WireMessage, "id" | "role" | "kind" | "text" | "turnTerminal" | "card">;

const AWAKE_MS = 8_000;
const FOLLOW_UP_MS = 6_000;
const TICK_MS = 500;
const TRANSCRIPT_LINES = 6;
const ANSWER_TIMEOUT_MS = 10 * 60_000;
export const LIVE_QUIET_MS = 45_000;

export class VoiceSession {
  readonly target: VoiceTarget;
  private readonly deps: VoiceSessionDeps;
  private state: VoiceSessionState = VOICE_OFF;
  private transcript: VoiceTranscriptLine[] = [];
  private lineId = 0;
  private listener: VoiceListener | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private knownIds = new Set<string>();
  private asking: { seen: Set<string>; sawBusy: boolean; at: number } | null = null;
  private speakGeneration = 0;
  private liveQuestion: string | null = null;
  private liveSeen = { started: false, wentLive: false, activityAt: 0, heard: "", caption: "" };
  private readonly onChange: () => void;

  constructor(target: VoiceTarget, deps: VoiceSessionDeps, onChange: () => void) {
    this.target = target;
    this.deps = deps;
    this.onChange = onChange;
  }

  snapshot(): VoiceWakeSnapshot {
    return { target: this.target, state: this.state, reply: this.deps.reply, transcript: this.transcript };
  }

  start(): void {
    this.dispatch({ type: "start" });
  }

  stop(): void {
    this.dispatch({ type: "stop" });
  }

  interrupt(): void {
    this.dispatch({ type: "interrupt", at: this.deps.now() });
  }

  heard(text: string): void {
    this.dispatch({ type: "heard", text, at: this.deps.now() });
  }

  observeChat(messages: readonly ChatMessage[], busy: boolean): void {
    if (this.state.phase !== "asking" || !this.asking) {
      this.knownIds = new Set(messages.map((message) => message.id));
      return;
    }
    const asking = this.asking;
    if (busy) asking.sawBusy = true;
    const fresh = messages.filter((message) => !asking.seen.has(message.id));
    const card = fresh.find((message) => message.kind === "options" && message.card && !message.card.answered && !message.card.dismissed);
    if (card) return this.dispatch({ type: "reply", text: this.deps.needsAnswerLine(this.target.name) });
    const answers = fresh.filter((message) => message.role === "bot" && message.kind === "text" && message.text?.trim());
    const terminal = answers.findLast((message) => message.turnTerminal);
    if (terminal?.text) return this.dispatch({ type: "reply", text: terminal.text });
    const finished = !busy && asking.sawBusy;
    const timedOut = this.deps.now() - asking.at > ANSWER_TIMEOUT_MS;
    if (!finished && !timedOut) return;
    const last = answers.at(-1)?.text;
    this.dispatch(last ? { type: "reply", text: last } : { type: "noReply" });
  }

  observeLive(live: { phase: LiveMediaPhase; botId: string | null; heard: string; caption: string; needsKey: boolean }, busy: boolean): void {
    if (this.state.phase !== "live") return;
    const seen = this.liveSeen;
    if (live.botId !== this.target.botId) {
      if (seen.started) this.dispatch({ type: "liveEnded" });
      return;
    }
    if (live.phase === "starting" || live.phase === "ending") {
      seen.started = true;
      return;
    }
    const now = this.deps.now();
    if (live.phase === "live") {
      seen.started = true;
      if (!seen.wentLive) {
        seen.wentLive = true;
        seen.activityAt = now;
        if (this.liveQuestion) this.deps.send(this.target, this.liveQuestion);
        this.liveQuestion = null;
      }
      if (live.heard !== seen.heard || live.caption !== seen.caption || busy) seen.activityAt = now;
      seen.heard = live.heard;
      seen.caption = live.caption;
      if (now - seen.activityAt >= LIVE_QUIET_MS) this.deps.hangUp();
      return;
    }
    if (!seen.started && !live.needsKey && live.phase === "idle") return;
    this.dispatch(seen.wentLive ? { type: "liveEnded" } : { type: "failed", error: "live" });
  }

  private line(who: VoiceTranscriptLine["who"], text: string) {
    this.transcript = [...this.transcript, { id: ++this.lineId, who, text }].slice(-TRANSCRIPT_LINES);
  }

  private dispatch(event: VoiceSessionEvent): void {
    const { state, effects } = stepVoiceSession(this.state, event, {
      match: (text) => matchWakePhrase(text, [{ id: this.target.botId, name: this.target.name }]),
      reply: this.deps.reply,
      awakeMs: AWAKE_MS,
      followUpMs: FOLLOW_UP_MS,
    });
    const changed = state !== this.state;
    this.state = state;
    for (const effect of effects) this.apply(effect);
    this.syncTimer();
    if (changed || effects.length) this.onChange();
  }

  private syncTimer() {
    const wanted = this.state.phase !== "off" && this.state.phase !== "error";
    if (wanted && !this.timer) this.timer = setInterval(() => this.dispatch({ type: "tick", at: this.deps.now() }), TICK_MS);
    if (!wanted && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private apply(effect: VoiceSessionEffect): void {
    switch (effect.type) {
      case "prepare": {
        const listener = this.deps.listener({
          onHeard: (text) => this.listener === listener && this.heard(text),
          onFailure: (error) => this.listener === listener && this.dispatch({ type: "failed", error }),
          prompt: () => `Ehi ${this.target.name}. Hey ${this.target.name}.`,
        });
        this.listener = listener;
        listener.start().then(
          () => this.listener === listener && this.dispatch({ type: "ready" }),
          (error: unknown) => this.listener === listener && this.dispatch({ type: "failed", error: error instanceof VoiceListenerError ? error.code : "engine" }),
        );
        return;
      }
      case "listen":
        return this.listener?.listen();
      case "mute":
        return this.listener?.mute();
      case "release":
        this.listener?.stop();
        this.listener = null;
        this.asking = null;
        this.liveQuestion = null;
        return;
      case "cue":
        return this.deps.cue();
      case "ask":
        this.line("you", effect.text);
        this.asking = { seen: new Set(this.knownIds), sawBusy: false, at: this.deps.now() };
        return this.deps.send(this.target, effect.text);
      case "speak": {
        this.asking = null;
        this.line("agent", effect.text);
        const mine = ++this.speakGeneration;
        void this.deps.speak(this.target, effect.text).then(() => {
          if (mine === this.speakGeneration) this.dispatch({ type: "spoken", at: this.deps.now() });
        });
        return;
      }
      case "stopSpeaking":
        this.speakGeneration += 1;
        return this.deps.stopSpeaking();
      case "openLive":
        this.liveQuestion = effect.question ?? null;
        if (effect.question) this.line("you", effect.question);
        this.liveSeen = { started: false, wentLive: false, activityAt: this.deps.now(), heard: "", caption: "" };
        this.deps.openLive(this.target).catch(() => this.dispatch({ type: "failed", error: "live" }));
        return;
      case "hangUp":
        return this.deps.hangUp();
    }
  }
}

let session: VoiceSession | null = null;
let snapshot: VoiceWakeSnapshot = { target: null, state: VOICE_OFF, reply: "speak", transcript: [] };
const watchers = new Set<() => void>();

function publish() {
  snapshot = session ? session.snapshot() : { ...snapshot, target: null, state: VOICE_OFF, transcript: [] };
  for (const watcher of Array.from(watchers)) watcher();
}

export function startVoiceWake(target: VoiceTarget, deps: VoiceSessionDeps): VoiceSession {
  session?.stop();
  const next = new VoiceSession(target, deps, () => {
    if (session === next) publish();
  });
  session = next;
  next.start();
  publish();
  return next;
}

export function stopVoiceWake(botId?: string): void {
  if (!session || (botId && session.target.botId !== botId)) return;
  const current = session;
  session = null;
  current.stop();
  publish();
}

export function currentVoiceWake(): VoiceSession | null {
  return session;
}

export function voiceWakeSnapshot(): VoiceWakeSnapshot {
  return snapshot;
}

export function useVoiceWake(): VoiceWakeSnapshot {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => snapshot,
    () => snapshot,
  );
}
