import { describe, expect, it, vi } from "vitest";

vi.mock("./origin-cloud", () => ({ cloudMutation: async () => undefined, useCloudQuery: () => undefined }));

const { viewersByProject } = await import("./origin-project-state");

const viewer = (userId: string, projectId: string, self = false) => ({ userId, projectId, name: userId, email: `${userId}@example.com`, avatarUrl: null, updatedAt: 1, ...(self ? { self } : {}) });

describe("viewersByProject", () => {
  it("shows each person once per project, keeping the signed-in person's own entry", () => {
    const map = viewersByProject([viewer("me", "p1"), viewer("ann", "p1"), viewer("ann", "p1"), viewer("me", "p2")], viewer("me", "p1", true));
    expect(map.get("p1")?.map((entry) => [entry.userId, Boolean(entry.self)])).toEqual([["me", true], ["ann", false]]);
    expect(map.get("p2")?.map((entry) => entry.userId)).toEqual(["me"]);
  });
});
