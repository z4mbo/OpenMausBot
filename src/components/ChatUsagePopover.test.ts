// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import { setChatContextDetails, setChatUsageOpen } from "@/lib/chat-usage-preferences";
import { spaceAbove } from "@/hooks/use-space-above";

const fixture = vi.hoisted(() => ({ instances: [] as InstanceInfo[], dispatch: vi.fn(), api: vi.fn(async () => ({})) }));
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { instances: fixture.instances }, dispatch: fixture.dispatch }) }));
vi.mock("./PlanUsage", () => ({ PlanUsage: ({ providerId }: { providerId: string }) => createElement("span", { "data-quota-provider": providerId }, "Actual quota component") }));

const { ChatContextDetails, ChatUsagePopover } = await import("./ChatUsagePopover");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const bot = (context?: { tokens: number; window?: number }, busy = false): Bot => ({
  id: "atlas", name: "Atlas", threadId: "thread", title: "", description: "", color: "green", messages: [], notifications: false, unread: false, busy,
  modelSelection: { instanceId: "provider-one", model: "model-one" },
  tasks: context ? [{ threadId: "thread", title: "Main", createdAt: 0, usage: { input: 900_000, output: 1_000, costUsd: null, turns: 8, context } }] : undefined,
});
const compaction = { id: "compact", role: "bot", kind: "compaction", text: "Compacted", at: 0 } as Message;

let host: HTMLDivElement;
let root: Root;
const show = (source: Bot) => act(() => root.render(createElement("div", { "data-composer-card": "" }, createElement(ChatUsagePopover, { bot: source, messages: [] }))));
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const panel = () => host.querySelector<HTMLElement>("[data-chat-usage-popover]");
const pointer = (type: "pointerover" | "pointerout" | "pointerenter" | "pointerleave", pointerType: string) =>
  act(() => { trigger().dispatchEvent(new PointerEvent(type, { bubbles: type.startsWith("pointerover") || type.startsWith("pointerout"), pointerType })); });

beforeEach(() => {
  setChatUsageOpen(false);
  setChatContextDetails(false);
  fixture.instances = [];
  fixture.api.mockClear();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => [new DOMRect(0, 0, 32, 32)] as unknown as DOMRectList);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setChatUsageOpen(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the composer's usage ring", () => {
  it("pins a panel above the composer for the active provider, closed by Escape with focus back on the ring", () => {
    show(bot());
    act(() => trigger().click());
    expect(panel()).not.toBeNull();
    expect(panel()!.getAttribute("aria-modal")).toBe("false");
    expect(panel()!.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "bottom-full", "right-0"]));
    expect(panel()!.querySelector('[data-quota-provider="provider-one"]')).not.toBeNull();
    expect(panel()!.textContent).toContain("model-one");
    expect(localStorage.getItem("origin-chat-usage-open")).toBe("1");
    act(() => panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(localStorage.getItem("origin-chat-usage-open")).toBe("0");
  });

  it("peeks on a mouse hover without pinning, but never on touch", () => {
    vi.useFakeTimers();
    show(bot({ tokens: 20_000, window: 100_000 }));
    pointer("pointerover", "touch");
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(panel()).toBeNull();
    pointer("pointerover", "mouse");
    act(() => { vi.advanceTimersByTime(100); });
    expect(panel()).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(panel()).not.toBeNull();
    expect(localStorage.getItem("origin-chat-usage-open")).toBe("0");
    pointer("pointerout", "mouse");
    act(() => { vi.advanceTimersByTime(300); });
    expect(panel()).toBeNull();
  });

  it("draws a quiet ring until the context is nearly full, then names the share in colour", () => {
    show(bot({ tokens: 20_000, window: 100_000 }));
    expect(trigger().getAttribute("title")).toBe("Context 20% full · show plan usage and context");
    expect(trigger().textContent).toBe("");
    expect(trigger().querySelector("svg")!.getAttribute("class")).toContain("text-ink-secondary");
    show(bot({ tokens: 90_000, window: 100_000 }));
    expect(trigger().textContent).toBe("90%");
    expect(trigger().querySelector("svg")!.getAttribute("class")).toContain("text-warning");
    show(bot({ tokens: 97_000, window: 100_000 }));
    expect(trigger().querySelector("svg")!.getAttribute("class")).toContain("text-danger");
  });

  it("keeps a hidden chat's panel unrendered until its ring is on screen", () => {
    vi.mocked(HTMLElement.prototype.getClientRects).mockImplementation(() => [] as unknown as DOMRectList);
    setChatUsageOpen(true);
    show(bot());
    expect(panel()).toBeNull();
    vi.mocked(HTMLElement.prototype.getClientRects).mockImplementation(() => [new DOMRect(0, 0, 32, 32)] as unknown as DOMRectList);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(panel()).not.toBeNull();
  });

  it("offers Compact now in the panel once the context is nearly full, locked while the bot works", () => {
    show(bot({ tokens: 91_000, window: 100_000 }));
    act(() => trigger().click());
    const compact = [...panel()!.querySelectorAll("button")].find((button) => button.textContent === "Compact now")!;
    expect(panel()!.textContent).toContain("Atlas's context is 91% full.");
    expect(compact.disabled).toBe(false);
    act(() => compact.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/atlas/compact", { method: "POST", body: JSON.stringify({ threadId: "thread" }) });
    show(bot({ tokens: 91_000, window: 100_000 }, true));
    const locked = [...panel()!.querySelectorAll("button")].find((button) => button.textContent === "Compact now" || button.textContent === "Compacting…")!;
    expect(locked.disabled).toBe(true);
    expect(locked.getAttribute("title")).toBe("Stop this bot's turn first");
  });
});

describe("context details", () => {
  it("uses a reported context window and never treats lifetime input tokens as current context", () => {
    const html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: bot({ tokens: 20_000, window: 100_000 }), messages: [] }));
    expect(html).toContain("20%"); expect(html).toContain("20k of 100k tokens");
    expect(html).toContain("Reported window size");
    expect(html).toContain('role="meter"');
    expect(html).not.toContain("900%");
  });

  it("leaves unknown context unknown and discards readings made before compaction", () => {
    let html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: bot(), messages: [] }));
    expect(html).toContain("Not reported"); expect(html).not.toContain("0%");
    html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: bot({ tokens: 90_000, window: 100_000 }), messages: [compaction] }));
    expect(html).toContain("Waiting for a new context reading after compaction");
    expect(html).not.toContain("90%");
    expect(html).not.toContain("Compact now");
  });

  it("falls back to the catalog's window when the provider reports none", () => {
    fixture.instances = [{ instanceId: "provider-one", driverKind: "claudeAgent", displayName: "One", snapshot: { state: "available" },
      models: { default: "model-one", options: [{ id: "model-one", label: "Model one", contextWindow: 200_000 }] } }];
    const html = renderToStaticMarkup(createElement(ChatContextDetails, { bot: bot({ tokens: 50_000 }), messages: [] }));
    expect(html).toContain("25%");
    expect(html).toContain("Model limit from catalog");
  });
});

describe("room above the composer", () => {
  it("fits the panel between the composer and the header, never shorter than a usable floor", () => {
    expect(spaceAbove(700, 120, 560)).toBe(560);
    expect(spaceAbove(400, 120, 560)).toBe(264);
    expect(spaceAbove(200, 120, 560)).toBe(160);
  });
});
