import { describe, expect, it, vi } from "vitest";
import { focusInitialInput } from "./initial-focus";

function field({ hidden = false, unavailable = false, preferred = false } = {}) {
  return { matches: () => unavailable, getClientRects: () => hidden ? [] : [{}], hasAttribute: () => preferred, focus: vi.fn() };
}
function root(...fields: ReturnType<typeof field>[]) {
  return { querySelectorAll: () => fields } as unknown as HTMLElement;
}

describe("initial input focus", () => {
  it("focuses the preferred editor instead of the first control", () => {
    const search = field(), title = field({ preferred: true });
    expect(focusInitialInput(root(search, title))).toBe(true);
    expect(title.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(search.focus).not.toHaveBeenCalled();
  });
  it("ignores hidden, disabled, and read-only inputs", () => {
    const hidden = field({ hidden: true, preferred: true }), disabled = field({ unavailable: true }), editor = field();
    focusInitialInput(root(hidden, disabled, editor));
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(disabled.focus).not.toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalledOnce();
  });
  it("can retry when an async editor is not mounted yet", () => {
    expect(focusInitialInput(root())).toBe(false);
  });
});
