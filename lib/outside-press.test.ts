// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { swallowPressClick } from "./outside-press";

afterEach(() => { document.body.innerHTML = ""; vi.useRealTimers(); });

test("the click that ends an outside press is swallowed; the next one goes through", () => {
  const button = document.createElement("button");
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  document.body.append(button);
  swallowPressClick();
  button.click();
  expect(clicked).not.toHaveBeenCalled();
  button.click();
  expect(clicked).toHaveBeenCalledOnce();
});

test("a press that never clicks (a scroll) does not eat a later tap", () => {
  vi.useFakeTimers();
  const button = document.createElement("button");
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  document.body.append(button);
  swallowPressClick();
  vi.advanceTimersByTime(1);
  window.dispatchEvent(new Event("pointerdown"));
  vi.advanceTimersByTime(1);
  button.click();
  expect(clicked).toHaveBeenCalledOnce();
});
