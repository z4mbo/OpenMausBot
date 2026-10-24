// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { setChatContextDetails, setChatUsageOpen } from "@/lib/chat-usage-preferences";

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { instances: [] } }) }));
vi.mock("./PlanUsage", () => ({ PlanUsage: ({ providerId }: { providerId: string }) => createElement("span", { "data-quota-provider": providerId }, providerId) }));
const { ChatUsagePopover } = await import("./ChatUsagePopover");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const bot = (id: string): Bot => ({ id, name: id, threadId: `${id}-thread`, title: "", description: "", color: "green", messages: [], notifications: false, unread: false, modelSelection: { instanceId: `${id}-provider`, model: `${id}-model` } });
const chief = bot("chief"), echo = bot("echo");
chief.tasks = [{ threadId: chief.threadId, title: "Main", createdAt: 0, usage: { input: 12_000, output: 0, costUsd: null, turns: 1, context: { tokens: 12_000, window: 200_000 } } }];

type Active = "chief" | "echo" | null;
function RetainedChats({ active }: { active: Active }) {
  return createElement("main", null, ...[chief, echo].map(source => createElement("section", { key: source.id, "data-chat": source.id, style: { display: active === source.id ? "block" : "none" } },
    createElement("div", { "data-composer-card": "" }, createElement(ChatUsagePopover, { bot: source, messages: [] })))));
}

let host: HTMLDivElement, root: Root;
const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();
const panels = () => [...document.querySelectorAll<HTMLElement>("[data-chat-usage-popover]")];
const resize = () => { for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver); };
const show = (active: Active) => act(() => root.render(createElement(RetainedChats, { active })));
const trigger = (id: string) => host.querySelector<HTMLButtonElement>(`[data-chat="${id}"] button[aria-haspopup="dialog"]`)!;
const collapsed = (node: HTMLElement | null): boolean => Boolean(node && (node.hidden || node.style.display === "none" || collapsed(node.parentElement)));

beforeEach(() => {
  setChatUsageOpen(false); setChatContextDetails(false);
  vi.stubGlobal("ResizeObserver", class {
    callback: ResizeObserverCallback;
    targets = new Set<Element>();
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    disconnect() { observers.delete(this); this.targets.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (collapsed(this)) return new DOMRect(0, 0, 0, 0);
    if (this.tagName === "MAIN") return new DOMRect(0, 0, 375, 667);
    return "composerCard" in this.dataset ? new DOMRect(20, 560, 335, 96) : new DOMRect(300, 610, 30, 30);
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    const bounds = this.getBoundingClientRect();
    return (bounds.width > 0 && bounds.height > 0 ? [bounds] : []) as unknown as DOMRectList;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); setChatUsageOpen(false); setChatContextDetails(false);
  expect(observers.size).toBe(0); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("retained chat usage visibility", () => {
  it("only renders the visible chat's panel when a hidden Chief remains mounted", () => {
    show("echo");
    act(() => trigger("echo").click());
    expect(panels()).toHaveLength(1);
    expect(panels()[0].textContent).toContain("echo-model");
    expect(panels()[0].textContent).toContain("Not reported");
    expect(panels()[0].textContent).not.toContain("chief-model");
    expect(panels()[0].textContent).not.toContain("12k");
  });

  it("moves the persistent open panel across visibility changes using ResizeObserver", () => {
    act(() => setChatUsageOpen(true));
    show("chief");
    expect(panels()).toHaveLength(1);
    expect(panels()[0].textContent).toContain("12k");
    expect([...observers].some(observer => observer.targets.has(trigger("chief")))).toBe(true);
    show(null); act(resize);
    expect(panels()).toHaveLength(0);
    expect(localStorage.getItem("origin-chat-usage-open")).toBe("1");
    show("echo"); act(resize);
    expect(panels()).toHaveLength(1);
    expect(panels()[0].textContent).toContain("echo-model");
    expect(panels()[0].textContent).not.toContain("12k");
    expect(localStorage.getItem("origin-chat-usage-open")).toBe("1");
  });

  it("rejects a visibility-hidden trigger when resize rechecks noncollapsed layout", () => {
    act(() => setChatUsageOpen(true)); show("echo");
    trigger("echo").style.visibility = "hidden";
    act(() => window.dispatchEvent(new Event("resize")));
    expect(panels()).toHaveLength(0);
    trigger("echo").style.visibility = "visible";
    act(() => window.dispatchEvent(new Event("resize")));
    expect(panels()).toHaveLength(1);
    expect(panels()[0].textContent).toContain("echo-model");
  });

  it("closes with Escape and returns focus to the visible chat trigger", () => {
    act(() => setChatUsageOpen(true)); show("echo");
    const panel = panels().find(item => item.textContent?.includes("echo-model"))!;
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(panels()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger("echo"));
    expect(localStorage.getItem("origin-chat-usage-open")).toBe("0");
    act(() => trigger("echo").click());
    expect(panels()).toHaveLength(1);
    act(() => trigger("echo").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(panels()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger("echo"));
  });
});
