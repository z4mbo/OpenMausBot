import { useCallback, useSyncExternalStore } from "react";
import { api, type Message } from "@/state/store";
import { listenLiveFrames } from "./live-events";

const PAGE = 200;

interface Entry {
  messages: Message[] | null;
  beforeFirstPage: Array<{ message: Message; replaceOnly: boolean }>;
  watchers: number;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
let stopFrames: (() => void) | null = null;

function entryOf(threadId: string): Entry {
  let entry = entries.get(threadId);
  if (!entry) {
    entry = { messages: null, beforeFirstPage: [], watchers: 0, listeners: new Set() };
    entries.set(threadId, entry);
  }
  return entry;
}

function publish(entry: Entry, messages: Message[]) {
  entry.messages = messages;
  for (const listener of entry.listeners) listener();
}

function load(threadId: string) {
  api<{ messages?: Message[] }>(`/api/threads/${threadId}/messages?limit=${PAGE}`)
    .then((page) => {
      const entry = entries.get(threadId);
      if (!entry?.watchers) return;
      const beforeFirstPage = entry.beforeFirstPage;
      entry.beforeFirstPage = [];
      publish(entry, beforeFirstPage.reduce((messages, { message, replaceOnly }) => merged(messages, message, replaceOnly), page.messages ?? []));
    })
    .catch(() => {
      const entry = entries.get(threadId);
      if (entry?.watchers && !entry.messages) publish(entry, []);
    });
}

function merged(messages: Message[], message: Message, replaceOnly: boolean): Message[] {
  const index = messages.findIndex((existing) => existing.id === message.id);
  if (index >= 0) return messages.map((existing, at) => at === index ? message : existing);
  return replaceOnly ? messages : [...messages, message];
}

function upsert(threadId: string, message: Message, replaceOnly: boolean) {
  const entry = entries.get(threadId);
  if (!entry?.watchers) return;
  if (!entry.messages) entry.beforeFirstPage.push({ message, replaceOnly });
  else publish(entry, merged(entry.messages, message, replaceOnly));
}

function listen() {
  stopFrames ??= listenLiveFrames({
    onFrame: (frame) => {
      if (frame.kind === "message") upsert(frame.threadId, frame.message as Message, false);
      else if (frame.kind === "message.patch") upsert(frame.threadId, frame.message as Message, true);
    },
    onMissedFrames: () => {
      for (const [threadId, entry] of entries) if (entry.watchers) load(threadId);
    },
  });
}

function watch(threadId: string): () => void {
  const entry = entryOf(threadId);
  entry.watchers += 1;
  listen();
  if (entry.watchers === 1) load(threadId);
  return () => {
    entry.watchers -= 1;
    if (entry.watchers > 0) return;
    entries.delete(threadId);
    if (!entries.size) {
      stopFrames?.();
      stopFrames = null;
    }
  };
}

export function useThreadTranscript(threadId: string | undefined): Message[] | null {
  const subscribe = useCallback((listener: () => void) => {
    if (!threadId) return () => {};
    const entry = entryOf(threadId);
    entry.listeners.add(listener);
    const stop = watch(threadId);
    return () => {
      entry.listeners.delete(listener);
      stop();
    };
  }, [threadId]);
  return useSyncExternalStore(subscribe, () => (threadId ? entries.get(threadId)?.messages ?? null : null));
}
