// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initialState, StoreContext } from "@/state/store";
import { TriggersPanel } from "./TriggersPanel";

vi.mock("./Avatar", () => ({ BotAvatar: () => null }));

let root: Root;
let opener: HTMLButtonElement;
const dispatch = vi.fn();
const bot = { id: "synthetic-chief", threadId: "synthetic-thread", name: "Fixture Chief", title: "", description: "", color: "green" as const, notifications: true, unread: false, messages: [], modelSelection: { instanceId: "synthetic", model: "synthetic" } };
const webhook = { id: "synthetic-hook", endpointId: "synthetic-endpoint", name: "Fixture update", prompt: "", botId: bot.id, runOn: "maus" as const, enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 0 };
const tab = (reverse = false) => {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: reverse, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(() => [new DOMRect()] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "checkVisibility").mockImplementation(function (this: HTMLElement) {
    return !this.closest("details:not([open])") || this.tagName === "SUMMARY";
  });
  dispatch.mockClear();
  opener = document.createElement("button");
  const host = document.createElement("div");
  document.body.append(opener, host);
  opener.focus();
  root = createRoot(host);
  flushSync(() => root.render(createElement(StoreContext.Provider, {
    value: { state: { ...initialState, bots: [bot], webhooks: [webhook], webhookIngress: { available: true, baseUrl: "https://fixture.invalid" } }, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
    children: createElement(TriggersPanel),
  })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("wraps forward from a closed Advanced summary instead of hidden action buttons", () => {
  const summary = document.querySelector("summary")!;
  summary.focus();
  expect(tab().defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('[aria-label="Close triggers"]'));
});

it("wraps backward to the closed summary and includes action buttons after expansion", () => {
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close triggers"]')!;
  close.focus();
  expect(tab(true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(document.querySelector("summary"));
  document.querySelector("details")!.open = true;
  close.focus();
  expect(tab(true).defaultPrevented).toBe(true);
  expect(document.activeElement?.textContent).toBe("Delete");
});

it("retains Escape dismissal and restores the opener on unmount", () => {
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(dispatch).toHaveBeenCalledWith({ type: "toggleTriggers", open: false });
  flushSync(() => root.render(null));
  expect(document.activeElement).toBe(opener);
});
