import { describe, expect, it } from "vitest";
import { redactSecretsInText } from "../shared/redact.ts";
import { createSharedKeys, type SharedKey } from "./shared-integration-keys.ts";

const key = (integration: string, projectId: string | null, secret: string, updatedAt = 1): SharedKey => ({
  integration, teamId: "team1", projectId, projectName: projectId ? "Launch" : null, sharedByName: "Ada", values: { key: secret }, updatedAt,
});

describe("keys shared with the workspace", () => {
  it("prefers the project's own key, falls back to the newest workspace key, and masks every value", async () => {
    let calls = 0;
    const cache = createSharedKeys({
      cloud: () => ({ url: "http://convex.test", sessionToken: "s".repeat(64), projects: {} }),
      resolve: async () => { calls += 1; return [key("fal", null, "workspace-old-secret", 1), key("fal", null, "workspace-new-secret", 2), key("fal", "p1", "project-secret-value"), { ...key("vercel", null, "team-one-vercel"), teamId: "team1" }, { ...key("vercel", null, "team-two-vercel"), teamId: "team2" }]; },
    });
    try {
      await cache.current();
      expect(cache.find("fal", "p1")?.values.key).toBe("project-secret-value");
      expect(cache.find("fal", "p2")?.values.key).toBe("workspace-new-secret");
      expect(cache.find("fal")?.values.key).toBe("workspace-new-secret");
      expect(cache.find("brevo")).toBeNull();
      expect(cache.find("vercel")).toBeNull();
      expect(redactSecretsInText("curl -H 'Authorization: Key project-secret-value' https://fal.run")).not.toContain("project-secret-value");
      await cache.current();
      expect(calls).toBe(1);
    } finally { cache.close(); }
  });

  it("forgets another account's keys when the sign-in changes or the backend refuses", async () => {
    let session = "a".repeat(64);
    const cache = createSharedKeys({
      cloud: () => ({ url: "http://convex.test", sessionToken: session, projects: {} }),
      resolve: async (_url, token) => { if (token !== "a".repeat(64)) throw new Error("Login required"); return [key("fal", null, "first-account-secret")]; },
    });
    try {
      await cache.current();
      expect(cache.find("fal")).not.toBeNull();
      session = "b".repeat(64);
      await cache.current();
      expect(cache.find("fal")).toBeNull();
      expect(cache.error()).toBe("Login required");
    } finally { cache.close(); }
  });
});
