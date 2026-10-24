import { describe, expect, it } from "vitest";
import { hostedInternalAllowed } from "./hosted-turn-policy.ts";
import { ORIGIN_SERVER_TOOL_NAMES } from "./origin-cloud.ts";
import { requiredScope } from "./request-auth.ts";

describe("Origin feature authority", () => {
  it("keeps all project integration tools behind the hosted internal denial", () => {
    expect(ORIGIN_SERVER_TOOL_NAMES.size).toBeGreaterThanOrEqual(10);
    expect(hostedInternalAllowed("POST", "/api/internal/origin/tool")).toBe(false);
    expect(hostedInternalAllowed("GET", "/api/internal/origin/tool")).toBe(false);
  });

  it.each([
    ["POST", "/api/origin/pipeline/send"], ["POST", "/api/origin/pipeline/refresh"],
    ["GET", "/api/integrations"], ["PUT", "/api/integrations/openai"], ["DELETE", "/api/integrations/openai"],
  ])("requires the computer's admin authority for %s %s", (method, path) => {
    expect(requiredScope(method, path)).toBe("admin");
  });
});
