import { describe, expect, it } from "vitest";
import { isReleaseHistory, releases, releaseStorageKey } from "./releases";

describe("release notifications", () => {
  it("preserves the original 1.0 changelog", () => {
    expect(releases.at(-1)?.version).toBe("1.0");
    expect(isReleaseHistory(releases)).toBe(true);
    expect(isReleaseHistory([{ ...releases[0], version: "1.1" }, ...releases])).toBe(true);
  });
  it("keeps dismissed announcements scoped to each user", () => {
    expect(releaseStorageKey("first")).not.toBe(releaseStorageKey("second"));
  });
  it("rejects empty and malformed responses so offline notes remain available", () => {
    for (const value of [null, [], {}, [{ version: "1.0" }], [{ ...releases[0], changes: [null] }]]) expect(isReleaseHistory(value)).toBe(false);
  });
});
