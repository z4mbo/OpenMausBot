import { describe, expect, it } from "vitest";
import { hasUnseenRelease, latestRelease } from "./origin-releases";

describe("What's new release identity", () => {
  it("marks the current release read by its version", () => {
    expect(hasUnseenRelease(latestRelease.version)).toBe(false);
  });

  it("does not hide a second release published on a previously seen date", () => {
    expect(hasUnseenRelease(latestRelease.date)).toBe(true);
  });

  it("shows updates for new installs and different versions", () => {
    expect(hasUnseenRelease(null)).toBe(true);
    expect(hasUnseenRelease("older-version")).toBe(true);
  });
});
