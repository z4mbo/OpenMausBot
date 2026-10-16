// @vitest-environment node
import { expect, test } from "vitest";
import { canAnimateTaskExit, selectionBox } from "./workspace-motion";

test("sidebar selection follows layout while an active row is animated over Call", () => {
  const container = { offsetLeft: 12, offsetTop: 60, offsetParent: null } as HTMLElement;
  const list = { offsetLeft: 0, offsetTop: 170, offsetParent: container, parentElement: container, scrollLeft: 0, scrollTop: 18 } as unknown as HTMLElement;
  const active = { offsetLeft: 0, offsetTop: 40, offsetParent: list, parentElement: list, offsetWidth: 220, offsetHeight: 28,
    getBoundingClientRect: () => ({ left: 12, top: 120, width: 220, height: 28 }) } as unknown as HTMLElement;
  expect(selectionBox(active, container)).toEqual({ x: 0, y: 192, width: 220, height: 28 });
});

test("switching away from a board never leaves cloned task circles in the feed", () => {
  const parent = (matches: boolean, visible = true, connected = true) => ({ isConnected: connected, matches: () => matches, getClientRects: () => visible ? [{}] : [] }) as unknown as HTMLElement;
  expect(canAnimateTaskExit(parent(false))).toBe(false); // connected project-shell
  expect(canAnimateTaskExit(parent(true, false))).toBe(false);
  expect(canAnimateTaskExit(parent(true, true, false))).toBe(false);
  expect(canAnimateTaskExit(parent(true))).toBe(true);
});
