import { describe, expect, it } from "vitest";
import { folderName, initialRoot, parseProjectsRoot, rootChoices, rootNeedsSaving } from "./origin-projects-root";

const documents = "C:\\Users\\me\\Documents\\Origin";
const desktop = "C:\\Users\\me\\Desktop\\Origin";
const served = {
  root: documents,
  chosen: false,
  suggestions: [{ label: "Documents", path: documents }, { label: "Desktop", path: desktop }],
  folders: {},
};

describe("parseProjectsRoot", () => {
  it("reads the server's answer", () => {
    expect(parseProjectsRoot(served)).toEqual({ root: documents, chosen: false, suggestions: served.suggestions });
  });

  it("also reads the root, defaultRoot and desktopRoot shape", () => {
    expect(parseProjectsRoot({ root: null, defaultRoot: documents, desktopRoot: desktop })).toEqual({
      root: documents, chosen: false, suggestions: [{ label: "Documents", path: documents }, { label: "Desktop", path: desktop }],
    });
    expect(parseProjectsRoot({ root: "D:\\Work", defaultRoot: documents })?.chosen).toBe(true);
  });

  it("rejects an answer with no folder at all", () => {
    expect(parseProjectsRoot(null)).toBeNull();
    expect(parseProjectsRoot({ error: "nope" })).toBeNull();
  });
});

describe("choosing the root", () => {
  const answer = parseProjectsRoot(served)!;

  it("starts on Documents and saves it so Continue just works", () => {
    expect(initialRoot(answer)).toBe(documents);
    expect(rootNeedsSaving(answer, documents)).toBe(true);
    expect(rootNeedsSaving({ ...answer, chosen: true }, documents)).toBe(false);
    expect(rootNeedsSaving(null, null)).toBe(false);
  });

  it("keeps a picked or saved folder among the choices", () => {
    expect(rootChoices(answer, "D:\\Work\\Projects").map((choice) => choice.label)).toEqual(["Documents", "Desktop", "Projects"]);
    expect(rootChoices({ ...answer, root: "E:\\Origin", chosen: true }, null).at(-1)).toEqual({ label: "Origin", path: "E:\\Origin" });
    expect(initialRoot({ ...answer, root: "E:\\Origin", chosen: true })).toBe("E:\\Origin");
  });

  it("names a folder by its last segment", () => {
    expect(folderName("/home/me/Origin/")).toBe("Origin");
  });
});
