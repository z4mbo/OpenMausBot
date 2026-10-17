import { describe, expect, it } from "vitest";
import { shouldFocusChatComposer, workspaceShortcut } from "./keyboard-navigation";

const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, defaultPrevented: false, repeat: false, ...extra });
const context = { editing: false, overlayOpen: false, canCreate: true };
const chat = { ...context, canWrite: true, controlHasFocus: false };

describe("workspace keyboard shortcuts", () => {
  it("opens creation with C and search with F or slash", () => {
    for (const c of ["c", "C"]) expect(workspaceShortcut(key(c), context)).toBe("create-issue");
    for (const c of ["f", "F", "/"]) expect(workspaceShortcut(key(c), context)).toBe("search");
    expect(workspaceShortcut(key("v"), context)).toBeNull();
  });
  it("does not intercept normal editor input or existing dialogs", () => {
    for (const c of ["c", "f", "/"]) {
      expect(workspaceShortcut(key(c), { ...context, editing: true })).toBeNull();
      expect(workspaceShortcut(key(c), { ...context, overlayOpen: true })).toBeNull();
    }
  });
  it("keeps command search but leaves browser shortcuts alone", () => {
    expect(workspaceShortcut(key("k", { metaKey: true }), { ...context, editing: true })).toBe("search");
    expect(workspaceShortcut(key("k", { ctrlKey: true }), context)).toBe("search");
    expect(workspaceShortcut(key("f", { metaKey: true }), context)).toBeNull();
    expect(workspaceShortcut(key("c", { ctrlKey: true }), context)).toBeNull();
    expect(workspaceShortcut(key("f", { altKey: true }), context)).toBeNull();
  });
  it("ignores compositions, held shortcuts, prevented events and read-only creation", () => {
    for (const extra of [{ isComposing: true }, { repeat: true }, { defaultPrevented: true }]) expect(workspaceShortcut(key("c", extra), context)).toBeNull();
    expect(workspaceShortcut(key("c"), { ...context, canCreate: false })).toBeNull();
  });
});

describe("chat typing focus", () => {
  it("redirects printable keys, including shortcut letters", () => {
    for (const c of ["a", "c", "f", "V", "@", "#", " ", "Dead"]) expect(shouldFocusChatComposer(key(c), chat)).toBe(true);
  });
  it("does not steal focus from another editor or overlay", () => {
    expect(shouldFocusChatComposer(key("a"), { ...chat, editing: true })).toBe(false);
    expect(shouldFocusChatComposer(key("a"), { ...chat, overlayOpen: true })).toBe(false);
    expect(shouldFocusChatComposer(key("a"), { ...chat, canWrite: false })).toBe(false);
  });
  it("preserves keyboard activation, navigation, IME and modifier shortcuts", () => {
    for (const c of ["Enter", "Tab", "ArrowDown", "Escape", "Backspace"]) expect(shouldFocusChatComposer(key(c), chat)).toBe(false);
    expect(shouldFocusChatComposer(key(" "), { ...chat, controlHasFocus: true })).toBe(false);
    for (const extra of [{ isComposing: true }, { defaultPrevented: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) expect(shouldFocusChatComposer(key("c", extra), chat)).toBe(false);
  });
});
