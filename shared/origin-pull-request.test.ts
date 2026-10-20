import { describe, expect, it } from "vitest";
import { pullRequestCardTone } from "./origin-pull-request.ts";

describe("pull request card tone", () => {
  it("is ready without a blocker, waiting while checks run, blocked otherwise, and done once closed", () => {
    expect(pullRequestCardTone({ state: "open", checks: "success" })).toBe("ready");
    expect(pullRequestCardTone({ state: "open", checks: "pending", blocker: "checks on #7 are pending; merge once they pass" })).toBe("waiting");
    expect(pullRequestCardTone({ state: "open", checks: "failure", blocker: "checks on #7 are failure; merge once they pass" })).toBe("blocked");
    expect(pullRequestCardTone({ state: "merged", checks: "success" })).toBe("done");
  });
});
