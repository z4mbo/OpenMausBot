import { describe, expect, it } from "vitest";
import { linkAssetName, linkAssetType } from "./asset-links";

describe("linkAssetName", () => {
  it("is empty until the link parses", () => {
    expect(linkAssetName("")).toBe("");
    expect(linkAssetName("h")).toBe("");
    expect(linkAssetName("https:")).toBe("");
    expect(linkAssetName("docs.example.com")).toBe("");
  });
  it("follows the link as it is typed", () => {
    const link = "https://docs.example.com/spec";
    let name = "";
    for (let end = 1; end <= link.length; end++) name = linkAssetName(link.slice(0, end)) || name;
    expect(name).toBe("docs.example.com");
  });
  it("names Figma files after the file and other files after the file name", () => {
    expect(linkAssetName("https://www.figma.com/design/AbC123/Design-System?node-id=1-2")).toBe("Design System");
    expect(linkAssetName("https://www.figma.com/file/abc/Marketing%20Site")).toBe("Marketing Site");
    expect(linkAssetName("https://www.figma.com/files/team")).toBe("figma.com");
    expect(linkAssetName("https://cdn.example.com/brand/logo.svg")).toBe("logo.svg");
    expect(linkAssetName("https://www.example.com/about")).toBe("example.com");
  });
});

describe("linkAssetType", () => {
  it("detects the kind of link", () => {
    expect(linkAssetType("https://www.figma.com/design/AbC123/Design-System")).toBe("figma");
    expect(linkAssetType("https://docs.google.com/document/d/1/edit")).toBe("document");
    expect(linkAssetType("https://acme.notion.site/Spec-123")).toBe("document");
    expect(linkAssetType("https://docs.example.com/spec")).toBe("document");
    expect(linkAssetType("https://example.com/files/report.pdf")).toBe("document");
    expect(linkAssetType("https://cdn.example.com/hero.PNG")).toBe("image");
    expect(linkAssetType("https://fonts.google.com/specimen/Inter")).toBe("font");
    expect(linkAssetType("https://example.com/app-release.apk")).toBe("apk");
    expect(linkAssetType("https://github.com/acme/web")).toBe("other");
    expect(linkAssetType("https://fig")).toBe("other");
    expect(linkAssetType("not a link")).toBe("other");
  });
});
