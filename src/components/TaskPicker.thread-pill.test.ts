// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Task } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], groups: [], pendingQueued: {} }, dispatch: fixture.dispatch }),
}));

const { TaskPicker, THREAD_SEARCH_MIN, threadMenuPosition } = await import("./TaskPicker");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const threads = (count: number): Task[] => Array.from({ length: count }, (_, index) => ({
  threadId: `t${index}`, title: `Thread ${index}`, createdAt: index, lastThreadOrderAt: index,
}));
const pepper = (tasks: Task[], threadId = "t0"): Bot => ({
  id: "pepper", name: "Pepper", color: "green", threadId, title: "", description: "", notifications: true, unread: false,
  messages: [], modelSelection: { instanceId: "fake", model: "fake" }, tasks,
});

let host: HTMLDivElement;
let root: Root;
const trigger = () => host.querySelector<HTMLButtonElement>("[data-chathead-thread]")!;
const menu = () => document.querySelector<HTMLElement>("[data-thread-menu]");
const options = () => [...document.querySelectorAll<HTMLButtonElement>("[data-thread-option]")];
const key = (target: EventTarget, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); });

beforeEach(() => {
  fixture.dispatch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the thread pill beside the bot's name", () => {
  it("names the current thread and opens its menu with the newest first and the current one focused", () => {
    act(() => root.render(createElement(TaskPicker, { bot: pepper(threads(3), "t1") })));
    expect(trigger().getAttribute("aria-label")).toBe("Current thread: Thread 1");
    expect(trigger().textContent).toContain("Thread 1");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(menu()?.getAttribute("role")).toBe("dialog");
    expect(options().map((option) => option.querySelector("div")?.textContent)).toEqual(["Thread 2", "Thread 1", "Thread 0"]);
    expect(document.querySelector('input[aria-label="Search threads"]')).toBeNull();
    expect(document.activeElement).toBe(options()[1]);
    expect(options()[1]!.getAttribute("aria-current")).toBe("true");
  });

  it("moves between threads with the arrow keys and closes on Escape, back on the pill", () => {
    act(() => root.render(createElement(TaskPicker, { bot: pepper(threads(3)) })));
    act(() => trigger().click());
    const list = options()[0]!.closest<HTMLElement>('[role="group"]')!;
    expect(document.activeElement).toBe(options()[2]);
    key(list, "ArrowDown");
    expect(document.activeElement).toBe(options()[0]);
    key(list, "ArrowUp");
    expect(document.activeElement).toBe(options()[2]);
    key(list, "Home");
    expect(document.activeElement).toBe(options()[0]);
    key(window, "Escape");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("switches thread through the existing action", () => {
    act(() => root.render(createElement(TaskPicker, { bot: pepper(threads(3)) })));
    act(() => trigger().click());
    act(() => options()[0]!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "pepper", threadId: "t2" });
  });

  it("starts a new thread through the existing action", () => {
    act(() => root.render(createElement(TaskPicker, { bot: pepper(threads(2)) })));
    act(() => trigger().click());
    act(() => document.querySelector<HTMLButtonElement>('[data-thread-menu] button[aria-label="New thread"]')!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "newTask", botId: "pepper" });
  });

  it("offers search once there are many threads", () => {
    act(() => root.render(createElement(TaskPicker, { bot: pepper(threads(THREAD_SEARCH_MIN)) })));
    act(() => trigger().click());
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search threads"]');
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it("keeps the menu inside a 375px window", () => {
    const placed = threadMenuPosition({ left: 200, bottom: 60 }, { width: 375, height: 667 });
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + placed.width).toBeLessThanOrEqual(367);
    expect(placed.top).toBe(68);
    expect(threadMenuPosition({ left: 400, bottom: 60 }, { width: 1280, height: 820 })).toMatchObject({ left: 400, width: 352 });
  });
});
