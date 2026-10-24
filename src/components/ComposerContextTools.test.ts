// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn(async () => ({})) }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { instances: [] }, dispatch: fixture.dispatch }) }));
vi.mock("./PlanUsage", () => ({ PlanUsage: () => null }));

const { ComposerContextTools } = await import("./ComposerContextTools");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let thread = 0;
const bot = (tokens: number, busy = false): Bot => ({
  id: "atlas", name: "Atlas", threadId: `thread-${thread}`, title: "", description: "", color: "green", messages: [], notifications: false, unread: false, busy,
  modelSelection: { instanceId: "provider-one", model: "model-one" },
  tasks: [{ threadId: `thread-${thread}`, title: "Main", createdAt: 0, usage: { input: 0, output: 0, costUsd: null, turns: 4, context: { tokens, window: 100_000 } } }],
});
const reply = { id: "reply", role: "bot", kind: "text", text: "Done", at: 0 } as Message;
const compaction = { id: "compact", role: "bot", kind: "compaction", text: "Compacted", at: 1 } as Message;

let host: HTMLDivElement;
let root: Root;
const show = (source: Bot, messages: Message[] = [reply]) =>
  act(() => root.render(createElement("div", { "data-composer-card": "" }, createElement(ComposerContextTools, { bot: source, messages }))));
const chip = () => host.querySelector<HTMLButtonElement>("[data-compact-chip]");
const panelButton = () => [...host.querySelectorAll<HTMLButtonElement>("[data-chat-usage-popover] button")]
  .find((button) => button.textContent === "Compact now" || button.textContent === "Compacting…");

beforeEach(() => {
  thread += 1;
  fixture.api.mockClear();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => [new DOMRect(0, 0, 32, 32)] as unknown as DOMRectList);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("the composer's Compact chip", () => {
  it("appears only from 90% of the context, named with the share", () => {
    show(bot(89_000));
    expect(chip()).toBeNull();
    show(bot(93_000));
    expect(chip()!.getAttribute("aria-label")).toBe("Compact conversation (93% of context used)");
    expect(chip()!.textContent).toBe("Compact");
    expect(chip()!.disabled).toBe(false);
  });

  it("is locked while the bot works on a turn of its own", () => {
    show(bot(93_000, true));
    expect(chip()!.disabled).toBe(true);
    expect(chip()!.getAttribute("title")).toBe("Stop this bot's turn first");
  });

  it("runs the panel's compaction, shows progress in both places, and goes once the conversation is compacted", async () => {
    show(bot(93_000));
    await act(async () => chip()!.click());
    expect(fixture.api).toHaveBeenCalledTimes(1);
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/atlas/compact", { method: "POST", body: JSON.stringify({ threadId: `thread-${thread}` }) });
    expect(chip()!.textContent).toBe("Compacting…");
    expect(chip()!.getAttribute("aria-label")).toBe("Compacting conversation…");
    expect(chip()!.getAttribute("aria-busy")).toBe("true");
    show(bot(93_000, true));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click());
    expect(panelButton()!.textContent).toBe("Compacting…");
    expect(panelButton()!.disabled).toBe(true);
    await act(async () => chip()!.click());
    expect(fixture.api).toHaveBeenCalledTimes(1);
    show(bot(93_000, true), [reply, compaction]);
    expect(chip()).toBeNull();
    show(bot(93_000), [reply, compaction]);
    expect(chip()).toBeNull();
  });

  it("comes back ready when the request fails", async () => {
    fixture.api.mockRejectedValueOnce(new Error("offline"));
    show(bot(95_000));
    await act(async () => chip()!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "error", message: "offline" });
    expect(chip()!.textContent).toBe("Compact");
    expect(chip()!.disabled).toBe(false);
  });
});
