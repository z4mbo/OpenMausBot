import { describe, expect, it } from "vitest";
import { chiefSectionOf, setChiefSectionOf } from "./origin-chief-section";
import { designViewOf, setDesignViewOf } from "./origin-design-view";
import { setStudioViewOf, studioViewOf } from "./origin-studio-view";

describe("Studio and Design views", () => {
  it("opens Canvas links on the Design page's design files", () => {
    setDesignViewOf("chief-a", "deck");
    setChiefSectionOf("chief-a", "draw");
    expect(chiefSectionOf("chief-a")).toBe("design");
    expect(designViewOf("chief-a")).toBe("design");
  });

  it("keeps each project's mode apart", () => {
    setStudioViewOf("chief-b", "workflows");
    setDesignViewOf("chief-b", "board");
    expect(studioViewOf("chief-b")).toBe("workflows");
    expect(designViewOf("chief-b")).toBe("board");
    expect(studioViewOf("chief-c")).toBe("create");
    expect(designViewOf("chief-c")).toBe("design");
  });
});
