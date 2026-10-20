import { useSyncExternalStore } from "react";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { listenLiveFrames } from "./live-events";

export type LivePhase = "idle" | "thinking" | "tool" | "writing" | "approval" | "waiting";

export interface LiveStep {
  id: string;
  name: string;
  spoken?: string;
  detail?: string;
  ok?: boolean;
  output?: string;
  at: number;
}

export interface LiveFeed {
  threadId: string;
  active: boolean;
  phase: LivePhase;
  thought: string;
  steps: LiveStep[];
  approval?: string;
  updatedAt: number;
}

export const LIVE_STEPS_KEPT = 8;
const THOUGHT_CHARS = 600;
const OUTPUT_CHARS = 160;
const FEEDS_KEPT = 300;

function oneLine(text: string | undefined, max: number): string | undefined {
  const flat = text?.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function contentText(output: string): string | undefined {
  if (!output.trimStart().startsWith("[")) return undefined;
  let blocks: unknown;
  try {
    blocks = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!Array.isArray(blocks)) return undefined;
  const text = blocks.map((block) => typeof block?.text === "string" ? block.text : "").join(" ").trim();
  return text || undefined;
}

function readableOutput(output: string | undefined): string | undefined {
  return oneLine(output && (contentText(output) ?? output), OUTPUT_CHARS);
}

function emptyFeed(threadId: string, at: number): LiveFeed {
  return { threadId, active: false, phase: "idle", thought: "", steps: [], updatedAt: at };
}

export function reduceLiveFeed(previous: LiveFeed | undefined, event: RuntimeEvent): LiveFeed {
  const at = Date.parse(event.createdAt) || Date.now();
  const feed = { ...(previous ?? emptyFeed(event.threadId, at)), updatedAt: at };
  switch (event.type) {
    case "turn.started":
      return { ...feed, active: true, phase: "thinking", thought: "", approval: undefined };
    case "content.delta":
      if (event.streamKind === "reasoning_text") {
        return { ...feed, active: true, phase: "thinking", thought: (feed.thought + event.delta).slice(-THOUGHT_CHARS) };
      }
      return { ...feed, active: true, phase: "writing" };
    case "item.started":
      if (event.itemType === "reasoning") return { ...feed, active: true, phase: "thinking", thought: "" };
      return {
        ...feed,
        active: true,
        phase: "tool",
        steps: [
          { id: event.itemId ?? event.eventId, name: event.title?.trim() || "tool", detail: oneLine(event.summary ?? event.input, 200), at },
          ...feed.steps,
        ].slice(0, LIVE_STEPS_KEPT),
      };
    case "item.completed": {
      if (event.itemType !== "tool") return event.itemType === "assistant_text" ? { ...feed, phase: feed.active ? "thinking" : feed.phase } : feed;
      const id = event.itemId;
      return {
        ...feed,
        phase: feed.active ? "thinking" : feed.phase,
        steps: feed.steps.map((step) => step.id === id ? { ...step, ok: event.ok, output: readableOutput(event.output) } : step),
      };
    }
    case "request.opened":
      return { ...feed, active: true, phase: "approval", approval: oneLine(event.summary || event.tool, 160) };
    case "request.resolved":
      return { ...feed, phase: feed.active ? "thinking" : "idle", approval: undefined };
    case "turn.wait_started":
      return { ...feed, active: true, phase: "waiting" };
    case "turn.wait_ended":
      return { ...feed, phase: feed.active ? "thinking" : "idle" };
    case "turn.completed":
    case "cap.exhausted":
    case "session.exited":
      return settle(feed);
    case "runtime.error":
      return event.terminal ? settle(feed) : feed;
    default:
      return previous ?? feed;
  }
}

function settle(feed: LiveFeed): LiveFeed {
  return {
    ...feed,
    active: false,
    phase: "idle",
    approval: undefined,
    steps: feed.steps.map((step) => step.ok === undefined ? { ...step, ok: true } : step),
  };
}

export function pickFeed(feeds: Iterable<LiveFeed | undefined>): LiveFeed | undefined {
  let best: LiveFeed | undefined;
  for (const feed of feeds) {
    if (!feed) continue;
    if (!best || (feed.active && !best.active) || (feed.active === best.active && feed.updatedAt > best.updatedAt)) best = feed;
  }
  return best;
}

const feeds = new Map<string, LiveFeed>();
const listeners = new Set<() => void>();
let version = 0;
let listening = false;

function record(event: RuntimeEvent) {
  const next = reduceLiveFeed(feeds.get(event.threadId), event);
  if (next === feeds.get(event.threadId)) return;
  feeds.delete(event.threadId);
  feeds.set(event.threadId, next);
  while (feeds.size > FEEDS_KEPT) feeds.delete(feeds.keys().next().value!);
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening) {
    listening = true;
    listenLiveFrames({ onFrame: (frame) => { if (frame.kind === "runtime") record(frame.event); } });
  }
  return () => {
    listeners.delete(listener);
  };
}

const currentVersion = () => version;

export function useLiveFeeds(): number {
  return useSyncExternalStore(subscribe, currentVersion, currentVersion);
}

export function liveFeedOf(threadIds: Iterable<string>): LiveFeed | undefined {
  return pickFeed([...threadIds].map((threadId) => feeds.get(threadId)));
}
