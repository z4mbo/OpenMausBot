// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { chiefSectionOf } from "@/lib/origin-chief-section";

const dispatch = vi.fn();
const bots = [{ id: "kai-chief", threadId: "kai-thread", mainThreadId: "kai-thread", tasks: [] }];
let live: unknown[] | undefined;
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots }, dispatch }) }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => ({ workspaces: {}, projects: { "kai-chief": "kai" } }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: (_name: string, args: unknown) => (args === "skip" ? undefined : live) }));
const { OriginStudioCard } = await import("./OriginStudioCard");
const { useStudioFocus } = await import("@/lib/studio-focus");

const message = (projectId: string): Message => ({
  id: "studio", at: 1, role: "bot", kind: "activity", tool: { name: "origin_studio_generate", ok: true },
  originStudio: {
    heading: "Started 2 generations in Kai's Studio",
    projectId,
    generations: [
      { id: "gen-1", status: "running", modelLabel: "Nano Banana Pro", kind: "image", prompt: "Hero shot of the app", outputs: [] },
      { id: "gen-2", status: "queued", modelLabel: "Kling 3 Pro · motion transfer", kind: "video", prompt: "Dance", outputs: [] },
    ],
    presets: ["motion-transfer", "virtual-try-on", "no-such-preset"],
  },
});

function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));
  return { container, rerender: (next: ReturnType<typeof createElement>) => flushSync(() => root.render(next)), unmount: () => { root.unmount(); container.remove(); } };
}

describe("Origin Studio chat cards", () => {
  it("shows each generation's progress, then its result as the project's Studio updates", () => {
    live = undefined;
    const { container, rerender, unmount } = render(createElement(OriginStudioCard, { message: message("kai") }));
    try {
      expect(container.textContent).toContain("Started 2 generations in Kai's Studio");
      expect(container.querySelector('[data-origin-studio-generation="gen-1"]')?.getAttribute("data-status")).toBe("running");
      expect(container.querySelector('[data-origin-studio-generation="gen-2"]')?.textContent).toContain("Queued");
      live = [{ _id: "gen-1", status: "done", outputs: [{ url: "https://fal.media/hero.png", kind: "image" }] }];
      rerender(createElement(OriginStudioCard, { message: message("kai") }));
      const done = container.querySelector('[data-origin-studio-generation="gen-1"]')!;
      expect(done.getAttribute("data-status")).toBe("done");
      expect(done.querySelector("img")?.getAttribute("src")).toBe("https://fal.media/hero.png");
    } finally { unmount(); }
  });

  it("shows known presets as picture cards that open the project's Studio with the preset set up", () => {
    live = undefined;
    dispatch.mockClear();
    let focused: unknown = null;
    function Probe() {
      focused = useStudioFocus("kai");
      return null;
    }
    const { container, unmount } = render(createElement("div", null, createElement(OriginStudioCard, { message: message("kai") }), createElement(Probe)));
    try {
      expect(container.querySelectorAll("[data-preset-card]")).toHaveLength(2);
      flushSync(() => (container.querySelector('[data-preset-card="motion-transfer"]') as HTMLButtonElement).click());
      expect(focused).toEqual({ projectId: "kai", presetId: "motion-transfer" });
      expect(chiefSectionOf("kai-chief")).toBe("studio");
      expect(dispatch).toHaveBeenCalled();
    } finally { unmount(); }
  });

  it("says when no project in this app shows the card's project", () => {
    live = undefined;
    const { container, unmount } = render(createElement(OriginStudioCard, { message: message("elsewhere") }));
    try {
      expect(container.textContent).toContain("Open this project in Origin to use them in Studio.");
    } finally { unmount(); }
  });
});
