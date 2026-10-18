// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ api: vi.fn(), openBot: vi.fn() }));
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), api: calls.api, openBot: calls.openBot }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
import { BotEditorStore, initialState, type Bot, type useStore } from "@/state/store";
import { ArchivedBotsPanel } from "./ArchivedBotsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, opener: HTMLButtonElement;
const bots: Bot[] = ["Atlas", "Juniper"].map((name, index) => ({ id: String(index), threadId: `thread-${index}`, name, title: "Synthetic archived agent", description: "", notifications: false, unread: false, hidden: true, color: "green", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" } }));
const dispatch = vi.fn();
const render = (items = bots, onClose: () => void = vi.fn()) => act(() => root.render(createElement(BotEditorStore, {
  value: { state: initialState, dispatch } as unknown as ReturnType<typeof useStore>, children: createElement(ArchivedBotsPanel, {
    bots: items, onClose, onRestored: vi.fn(), returnFocusRef: { current: opener },
  }),
})));
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label)!;
const key = (name: string, shiftKey = false) => act(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true })));
beforeEach(() => {
  host = document.createElement("div"); opener = document.createElement("button"); document.body.append(opener, host);
  opener.focus(); root = createRoot(host); calls.api.mockReset(); calls.openBot.mockReset(); dispatch.mockReset();
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });

describe("archive modal focus ownership", () => {
  it.each(["Delete Atlas", "Delete all"])("contains a nested %s confirmation and returns to its surviving action", async (label) => {
    render(); const target = button(label); target.focus(); act(() => target.click());
    expect(document.activeElement).toBe(button("Cancel"));
    key("Tab", true); expect(document.querySelector('[role="alertdialog"]')?.contains(document.activeElement)).toBe(true);
    key("Escape");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(target);
    key("Tab", true);
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
  });

  it("holds a pending restore on its panel, blocks Escape and exposes the error without a new focus reset", async () => {
    let fail!: (error: Error) => void;
    calls.api.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const close = vi.fn(); render(bots, close);
    const restore = button("Restore"); restore.focus(); act(() => restore.click());
    const panel = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(panel); key("Escape"); expect(close).not.toHaveBeenCalled();
    await act(async () => fail(new Error("Synthetic restore failure")));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Synthetic restore failure");
    expect(document.activeElement).toBe(panel);
    key("Tab"); expect(document.activeElement).toBe(button("Restore all"));
    key("Escape"); expect(close).toHaveBeenCalledOnce();
  });

  it("leaves a restored last bot's destination in control of focus", async () => {
    const destination = document.createElement("input"); document.body.append(destination);
    calls.api.mockResolvedValue({ bot: { ...bots[0], hidden: false } });
    calls.openBot.mockImplementation(() => destination.focus());
    render([bots[0]!], () => root.render(null));
    await act(async () => button("Restore").click());
    expect(calls.openBot).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(destination);
  });
});
