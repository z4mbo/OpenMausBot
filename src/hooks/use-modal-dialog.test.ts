// @vitest-environment happy-dom
import { createElement, StrictMode, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalFocusScope, modalOpen, useModalDialog } from "./use-modal-dialog";

let host: HTMLDivElement, root: Root, opener: HTMLButtonElement;
function Dialog({ open = true, canClose = true, onClose = () => {}, children, fallback }: {
  open?: boolean; canClose?: boolean; onClose?: () => void; children?: ReactNode; fallback?: HTMLElement;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useModalDialog(panel, onClose, { open, canClose: () => canClose, fallbackFocusRef: { current: fallback ?? null } });
  return open ? createElement("div", { ref: panel, role: "dialog", tabIndex: -1 },
    createElement(ModalFocusScope, { panelRef: panel, children })) : null;
}
const key = (name: string, shiftKey = false, prevented = false) => {
  const event = new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true });
  if (prevented) event.preventDefault();
  document.activeElement?.dispatchEvent(event);
  return event;
};
const render = (props: Parameters<typeof Dialog>[0] = {}) => flushSync(() => root.render(createElement(Dialog, props)));
beforeEach(() => {
  host = document.createElement("div"); opener = document.createElement("button");
  document.body.append(opener, host); opener.focus(); root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); document.body.replaceChildren(); });

describe("shared modal focus lifetime", () => {
  it("captures an opener before child autofocus and restores only on real unmount", async () => {
    const focus = vi.spyOn(opener, "focus");
    flushSync(() => root.render(createElement(StrictMode, null, createElement(Dialog, {
      children: createElement("input", { autoFocus: true }),
    }))));
    await Promise.resolve();
    expect(document.activeElement).toBe(host.querySelector("input"));
    expect(focus).not.toHaveBeenCalled();
    flushSync(() => root.render(null));
    expect(focus).toHaveBeenCalledOnce();
  });

  it("activates each controlled opening after an initially closed render", () => {
    render({ open: false });
    render({ open: true });
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    render({ open: false });
    expect(document.activeElement).toBe(opener);
    const next = document.createElement("button"); document.body.append(next); next.focus();
    render({ open: true }); render({ open: false });
    expect(document.activeElement).toBe(next);
  });

  it("keeps zero enabled controls focused on the panel in either Tab direction", () => {
    render({ children: createElement("button", { disabled: true }, "Working") });
    for (const reverse of [false, true]) {
      expect(key("Tab", reverse).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    }
  });

  it("skips hidden, inert, disabled and negative-tabindex controls", () => {
    render({ children: createElement("div", null,
      createElement("div", { hidden: true }, createElement("button", null, "Hidden")),
      createElement("div", { inert: true }, createElement("button", null, "Inert")),
      createElement("div", { style: { display: "none" } }, createElement("button", null, "Display none")),
      createElement("button", { disabled: true }, "Disabled"),
      createElement("button", { tabIndex: -2 }, "Programmatic"),
      createElement("a", { href: "#first", id: "first" }, "First"),
      createElement("button", { id: "last" }, "Last")) });
    const first = host.querySelector<HTMLElement>("#first")!, last = host.querySelector<HTMLElement>("#last")!;
    last.focus(); expect(key("Tab").defaultPrevented).toBe(true); expect(document.activeElement).toBe(first);
    expect(key("Tab", true).defaultPrevented).toBe(true); expect(document.activeElement).toBe(last);
  });

  it("recovers external focus on the next Tab in either direction", () => {
    render({ children: createElement("button", null, "Only") });
    for (const reverse of [false, true]) {
      opener.focus(); key("Tab", reverse);
      expect(document.activeElement).toBe(host.querySelector("button"));
    }
  });

  it("uses current dismissal and lock values without resetting existing focus", () => {
    const first = vi.fn(), second = vi.fn();
    render({ onClose: first, children: createElement("input") });
    const input = host.querySelector<HTMLInputElement>("input")!; input.focus();
    render({ onClose: second, canClose: false, children: createElement("input") });
    expect(document.activeElement).toBe(input); key("Escape"); expect(second).not.toHaveBeenCalled();
    render({ onClose: second, children: createElement("input") }); key("Escape");
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  });

  it("leaves already-handled Escape to the inner control", () => {
    const close = vi.fn(); render({ onClose: close });
    key("Escape", false, true); expect(close).not.toHaveBeenCalled();
  });

  it("uses a viable fallback when the opener is removed or disabled", () => {
    const fallback = document.createElement("section"); fallback.tabIndex = -1; document.body.append(fallback);
    render({ fallback }); opener.disabled = true; render({ open: false, fallback });
    expect(document.activeElement).toBe(fallback);
  });

  it("does not restore into an inert opener", () => {
    const fallback = document.createElement("button"); document.body.append(fallback);
    render({ fallback }); opener.inert = true; render({ open: false, fallback });
    expect(document.activeElement).toBe(fallback);
  });

  it("does not steal focus that a navigation destination already owns", () => {
    const destination = document.createElement("button"); document.body.append(destination);
    render(); destination.focus(); render({ open: false });
    expect(document.activeElement).toBe(destination);
  });

  it("keeps a replacement dialog active when the previous dialog is removed", () => {
    flushSync(() => root.render(createElement(Dialog, { key: "old", children: createElement("input", { autoFocus: true }) })));
    flushSync(() => root.render(createElement(Dialog, { key: "new", children: createElement("button", { autoFocus: true }, "New") })));
    expect(document.activeElement?.textContent).toBe("New");
    key("Tab"); expect(document.activeElement?.textContent).toBe("New");
  });

  it("releases the global listener when the last locked layer unmounts", () => {
    const close = vi.fn(); render({ canClose: false, onClose: close });
    flushSync(() => root.render(null));
    expect(document.activeElement).toBe(opener);
    expect(key("Tab").defaultPrevented).toBe(false);
    key("Escape"); expect(close).not.toHaveBeenCalled();
  });
});

describe("modalOpen", () => {
  it("reports an open dialog so surfaces beneath it leave Escape alone", () => {
    expect(modalOpen(document)).toBe(false);
    render();
    expect(modalOpen(document)).toBe(true);
    render({ open: false });
    expect(modalOpen(document)).toBe(false);
  });
});
