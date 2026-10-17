// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CenteredDialog } from "../CenteredDialog";
import { Modal } from "./ui";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  document.documentElement.dataset.reducedMotion = "true";
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
});

it("names a Modal from its visible heading", () => {
  flushSync(() => root.render(createElement(Modal, { title: createElement("span", null, "Edit asset"), onClose: vi.fn(), children: "Content" })));
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Edit asset");
});

it("keeps a busy Modal visible and interactive when dismissal is refused", () => {
  delete document.documentElement.dataset.reducedMotion;
  const close = vi.fn();
  flushSync(() => root.render(createElement(Modal, { title: "Saving asset", onClose: close, canClose: () => false, children: "Content" })));
  flushSync(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector(".origin-sheet-out")).toBeNull();
  expect(host.querySelector(".pointer-events-none")).toBeNull();
  expect(close).not.toHaveBeenCalled();
});

it("only closes a nested confirmation when Escape is pressed", () => {
  const outer = vi.fn();
  const inner = vi.fn();
  flushSync(() => root.render(createElement(Modal, {
    title: "Issue", onClose: outer,
    children: createElement(CenteredDialog, { label: "Confirmation", onClose: inner, children: () => createElement("button", null, "Confirm") }),
  })));
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(inner).toHaveBeenCalledOnce();
  expect(outer).not.toHaveBeenCalled();
});
