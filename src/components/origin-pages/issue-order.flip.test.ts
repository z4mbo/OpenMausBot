// @vitest-environment happy-dom
import { createElement, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlip } from "./issue-order";

type Motion = { element: HTMLElement; frames: Keyframe[]; duration: number; cancelled: boolean; cancel: ReturnType<typeof vi.fn> };
const motions: Motion[] = [];
let reversed = false;
let reduced = false;
let seed: ReturnType<typeof useFlip>;
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);

function Board({ move }: { move: number }) {
  const container = useRef<HTMLDivElement>(null);
  seed = useFlip(container, move);
  return createElement("div", { ref: container }, ["a", "b"].map((id) => createElement("article", { key: id, "data-flip-id": id }, id)));
}
const render = (move: number) => flushSync(() => root.render(createElement(Board, { move })));
const active = (element: HTMLElement) => motions.filter((motion) => motion.element === element && !motion.cancelled);

beforeEach(() => {
  motions.length = 0;
  reversed = false;
  reduced = false;
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const id = this.dataset.flipId;
    if (!id) return new DOMRect(0, 0, 600, 800);
    const layout = (id === "a") === reversed ? 100 : 0;
    const motion = active(this).at(-1);
    const translation = motion ? Number(/translate\(0px, (-?[\d.]+)px\)/.exec(String(motion.frames[0].transform))?.[1] ?? 0) / 2 : 0;
    return new DOMRect(0, layout + translation, 280, 90);
  });
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, writable: true, value: vi.fn(function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const motion: Motion = { element: this, frames, duration: Number(options.duration), cancelled: false, cancel: vi.fn(() => { motion.cancelled = true; }) };
    motions.push(motion);
    return motion as unknown as Animation;
  }) });
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.replaceChildren();
  root = createRoot(host);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

describe("issue movement during an unfinished animation", () => {
  it("keeps at most one movement animation on each card while reordering rapidly", () => {
    render(0);
    for (let move = 1; move <= 12; move++) {
      reversed = !reversed;
      render(move);
      for (const card of host.querySelectorAll<HTMLElement>("[data-flip-id]")) {
        expect(active(card).length).toBeLessThanOrEqual(1);
        for (const motion of active(card)) {
          expect(motion.duration).toBeGreaterThanOrEqual(120);
          expect(motion.duration).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it("continues from the displayed position without treating the previous transform as layout", () => {
    render(0);
    reversed = true;
    render(1);
    reversed = false;
    render(2);
    const card = host.querySelector<HTMLElement>('[data-flip-id="b"]')!;
    expect(motions.filter((motion) => motion.element === card).at(-1)?.frames[0].transform).toBe("translate(0px, -50px)");
  });

  it("cancels unfinished animations when the board unmounts", () => {
    render(0);
    reversed = true;
    render(1);
    flushSync(() => root.render(null));
    expect(motions.length).toBe(2);
    expect(motions.every((motion) => motion.cancelled)).toBe(true);
  });

  it("ends an existing animation when a later movement uses reduced motion", () => {
    render(0);
    reversed = true;
    render(1);
    reduced = true;
    reversed = false;
    render(2);
    expect(motions.length).toBe(2);
    expect(motions.every((motion) => motion.cancelled)).toBe(true);
  });

  it("starts a dropped card from its supplied ghost position", () => {
    render(0);
    seed("b", new DOMRect(0, 50, 280, 90));
    reversed = true;
    render(1);
    const card = host.querySelector<HTMLElement>('[data-flip-id="b"]')!;
    expect(active(card).at(-1)?.frames[0].transform).toBe("translate(0px, 50px)");
  });
});

function Lane({ ids }: { ids: string[] }) {
  const container = useRef<HTMLDivElement>(null);
  useFlip(container, 0);
  return createElement("div", { ref: container }, ids.map((id) => createElement("article", { key: id, "data-flip-id": id }, id)));
}
const renderLane = (ids: string[]) => flushSync(() => root.render(createElement(Lane, { ids })));
const arrivals = () => motions.filter((motion) => motion.frames[0].opacity === 0).map((motion) => motion.element.dataset.flipId);

describe("issue arrival", () => {
  it("fades in a card that joins the board, not the cards already shown", () => {
    renderLane(["a"]);
    expect(arrivals()).toEqual([]);
    renderLane(["a", "b"]);
    expect(arrivals()).toEqual(["b"]);
  });

  it("shows a joining card at once under reduced motion", () => {
    reduced = true;
    renderLane(["a"]);
    renderLane(["a", "b"]);
    expect(arrivals()).toEqual([]);
  });
});
