// @vitest-environment happy-dom
import { createElement, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardDrag } from "./use-card-drag";

const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
const dropped = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

function Board({ enabled }: { enabled: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useCardDrag({ enabled, root: container, onDrop: dropped });
  return createElement("div", { ref: container },
    createElement("div", { "data-column-id": "todo" },
      createElement("article", { "data-task-id": "first", onPointerDown: (event) => drag.press(event, "first") }, "First"),
      createElement("article", { "data-task-id": "second" }, "Second")),
    drag.drag && createElement("div", { ref: drag.ghost, "data-active-drag": drag.drag.taskId }));
}
const render = (enabled: boolean) => flushSync(() => root.render(createElement(Board, { enabled })));
const pointer = (target: EventTarget, type: string, x: number, y: number) => flushSync(() => target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerType: "mouse", bubbles: true })));
function press() { pointer(host.querySelector("article")!, "pointerdown", 40, 40); }
function move() { pointer(window, "pointermove", 80, 80); }
function frame() {
  const next = [...frames].at(-1);
  expect(next).toBeDefined();
  frames.delete(next![0]);
  flushSync(() => next![1](16));
}
function start() { press(); move(); frame(); }

beforeEach(() => {
  dropped.mockClear();
  frames.clear();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: vi.fn(() => []) });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.dataset.taskId ? new DOMRect(20, this.dataset.taskId === "first" ? 20 : 180, 260, 90) : new DOMRect(0, 0, 300, 600);
  });
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.replaceChildren();
  root = createRoot(host);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).elementsFromPoint;
});

describe("issue drag permission changes", () => {
  it("cancels a lifted card when editing permission is removed", async () => {
    render(true);
    start();
    expect(host.querySelector("[data-active-drag]")).not.toBeNull();
    render(false);
    await vi.waitFor(() => expect(host.querySelector("[data-active-drag]")).toBeNull());
    pointer(window, "pointerup", 80, 80);
    expect(dropped).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe("");
  });

  it("does not lift a previously pressed card after editing permission is removed", () => {
    render(true);
    press();
    render(false);
    move();
    expect(host.querySelector("[data-active-drag]")).toBeNull();
    pointer(window, "pointerup", 80, 80);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("allows a fresh drag after editing permission is restored", () => {
    render(false);
    render(true);
    start();
    pointer(window, "pointerup", 80, 80);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped).toHaveBeenCalledWith("first", { columnId: "todo", beforeTaskId: "second" }, expect.any(DOMRect));
  });

  it("does not commit after Escape", () => {
    render(true);
    start();
    flushSync(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    pointer(window, "pointerup", 80, 80);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("does not commit after its project unmounts", () => {
    render(true);
    start();
    flushSync(() => root.render(null));
    pointer(window, "pointerup", 80, 80);
    expect(dropped).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe("");
  });
});
