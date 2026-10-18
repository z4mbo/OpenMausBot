// @vitest-environment happy-dom
import { createElement, Fragment, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";
import { PhoneAppDialog } from "./PhoneAppDialog";
import { CenteredDialog } from "./CenteredDialog";
import { ConfirmDialog } from "./ConfirmDialog";

let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;
const key = (name: string, shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(event);
  return event;
};
beforeEach(() => {
  host = document.createElement("div");
  opener = document.createElement("button");
  document.body.append(opener, host);
  opener.focus();
  root = createRoot(host);
  document.documentElement.dataset.reducedMotion = "true";
});
afterEach(() => {
  flushSync(() => root.unmount());
  document.body.replaceChildren();
  delete document.documentElement.dataset.reducedMotion;
});

describe("modal family focus ownership", () => {
  for (const [name, Component] of [["About", AboutDialog], ["Phone", PhoneAppDialog]] as const) {
    it(`${name} wraps forward from Close and returns to its per-open opener`, () => {
      flushSync(() => root.render(createElement(Component, { open: false, onClose: vi.fn() })));
      flushSync(() => root.render(createElement(Component, { open: true, onClose: vi.fn() })));
      const dialog = document.querySelector('[role="dialog"]')!;
      const controls = dialog.querySelectorAll<HTMLButtonElement>("button");
      expect(document.activeElement).toBe(controls[controls.length - 1]);
      expect(key("Tab").defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(controls[0]);
      expect(key("Tab", true).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(controls[controls.length - 1]);
      flushSync(() => root.render(createElement(Component, { open: false, onClose: vi.fn() })));
      expect(document.activeElement).toBe(opener);
      const second = document.createElement("button");
      document.body.append(second);
      second.focus();
      flushSync(() => root.render(createElement(Component, { open: true, onClose: vi.fn() })));
      flushSync(() => root.render(createElement(Component, { open: false, onClose: vi.fn() })));
      expect(document.activeElement).toBe(second);
    });
  }

  it("a nested portalled confirmation owns Escape before its centered parent registers", () => {
    const outer = vi.fn(), inner = vi.fn();
    flushSync(() => root.render(createElement(StrictMode, null, createElement(CenteredDialog, {
      label: "Outer", onClose: outer, children: () => createElement(ConfirmDialog, {
        open: true, title: "Delete?", body: "Permanent", confirmLabel: "Delete", onCancel: inner, onConfirm: vi.fn(),
      }),
    }))));
    expect(document.activeElement?.textContent).toBe("Cancel");
    key("Escape");
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("a confirmation respects Escape already handled by a field", () => {
    const cancel = vi.fn();
    flushSync(() => root.render(createElement(ConfirmDialog, {
      open: true, title: "Delete?", body: "Permanent", confirmLabel: "Delete", onCancel: cancel, onConfirm: vi.fn(),
      details: createElement("input", { onKeyDown: (event) => event.preventDefault() }),
    })));
    document.querySelector<HTMLInputElement>("input")!.focus();
    key("Escape");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("a pending confirmation prevents backdrop presses from moving native focus", () => {
    const cancel = vi.fn();
    flushSync(() => root.render(createElement(ConfirmDialog, {
      open: true, pending: true, title: "Remove?", body: "Please wait", confirmLabel: "Removing…", onCancel: cancel, onConfirm: vi.fn(),
    })));
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    dialog.parentElement!.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("a Phone connect handoff keeps the destination's focus", () => {
    let open = true;
    const destination = document.createElement("button");
    document.body.append(destination);
    const select = vi.fn(() => destination.focus());
    const render = () => root.render(createElement(Fragment, null, createElement(PhoneAppDialog, {
      open, onClose: () => { open = false; render(); }, connect: [{ key: "settings", subtitle: "Computer", onSelect: select }],
    })));
    flushSync(render);
    flushSync(() => document.querySelector<HTMLButtonElement>("[data-phone-app-connect]")!.click());
    expect(select).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(destination);
  });
});
