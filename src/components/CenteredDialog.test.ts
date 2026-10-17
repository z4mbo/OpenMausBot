// @vitest-environment happy-dom
import { createElement, Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenteredDialog } from "./CenteredDialog";

let root: Root;
let host: HTMLDivElement;
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

const key = (value: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(event);
  return event;
};

describe("CenteredDialog keyboard containment", () => {
  it("keeps Shift+Tab inside when the panel itself has initial focus", () => {
    flushSync(() => root.render(createElement(CenteredDialog, { label: "Example", onClose: vi.fn(), children: () => createElement("button", null, "Last") })));
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    expect(key("Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("button"));
  });

  it("only dismisses the topmost dialog on Escape", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    flushSync(() => root.render(createElement(Fragment, null,
      createElement(CenteredDialog, { label: "Outer", onClose: outer, children: () => createElement("button", null, "Outer action") }),
      createElement(CenteredDialog, {
        label: "Inner", onClose: inner, children: () => createElement("button", null, "Inner action"),
      }))));
    key("Escape");
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("wraps around hidden and negative-tabindex controls", () => {
    flushSync(() => root.render(createElement(CenteredDialog, {
      label: "Files", onClose: vi.fn(), children: () => createElement("div", null,
        createElement("button", { hidden: true }, "Hidden first"),
        createElement("button", { id: "first" }, "Choose file"),
        createElement("input", { type: "file", hidden: true }),
        createElement("button", { id: "last" }, "Save"),
        createElement("button", { tabIndex: -2 }, "Programmatic")),
    })));
    host.querySelector<HTMLButtonElement>("#last")!.focus();
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("#first"));
  });
});
