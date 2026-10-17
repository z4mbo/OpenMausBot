import { describe, expect, it } from "vitest";
import { rankSearchResults } from "./search-ranking";

describe("workspace search ranking", () => {
  const results = [{ label: "Update mobile navigation" }, { label: "Mobile App" }, { label: "Mob" }, { label: "Fix mobile" }];
  it("ranks exact matches before prefixes, word matches and other results", () => {
    expect(rankSearchResults(results, " mob ").map(result => result.label)).toEqual(["Mob", "Mobile App", "Update mobile navigation", "Fix mobile"]);
  });
  it("puts Mobile App first for Mob when there is no exact match", () => {
    expect(rankSearchResults(results.filter(result => result.label !== "Mob"), "Mob")[0].label).toBe("Mobile App");
  });
  it("keeps stable order for ties and does not mutate source data", () => {
    const original = [...results];
    expect(rankSearchResults(results, "")).toEqual(original);
    rankSearchResults(results, "mob");
    expect(results).toEqual(original);
  });
});
