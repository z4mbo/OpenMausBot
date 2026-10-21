import { describe, expect, it } from "vitest";
import { chiefSectionOf, setChiefSectionOf } from "./origin-chief-section";
import { setStudioViewOf, studioViewOf } from "./origin-studio-view";

describe("Studio view", () => {
  it("opens Canvas links in Studio's Design mode", () => {
    setChiefSectionOf("chief-a", "draw");
    expect(chiefSectionOf("chief-a")).toBe("studio");
    expect(studioViewOf("chief-a")).toBe("design");
  });

  it("keeps each project's mode apart", () => {
    setStudioViewOf("chief-b", "workflows");
    expect(studioViewOf("chief-b")).toBe("workflows");
    expect(studioViewOf("chief-c")).toBe("create");
  });
});
