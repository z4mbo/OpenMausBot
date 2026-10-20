import { describe, expect, it } from "vitest";
import { cleanReleaseNotes, fallbackReleaseNotes, isReleaseTag, nextReleaseTag, releaseAnnouncement } from "./origin-ship.ts";

const pull = (title: string, labels: string[] = []) => ({ title, labels });

describe("release versions", () => {
  it("bumps patch, minor or major from the merged work and keeps the prefix", () => {
    expect(nextReleaseTag("v1.2.3", [pull("fix: typo"), pull("chore: deps")])).toBe("v1.2.4");
    expect(nextReleaseTag("1.2.3", [pull("feat(ui): dark mode")])).toBe("1.3.0");
    expect(nextReleaseTag("v1.2.3", [pull("Add search", ["enhancement"])])).toBe("v1.3.0");
    expect(nextReleaseTag("v1.2.3", [pull("feat!: new API")])).toBe("v2.0.0");
    expect(nextReleaseTag("v1.2.3", [pull("Drop Node 18", ["breaking-change"])])).toBe("v2.0.0");
    expect(nextReleaseTag(null, [])).toBe("v0.1.0");
    expect(nextReleaseTag("nightly-7", [])).toBe("v0.1.0");
  });

  it("accepts tags GitHub accepts", () => {
    for (const tag of ["v1.0.0", "1.0", "release/2026-10", "v2.0.0-rc.1"]) expect(isReleaseTag(tag), tag).toBe(true);
    for (const tag of ["", "v 1", "-v1", "v1..2", "v1.", "release/", "x".repeat(65)]) expect(isReleaseTag(tag), tag).toBe(false);
  });
});

describe("release text", () => {
  it("lists pull requests plainly without a model, and trims a fenced model answer", () => {
    expect(fallbackReleaseNotes([{ number: 3, title: "fix(api): timeouts", url: "u", mergedAt: 1, labels: [], author: "kai" }])).toBe("## What's changed\n\n- Timeouts (#3) by @kai");
    expect(fallbackReleaseNotes([])).toBe("No pull requests were merged since the last release.");
    expect(cleanReleaseNotes("```md\n## New\n- A\n```")).toBe("## New\n- A");
  });

  it("announces with up to three bullets and the release address", () => {
    const notes = "Intro.\n\n## New\n- Dark mode (#4)\n- Search (#5) by @ada\n* Export (#6)\n- Fourth (#7)";
    expect(releaseAnnouncement("Acme", { tag: "v1.1.0", title: "Night shift", notes }, "https://r.test")).toBe("Acme v1.1.0 is out: Night shift.\n• Dark mode\n• Search\n• Export\nhttps://r.test");
    expect(releaseAnnouncement("Acme", { tag: "v1.1.0", title: "v1.1.0", notes: "" }, undefined)).toBe("Acme v1.1.0 is out.");
  });
});
