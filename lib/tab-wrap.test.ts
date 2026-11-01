// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { tabbables, wrapTab } from "./initial-focus";

afterEach(() => { document.body.innerHTML = ""; });

function mount() {
  document.body.innerHTML = '<button id="outside">Out</button><div id="root"><button id="a">A</button><button id="b" disabled>B</button><span tabindex="-1" id="skip">x</span><input id="c"></div>';
  const root = document.getElementById("root")!;
  for (const element of document.querySelectorAll<HTMLElement>("*")) element.getClientRects = () => [{}] as unknown as DOMRectList;
  return root;
}
const tab = (shiftKey = false) => ({ key: "Tab", shiftKey, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

test("tab stops skip disabled and negative tabindex", () => {
  expect(tabbables(mount()).map(element => element.id)).toEqual(["a", "c"]);
});

test("Tab wraps from the last stop to the first, Shift+Tab from the first to the last", () => {
  const root = mount();
  document.getElementById("c")!.focus();
  expect(wrapTab(tab(), root)).toBe(true);
  expect(document.activeElement?.id).toBe("a");
  expect(wrapTab(tab(true), root)).toBe(true);
  expect(document.activeElement?.id).toBe("c");
});

test("Tab between stops is left to the browser; focus outside is pulled back in", () => {
  const root = mount();
  document.getElementById("a")!.focus();
  expect(wrapTab(tab(), root)).toBe(false);
  document.getElementById("outside")!.focus();
  expect(wrapTab(tab(), root)).toBe(true);
  expect(document.activeElement?.id).toBe("a");
});
