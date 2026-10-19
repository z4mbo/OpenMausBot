// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChipSelect } from "./issue-fields";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

it("leaves Enter to the input method while it composes a search", () => {
  const onChange = vi.fn();
  act(() => root.render(createElement(ChipSelect, { label: "Assignee", value: "", options: [{ value: "a", label: "Ada" }, { value: "b", label: "Bo" }], onChange })));
  act(() => host.querySelector("button")!.click());
  const search = host.querySelector("input")!;
  act(() => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })); });
  expect(onChange).not.toHaveBeenCalled();
  act(() => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(onChange).toHaveBeenCalledWith("a");
});
