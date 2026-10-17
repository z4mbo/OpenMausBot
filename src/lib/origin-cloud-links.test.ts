import { describe, expect, it } from "vitest";
import { cloudWorkspaceOf } from "./origin-cloud-links";
import { sidebarRowLead } from "./sidebar-row-geometry";

describe("cloudWorkspaceOf", () => {
  const bots = [
    { id: "head", chiefOfStaff: true, section: "Workspace: Acme", managedSections: ["Apollo"] },
    { id: "lead", chiefOfStaff: true, section: "Apollo" },
    { id: "agent", section: "Apollo" },
    { id: "loose", section: "Elsewhere" },
  ];

  it("finds the shared workspace of the head that manages a bot's team", () => {
    expect(cloudWorkspaceOf(bots, { head: "team1" }, "lead")).toBe("team1");
    expect(cloudWorkspaceOf(bots, { head: "team1" }, "agent")).toBe("team1");
  });

  it("has none for a team no linked head manages", () => {
    expect(cloudWorkspaceOf(bots, { head: "team1" }, "loose")).toBeUndefined();
    expect(cloudWorkspaceOf(bots, {}, "lead")).toBeUndefined();
  });
});

describe("sidebarRowLead", () => {
  it("keeps the nav icon column as wide as the bot avatars in every density", () => {
    expect(sidebarRowLead("comfortable", true)).toMatchObject({ size: 32, padding: "pl-6", gap: "gap-2" });
    expect(sidebarRowLead("compact", false).size).toBe(36);
    expect(sidebarRowLead("icons", true).size).toBe(44);
  });
});
