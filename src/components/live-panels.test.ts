// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { ActivityRow } from "../../shared/activity";
import type { AppState, Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined }),
}));

const { InspectorPanel } = await import("./InspectorPanel");
const { ActivityPanel } = await import("./ActivityPanel");
const { BotEditorStore, initialState } = await import("@/state/store");
const { publishLiveFrame, publishMissedFrames } = await import("@/lib/live-events");

const opened = vi.fn();
class SpyEventSource {
  onopen = null;
  onerror = null;
  onmessage = null;
  constructor(url: string) { opened(url); }
  close() {}
}

const bot = {
  id: "bot", threadId: "thread", name: "Fixture", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "fake", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
} as unknown as Bot;
const runtime = (eventId: string, fields: Record<string, unknown>, threadId = "thread") => ({
  eventId, provider: "codex", threadId, createdAt: "2026-10-04T09:00:00.000Z", ...fields,
}) as RuntimeEvent;
const frame = (event: RuntimeEvent) => publishLiveFrame({ kind: "runtime", event });
const missed = () => publishMissedFrames();

const fetched: string[] = [];
let activityRows: ActivityRow[] = [];
let root: Root;
let mounted = false;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
async function mount(panel: typeof InspectorPanel | typeof ActivityPanel) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
  const render = (current: Bot) => {
    const state: AppState = { ...initialState, bots: [current], selectedId: current.id };
    const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
    flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(panel, { bot: current }) })));
  };
  render(bot);
  await settle();
  return render;
}

beforeEach(() => {
  opened.mockClear();
  fetched.length = 0;
  activityRows = [];
  vi.stubGlobal("EventSource", SpyEventSource);
  vi.stubGlobal("fetch", (path: string) => {
    fetched.push(path);
    const body = path.startsWith("/api/threads/") ? { entries: [], total: { runtime: 0, native: 0 } } : { rows: activityRows };
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
});
afterEach(() => {
  if (mounted) root.unmount();
  mounted = false;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Inspector on the app's live stream", () => {
  it("shows this thread's runtime events and opens no stream of its own", async () => {
    await mount(InspectorPanel);
    const events = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "events")!;
    flushSync(() => events.click());
    flushSync(() => {
      frame(runtime("e1", { type: "item.started", itemType: "tool", title: "List the files" }));
      frame(runtime("e2", { type: "item.started", itemType: "tool", title: "Somebody else's step" }, "other-thread"));
    });
    await settle();
    expect(document.body.textContent).toContain("tool: List the files");
    expect(document.body.textContent).not.toContain("Somebody else's step");
    expect(opened).not.toHaveBeenCalled();
  });

  it("reloads from disk when the stream missed frames it could not replay", async () => {
    await mount(InspectorPanel);
    expect(fetched).toEqual(["/api/threads/thread/events?limit=400"]);
    missed();
    await settle();
    expect(fetched).toEqual(["/api/threads/thread/events?limit=400", "/api/threads/thread/events?limit=400"]);
  });
});

describe("Activity on the app's live stream", () => {
  it("keeps a pending receipt refresh when bot updates replace the task array", async () => {
    const render = await mount(ActivityPanel);
    expect(document.body.textContent).toContain("Nothing yet.");
    activityRows = [{ at: "2026-10-04T09:00:00.000Z", threadId: bot.threadId, tool: "Bash", app: null, label: "Ran a command", outcome: "ran" }];
    frame(runtime("tool-done", { type: "item.completed", itemType: "tool", itemId: "tool", ok: true }));
    render({ ...bot, tasks: (bot.tasks ?? []).map((task) => ({ ...task })) });
    frame(runtime("turn-done", { type: "turn.completed", ok: true }));
    render({ ...bot, busy: false, tasks: (bot.tasks ?? []).map((task) => ({ ...task })) });
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(fetched).toEqual(["/api/bots/bot/activity?limit=300", "/api/bots/bot/activity?limit=300"]);
    expect(document.body.textContent).toContain("Ran a command");
    expect(document.body.textContent).not.toContain("Nothing yet.");
    expect(opened).not.toHaveBeenCalled();
  });

  it("cancels the previous bot's pending refresh when switching bots", async () => {
    const render = await mount(ActivityPanel);
    frame(runtime("previous-turn", { type: "turn.completed", ok: true }));
    render({ ...bot, id: "next-bot", threadId: "next-thread", tasks: [] });
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(fetched).toEqual(["/api/bots/bot/activity?limit=300", "/api/bots/next-bot/activity?limit=300"]);
    frame(runtime("old-thread", { type: "turn.completed", ok: true }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(fetched).toHaveLength(2);
  });

  it("cancels a pending receipt refresh and its subscription on unmount", async () => {
    await mount(ActivityPanel);
    frame(runtime("before-close", { type: "turn.completed", ok: true }));
    root.unmount();
    mounted = false;
    frame(runtime("after-close", { type: "turn.completed", ok: true }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(fetched).toEqual(["/api/bots/bot/activity?limit=300"]);
  });

  it("reloads when one of the bot's turns settles, with no stream of its own", async () => {
    await mount(ActivityPanel);
    expect(fetched).toEqual(["/api/bots/bot/activity?limit=300"]);
    frame(runtime("e3", { type: "turn.completed", ok: true }, "other-thread"));
    frame(runtime("e4", { type: "turn.completed", ok: true }));
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(fetched).toEqual(["/api/bots/bot/activity?limit=300", "/api/bots/bot/activity?limit=300"]);
    expect(opened).not.toHaveBeenCalled();
  });

  it("reloads when the stream missed frames it could not replay", async () => {
    await mount(ActivityPanel);
    missed();
    await settle();
    expect(fetched).toHaveLength(2);
  });
});
