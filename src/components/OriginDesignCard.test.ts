// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import { groupTranscript } from "@/lib/activity-runs";
import { roomActivityVisible } from "@/lib/room-activity";
import { chiefSectionOf } from "@/lib/origin-chief-section";
import { designViewOf } from "@/lib/origin-design-view";
import { applyCanvasOps } from "../../shared/canvas-ops";
import { encodeNode } from "../../shared/canvas-scene";

const dispatch = vi.fn();
const bots = [
  { id: "kai-chief", threadId: "kai-thread", mainThreadId: "kai-thread", tasks: [] },
  { id: "kai-dev", threadId: "dev-thread", mainThreadId: "dev-thread", tasks: [] },
];
const made = applyCanvasOps(new Map(), [
  { op: "create", node: { type: "frame", key: "home", name: "Home", w: 320, h: 200, children: [{ type: "text", text: "Welcome back" }] } },
  { op: "create", node: { type: "frame", key: "dark", name: "Dark", w: 320, h: 200, fill: "#101014" } },
]);
const home = made.created.find((node) => node.name === "Home")!.id;
const dark = made.created.find((node) => node.name === "Dark")!.id;
const rows = made.changed.map((node) => encodeNode(node.id === home ? { ...node, fill: null } : node));
const queried: unknown[] = [];
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { bots }, dispatch }) }));
vi.mock("@/lib/origin-cloud-links", () => ({ useCloudLinks: () => ({ workspaces: {}, projects: { "kai-chief": "kai" } }) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/origin-cloud", () => ({ useCloudQuery: (name: string, args: unknown) => { queried.push([name, args]); return name === "draw:scene" ? rows : undefined; } }));
const { OriginDesignCard } = await import("./OriginDesignCard");
const { useCanvasFocus } = await import("@/lib/origin-canvas-focus");

const design = (projectId: string): Message => ({
  id: `design-${projectId}`, at: 1, role: "bot", kind: "activity", tool: { name: "origin_design_submit", ok: true },
  originDesign: {
    heading: "ORI-ASK1 design · in review", projectId, teamId: "team1", canvasId: "canvas1", canvasName: "Landing", issueKey: "ORI-ASK1",
    frames: [{ id: home, name: "Home" }, { id: dark, name: "Dark" }, { id: "gone", name: "Old pricing" }],
  },
});

function render(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));
  return { container, unmount: () => { root.unmount(); container.remove(); } };
}

const svgOf = (image: HTMLImageElement) => decodeURIComponent(image.getAttribute("src")!.replace("data:image/svg+xml;charset=utf-8,", ""));

describe("Origin design cards", () => {
  it("draws each frame from the live canvas scene, white behind a frame without a fill, with its name", () => {
    const { container, unmount } = render(createElement(OriginDesignCard, { message: design("kai") }));
    try {
      expect(queried).toContainEqual(["draw:scene", { teamId: "team1", canvasId: "canvas1" }]);
      for (const part of ["ORI-ASK1 design · in review", "ORI-ASK1", "Landing", "Home", "Dark", "Old pricing", "Not on the canvas", "Open in Design"]) expect(container.textContent).toContain(part);
      const homeShot = svgOf(container.querySelector<HTMLImageElement>(`[data-design-frame="${home}"] img`)!);
      expect(homeShot).toContain("Welcome back");
      expect(homeShot).toMatch(/<\/defs><rect width="320" height="200" fill="#FFFFFF"\/>/);
      const darkShot = svgOf(container.querySelector<HTMLImageElement>(`[data-design-frame="${dark}"] img`)!);
      expect(darkShot).toContain("#101014");
      expect(darkShot).not.toContain('fill="#FFFFFF"/>');
      expect(container.querySelector('[data-design-frame="gone"] img')).toBeNull();
    } finally { unmount(); }
  });

  it("opens a linked project's Design page on the first frame, and cannot open an unlinked one", () => {
    dispatch.mockClear();
    let focused: unknown = null;
    function Probe() {
      focused = useCanvasFocus("kai");
      return null;
    }
    const probe = render(createElement(Probe));
    const unlinked = render(createElement(OriginDesignCard, { message: design("yuki") }));
    const linked = render(createElement(OriginDesignCard, { message: design("kai") }));
    try {
      const closed = unlinked.container.querySelector<HTMLElement>("[data-origin-design]")!;
      expect(closed.dataset.openable).toBeUndefined();
      const buttons = [...closed.querySelectorAll("button")];
      expect(buttons.every((button) => button.disabled)).toBe(true);
      expect(buttons[0]!.title).toBe("No project in this app is linked to this Origin project");
      flushSync(() => buttons[1]!.click());
      expect(dispatch).not.toHaveBeenCalled();
      const card = linked.container.querySelector<HTMLElement>("[data-origin-design]")!;
      expect(card.dataset.openable).toBe("true");
      const open = [...card.querySelectorAll("button")].find((button) => button.textContent?.includes("Open in Design"))!;
      flushSync(() => open.click());
      expect(chiefSectionOf("kai-chief")).toBe("design");
      expect(designViewOf("kai-chief")).toBe("design");
      expect(dispatch).toHaveBeenCalledWith({ type: "select", id: "kai-chief" });
      expect(focused).toEqual({ projectId: "kai", canvasId: "canvas1", frameId: home });
    } finally { linked.unmount(); unlinked.unmount(); probe.unmount(); }
  });

  it("stays out of folded tool runs and shows in rooms with tool calls hidden", () => {
    const message = design("kai");
    expect(roomActivityVisible(message, false)).toBe(true);
    const ordinary = { ...message, originDesign: undefined };
    const grouped = groupTranscript([{ ...ordinary, id: "a" }, { ...ordinary, id: "b" }, message]);
    expect(grouped.map((item) => item.kind)).toEqual(["run", "message"]);
  });
});
