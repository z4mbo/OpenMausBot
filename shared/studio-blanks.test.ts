import { describe, expect, it } from "vitest";
import { blankValues, fillBlanks, markBlank, setBlank, templateBlanks } from "./studio-blanks.ts";

describe("template blanks", () => {
  const prompt = "Replace [the sofa] with [Chair: a green velvet armchair], matching the light";

  it("reads named and unnamed blanks", () => {
    expect(templateBlanks(prompt).map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "", value: "the sofa" }, { label: "Chair", value: "a green velvet armchair" },
    ]);
  });

  it("fills blanks by position, keeping defaults and dropping empty named ones", () => {
    expect(fillBlanks(prompt)).toBe("Replace the sofa with a green velvet armchair, matching the light");
    expect(fillBlanks(prompt, [undefined, "a rocking chair"])).toBe("Replace the sofa with a rocking chair, matching the light");
    expect(fillBlanks("A [Mood: ] portrait.")).toBe("A portrait.");
  });

  it("sets a blank's value and keeps it a blank, naming an emptied one by its old words", () => {
    const set = setBlank(prompt, 1, "a stool");
    expect(set).toBe("Replace [the sofa] with [Chair: a stool], matching the light");
    const emptied = setBlank(prompt, 0, "");
    expect(templateBlanks(emptied)[0]).toMatchObject({ label: "the sofa", value: "" });
    expect(setBlank(emptied, 0, "the lamp")).toBe("Replace [the sofa: the lamp] with [Chair: a green velvet armchair], matching the light");
  });

  it("finds values by label, words or position, and marks a selection as a blank", () => {
    expect(blankValues(prompt, { chair: "a beanbag", 1: "the rug" })).toEqual(["the rug", "a beanbag"]);
    expect(markBlank("A red sneaker on sand", 2, 13, "Product")).toBe("A [Product: red sneaker] on sand");
  });
});
