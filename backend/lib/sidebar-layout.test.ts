import { describe, expect, it } from "vitest";
import { parseSidebarLayout, sidebarDragResult } from "./sidebar-layout";

describe("sidebar layout", () => {
  it("resizes within bounds and only collapses past the left threshold", () => {
    expect(sidebarDragResult(244, 50)).toEqual({ width: 294, collapsed: false });
    expect(sidebarDragResult(244, 300)).toEqual({ width: 360, collapsed: false });
    expect(sidebarDragResult(244, -50)).toEqual({ width: 220, collapsed: false });
    expect(sidebarDragResult(244, -80)).toEqual({ width: 220, collapsed: true });
  });
  it("restores valid preferences and rejects malformed stored data", () => {
    expect(parseSidebarLayout('{"width":300,"collapsed":true}')).toEqual({ width: 300, collapsed: true });
    expect(parseSidebarLayout('{"width":900,"collapsed":false}').width).toBe(360);
    for (const raw of [null, "broken", "null", '{"width":"300","collapsed":true}']) expect(parseSidebarLayout(raw)).toEqual({ width: 244, collapsed: false });
  });
});
