// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StoreProvider, useStore, type Action, type AppState, type Bot, type Message } from "./store";

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor() { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
const older = { threadId: "old", title: "Old", createdAt: 1, busy: false };
const newer = { threadId: "new", title: "New", createdAt: 2, busy: false };
const bot: Bot = {
  id: "bot", threadId: "new", name: "Fixture", title: "", description: "", notifications: true,
  unread: false, color: "green", modelSelection: { instanceId: "fake", model: "m" },
  tasks: [older, newer], messages: [], activeLeafId: null,
};
const message = (id: string, parentId: string | null = null): Message => ({ id, at: 3, role: "user", kind: "text", text: id, parentId });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const settle = async () => { for (let step = 0; step < 8; step++) await new Promise((resolve) => setTimeout(resolve, 0)); };
let root: Root | undefined;
let container: HTMLElement | undefined;
let state!: AppState;
let dispatch!: (action: Action) => void;
function Probe() { ({ state, dispatch } = useStore()); return null; }
const stream = () => FixtureEventSource.opened[0]!;

afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function mount(preserveSelection = false, extraBots: Bot[] = []) {
  FixtureEventSource.opened = [];
  const peripherals = deferred<void>();
  const page = deferred<Response>();
  const pages = new Map<string, ReturnType<typeof deferred<Response>>[]>([["old", [page]]]);
  const requestedPages = new Map<string, number>();
  const fetch = vi.fn((path: string, _init?: RequestInit): Promise<Response> => {
    if (path.startsWith("/api/bots?")) return Promise.resolve(response({ bots: [...(preserveSelection ? [{ ...bot, id: "chief", threadId: "chief-thread", tasks: [{ ...newer, threadId: "chief-thread" }] }, bot] : [bot]), ...extraBots], groups: [] }));
    if (path === "/api/routines") return peripherals.promise.then(() => response({ routines: [], runs: [] }));
    const snapshot = /^\/api\/threads\/([^/]+)\/messages\?limit=200$/.exec(path);
    if (snapshot) {
      const threadId = decodeURIComponent(snapshot[1]!);
      const index = requestedPages.get(threadId) ?? 0;
      requestedPages.set(threadId, index + 1);
      return pages.get(threadId)?.[index]?.promise ?? Promise.reject(new Error("Unexpected snapshot request"));
    }
    if (path === "/api/instances") return Promise.resolve(response({ instances: [] }));
    if (path === "/api/webhooks") return Promise.resolve(response({ webhooks: [], attempts: [] }));
    return Promise.resolve(response({}));
  });
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(StoreProvider, null, createElement(Probe))));
  await settle();
  stream().send({ kind: "hello", resumed: false, cursor: "fixture:0" });
  await settle();
  expect(state.bots.find((candidate) => candidate.id === bot.id)?.threadId).toBe("new");
  stream().send({ kind: "bot", bot: { ...bot, threadId: "old", tasks: [older], messages: undefined } });
  stream().send({ kind: "bot", bot: { ...bot, messages: undefined } });
  peripherals.resolve();
  await settle();
  return { fetch, page, nextPage: (threadId = "old") => {
    const next = deferred<Response>();
    pages.set(threadId, [...(pages.get(threadId) ?? []), next]);
    return next;
  } };
}

it("recovers a retained old thread from its pinned transcript after stale queued metadata follows hydration", async () => {
  const { fetch, page } = await mount();
  expect(state.bots[0]).toMatchObject({ threadId: "old", awaitingThreadSnapshot: true, messages: [] });
  const requests = fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"));
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject(["/api/threads/old/messages?limit=200", { method: "GET" }]);
  expect(fetch.mock.calls.some(([path]) => path.includes("/tasks/"))).toBe(false);
  page.resolve(response({ messages: [message("old-message")], activeLeafId: "old-message", hasMore: true }));
  await settle();
  expect(state.bots[0]).toMatchObject({ threadId: "old", awaitingThreadSnapshot: false, messages: [message("old-message")], activeLeafId: "old-message", hasMore: true, tasks: [older, newer] });
});

it("deduplicates pending reads and replays events received while the pinned transcript loads", async () => {
  const { fetch, page } = await mount();
  stream().send({ kind: "bot", bot: { ...bot, messages: undefined } });
  stream().send({ kind: "message", threadId: "old", message: message("live", "base") });
  stream().send({ kind: "thread", threadId: "old", activeLeafId: "live" });
  await settle();
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
  expect(state.bots[0]?.messages).toEqual([]);
  page.resolve(response({ messages: [message("base")], activeLeafId: "base" }));
  await settle();
  expect(state.bots[0]).toMatchObject({ awaitingThreadSnapshot: false, messages: [message("base"), message("live", "base")], activeLeafId: "live" });
  expect(state.backgroundThreadEvents.old).toBeUndefined();
});

it("reports a failed read once and retries only after explicit same-row selection", async () => {
  const { fetch, page, nextPage } = await mount();
  page.resolve(response({ error: "Conversation unavailable" }, 503));
  await settle();
  expect(state.error).toBe("Conversation unavailable");
  expect(state.bots[0]?.awaitingThreadSnapshot).toBe(true);
  flushSync(() => dispatch({ type: "error", message: "A later error" }));
  stream().send({ kind: "bot", bot: { ...bot, messages: undefined } });
  await settle();
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
  expect(state.error).toBe("A later error");
  const retry = nextPage();
  flushSync(() => dispatch({ type: "select", id: bot.id }));
  await settle();
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(2);
  expect(fetch.mock.calls.some(([path]) => path.includes("/tasks/"))).toBe(false);
  retry.resolve(response({ messages: [message("recovered")], activeLeafId: "recovered" }));
  await settle();
  expect(state.bots[0]).toMatchObject({ awaitingThreadSnapshot: false, messages: [message("recovered")] });
});

it("aborts a read on navigation and never replaces the newly selected transcript with its late answer", async () => {
  const { fetch, page } = await mount();
  const signal = fetch.mock.calls.find(([path]) => path.startsWith("/api/threads/"))![1]!.signal!;
  const generation = state.transcriptGeneration.old ?? 0;
  flushSync(() => dispatch({ type: "switchTask", botId: bot.id, threadId: "new" }));
  await settle();
  expect(signal.aborted).toBe(true);
  flushSync(() => dispatch({ type: "taskSwitched", bot: { ...bot, messages: [message("new-only")], activeLeafId: "new-only" } }));
  page.resolve(response({ messages: [message("stale-old")], activeLeafId: "stale-old" }));
  flushSync(() => dispatch({ type: "pendingThreadSnapshotLoaded", botId: bot.id, threadId: "old", generation, page: { messages: [message("stale-old")], activeLeafId: "stale-old" } }));
  await settle();
  expect(state.bots[0]).toMatchObject({ threadId: "new", messages: [message("new-only")], activeLeafId: "new-only", awaitingThreadSnapshot: false });
});

it("does not restore a deleted thread's approvals over its replacement", async () => {
  const { fetch, page } = await mount();
  const approval: Message = { id: "old-approval", at: 3, role: "bot", kind: "options", card: { title: "Allow?", subtitle: "Review", options: ["Allow"], requestId: "old-request", tool: "Write" } };
  stream().send({ kind: "bot", bot: { ...bot, tasks: [newer], messages: [message("replacement")], activeLeafId: "replacement" } });
  await settle();
  expect(fetch.mock.calls.find(([path]) => path.startsWith("/api/threads/"))![1]!.signal!.aborted).toBe(true);
  page.resolve(response({ messages: [approval], activeLeafId: approval.id }));
  await settle();
  expect(state.bots[0]).toMatchObject({ threadId: "new", tasks: [newer], messages: [message("replacement")], awaitingThreadSnapshot: false });
});

it("rejects the old generation after reconnect hydration and accepts only the new pinned read", async () => {
  const { fetch, page, nextPage } = await mount();
  const generation = state.transcriptGeneration.old ?? 0;
  const next = nextPage();
  stream().send({ kind: "hello", resumed: false, cursor: "fixture:reconnected" });
  stream().send({ kind: "bot", bot: { ...bot, threadId: "old", tasks: [older], messages: undefined } });
  stream().send({ kind: "bot", bot: { ...bot, messages: undefined } });
  await settle();
  expect(state.transcriptGeneration.old).toBeGreaterThan(generation);
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(2);
  expect(fetch.mock.calls.find(([path]) => path.startsWith("/api/threads/"))![1]!.signal!.aborted).toBe(true);
  page.resolve(response({ messages: [message("stale")], activeLeafId: "stale" }));
  flushSync(() => dispatch({ type: "pendingThreadSnapshotLoaded", botId: bot.id, threadId: "old", generation, page: { messages: [message("stale")], activeLeafId: "stale" } }));
  await settle();
  expect(state.bots[0]).toMatchObject({ awaitingThreadSnapshot: true, messages: [] });
  next.resolve(response({ messages: [message("fresh")], activeLeafId: "fresh" }));
  await settle();
  expect(state.bots[0]).toMatchObject({ awaitingThreadSnapshot: false, messages: [message("fresh")] });
});

it("rejects malformed snapshot responses without unlocking or entering a retry loop", async () => {
  const { fetch, page } = await mount();
  page.resolve(response({ messages: [], activeLeafId: 123 }));
  await settle();
  expect(state.error).toBe("Invalid conversation snapshot");
  expect(state.bots[0]?.awaitingThreadSnapshot).toBe(true);
  await settle();
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
});

it("aborts an owned pending read when the provider unmounts", async () => {
  const { fetch, page } = await mount();
  const signal = fetch.mock.calls.find(([path]) => path.startsWith("/api/threads/"))![1]!.signal!;
  flushSync(() => root!.unmount());
  root = undefined;
  expect(signal.aborted).toBe(true);
  page.resolve(response({ messages: [], activeLeafId: null }));
  await settle();
});

it("recovers an inline specialist while its project Chief remains selected", async () => {
  const { fetch, page } = await mount(true);
  expect(state.selectedId).toBe("chief");
  expect(state.bots.find((candidate) => candidate.id === bot.id)?.awaitingThreadSnapshot).toBe(true);
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
  page.resolve(response({ messages: [message("specialist")], activeLeafId: "specialist" }));
  await settle();
  expect(state.bots.find((candidate) => candidate.id === bot.id)).toMatchObject({ threadId: "old", awaitingThreadSnapshot: false, messages: [message("specialist")] });
  expect(state.selectedId).toBe("chief");
  expect(fetch.mock.calls.some(([path]) => path.includes("/tasks/"))).toBe(false);
});

it("recovers every pending specialist independently while the project Chief remains selected", async () => {
  const otherOlder = { ...older, threadId: "other-old" };
  const otherNewer = { ...newer, threadId: "other-new" };
  const otherBot: Bot = { ...bot, id: "other-bot", threadId: "other-new", tasks: [otherOlder, otherNewer] };
  const { fetch, page, nextPage } = await mount(true, [otherBot]);
  const otherPage = nextPage("other-old");
  stream().send({ kind: "bot", bot: { ...otherBot, threadId: "other-old", tasks: [otherOlder], messages: undefined } });
  stream().send({ kind: "bot", bot: { ...otherBot, messages: undefined } });
  await settle();
  const requests = fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"));
  expect(requests.map(([path]) => path).sort()).toEqual(["/api/threads/old/messages?limit=200", "/api/threads/other-old/messages?limit=200"]);
  expect(requests.every(([, init]) => init?.signal?.aborted === false)).toBe(true);
  expect(state.selectedId).toBe("chief");
  otherPage.resolve(response({ messages: [message("other-history")], activeLeafId: "other-history" }));
  await settle();
  expect(state.bots.find((candidate) => candidate.id === otherBot.id)).toMatchObject({ awaitingThreadSnapshot: false, messages: [message("other-history")] });
  expect(state.bots.find((candidate) => candidate.id === bot.id)?.awaitingThreadSnapshot).toBe(true);
  page.resolve(response({ messages: [message("first-history")], activeLeafId: "first-history" }));
  await settle();
  expect(state.bots.find((candidate) => candidate.id === bot.id)).toMatchObject({ awaitingThreadSnapshot: false, messages: [message("first-history")] });
  expect(state.selectedId).toBe("chief");
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(2);
  expect(fetch.mock.calls.some(([path]) => path.includes("/tasks/"))).toBe(false);
});

it("retries a failed inline specialist snapshot without moving the Chief selection", async () => {
  const { fetch, page, nextPage } = await mount(true);
  page.resolve(response({ error: "Specialist history unavailable" }, 503));
  await settle();
  expect(state.error).toBe("Specialist history unavailable");
  expect(state.selectedId).toBe("chief");
  const retry = nextPage();
  flushSync(() => dispatch({ type: "retryPendingThreadSnapshot", botId: bot.id, threadId: "old" }));
  await settle();
  expect(state.selectedId).toBe("chief");
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/")).map(([path]) => path)).toEqual(["/api/threads/old/messages?limit=200", "/api/threads/old/messages?limit=200"]);
  retry.resolve(response({ messages: [message("inline-retry")], activeLeafId: "inline-retry" }));
  await settle();
  expect(state.bots.find((candidate) => candidate.id === bot.id)).toMatchObject({ threadId: "old", awaitingThreadSnapshot: false, messages: [message("inline-retry")] });
  expect(state.selectedId).toBe("chief");
  expect(fetch.mock.calls.some(([path]) => path.includes("/tasks/"))).toBe(false);
});

it("drains additional pending reads after an earlier failure without retrying the failure", async () => {
  const others = Array.from({ length: 4 }, (_, index): Bot => ({
    ...bot,
    id: `bot-${index}`,
    threadId: `new-${index}`,
    tasks: [{ ...older, threadId: `old-${index}` }, { ...newer, threadId: `new-${index}` }],
  }));
  const { fetch, page, nextPage } = await mount(true, others);
  const pages = others.map((other, index) => {
    const pending = nextPage(`old-${index}`);
    stream().send({ kind: "bot", bot: { ...other, threadId: `old-${index}`, tasks: [other.tasks![0]!], messages: undefined } });
    stream().send({ kind: "bot", bot: { ...other, messages: undefined } });
    return pending;
  });
  await settle();
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(4);
  page.resolve(response({ error: "First history unavailable" }, 503));
  await settle();
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(5);
  for (const [index, pending] of pages.entries()) pending.resolve(response({ messages: [message(`history-${index}`)], activeLeafId: `history-${index}` }));
  await settle();
  for (const [index, other] of others.entries()) {
    expect(state.bots.find((candidate) => candidate.id === other.id)).toMatchObject({ awaitingThreadSnapshot: false, messages: [message(`history-${index}`)] });
  }
  expect(state.bots.find((candidate) => candidate.id === bot.id)?.awaitingThreadSnapshot).toBe(true);
  expect(state.error).toBe("First history unavailable");
  expect(state.selectedId).toBe("chief");
  expect(fetch.mock.calls.filter(([path]) => path === "/api/threads/old/messages?limit=200")).toHaveLength(1);
  expect(fetch.mock.calls.some(([path]) => path.includes("/tasks/"))).toBe(false);
});

it("ignores explicit retry for a different thread while its pinned snapshot is pending", async () => {
  const { fetch, page } = await mount(true);
  const generation = state.transcriptGeneration.old ?? 0;
  flushSync(() => dispatch({ type: "retryPendingThreadSnapshot", botId: bot.id, threadId: "new" }));
  await settle();
  expect(state.transcriptGeneration.old ?? 0).toBe(generation);
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
  expect(state.selectedId).toBe("chief");
  page.resolve(response({ messages: [message("valid-history")], activeLeafId: "valid-history" }));
  await settle();
  expect(state.bots.find((candidate) => candidate.id === bot.id)?.messages).toEqual([message("valid-history")]);
});

it("aborts a pending snapshot when its bot starts deletion and ignores its late answer", async () => {
  const { fetch, page } = await mount();
  const generation = state.transcriptGeneration.old ?? 0;
  const signal = fetch.mock.calls.find(([path]) => path.startsWith("/api/threads/"))![1]!.signal!;
  flushSync(() => dispatch({ type: "botDeletionPending", botId: bot.id, on: true }));
  await settle();
  expect(signal.aborted).toBe(true);
  page.resolve(response({ messages: [message("deleted-history")], activeLeafId: "deleted-history" }));
  flushSync(() => dispatch({ type: "pendingThreadSnapshotLoaded", botId: bot.id, threadId: "old", generation, page: { messages: [message("deleted-history")], activeLeafId: "deleted-history" } }));
  await settle();
  expect(state.bots[0]).toMatchObject({ awaitingThreadSnapshot: true, messages: [] });
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
});

it("never reads a replacement thread absent from the bot's task list", async () => {
  const { fetch, page } = await mount();
  const signal = fetch.mock.calls.find(([path]) => path.startsWith("/api/threads/"))![1]!.signal!;
  stream().send({ kind: "bot", bot: { ...bot, threadId: "missing", tasks: [], messages: undefined } });
  await settle();
  expect(state.bots[0]).toMatchObject({ threadId: "missing", tasks: [], awaitingThreadSnapshot: true, messages: [] });
  expect(signal.aborted).toBe(true);
  expect(fetch.mock.calls.filter(([path]) => path.startsWith("/api/threads/"))).toHaveLength(1);
  page.resolve(response({ messages: [message("obsolete")], activeLeafId: "obsolete" }));
  await settle();
  expect(state.bots[0]?.messages).toEqual([]);
});
