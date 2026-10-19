import { describe, expect, it } from "vitest";
import { sectionsThatFit } from "./section-overflow";

const base = { tabs: [80, 70, 60, 90, 100], more: 70, moreChevron: 20, gap: 2, current: 0 };

describe("sectionsThatFit", () => {
  it("shows every tab when the whole row fits", () => {
    expect(sectionsThatFit({ ...base, available: 408 })).toBe(5);
  });

  it("keeps room for the More trigger once a tab overflows", () => {
    expect(sectionsThatFit({ ...base, available: 407 })).toBe(4);
    expect(sectionsThatFit({ ...base, available: 377 })).toBe(3);
    expect(sectionsThatFit({ ...base, available: 285 })).toBe(2);
  });

  it("sizes the trigger for a hidden current tab, which it labels", () => {
    expect(sectionsThatFit({ ...base, current: 4, available: 336 })).toBe(3);
    expect(sectionsThatFit({ ...base, current: 4, available: 335 })).toBe(2);
  });

  it("puts everything behind More when not even one tab fits beside it", () => {
    expect(sectionsThatFit({ ...base, available: 100 })).toBe(0);
  });
});
