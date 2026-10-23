import { describe, expect, it } from "vitest";
import { calendarKeyAction } from "./calendar-keys";

const press = (key: string, extra: Partial<KeyboardEvent> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...extra });

describe("Routines page keys", () => {
  it("closes an open dialog with Escape even while its title field has focus", () => {
    expect(calendarKeyAction(press("Escape"), true, true)).toBe("close");
    expect(calendarKeyAction(press("Escape"), false, false)).toBe("close");
  });
  it("leaves letters to text fields, other sections and shortcuts with modifiers", () => {
    expect(calendarKeyAction(press("c"), true, true)).toBeNull();
    expect(calendarKeyAction(press("w"), false, false)).toBeNull();
    expect(calendarKeyAction(press("l", { metaKey: true }), false, true)).toBeNull();
  });
  it("maps the calendar shortcuts", () => {
    expect(["c", "T", "1", "d", "W", "l", "x"].map((key) => calendarKeyAction(press(key), false, true)))
      .toEqual(["create", "today", "day", "day", "week", "list", null]);
  });
});
