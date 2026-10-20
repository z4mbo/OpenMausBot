import { describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "./contracts.ts";
import { HOSTED_CONFINEMENT, hostedInternalAllowed, hostedPromptParts, restrictHostedIntegrations } from "./hosted-turn-policy.ts";

describe("canonical-only hosted context", () => {
  it("does not even evaluate owner profile, memories, conversations or skills", () => {
    const privateParts = vi.fn(() => [{ id: "memory", label: "Private memory", text: "OWNER_PRIVATE_CANARY" }]);
    const parts = hostedPromptParts(privateParts, true, "C:\\granted-project");
    expect(privateParts).not.toHaveBeenCalled();
    expect(JSON.stringify(parts)).not.toContain("OWNER_PRIVATE_CANARY");
    expect(parts[0]?.text).toBe(HOSTED_CONFINEMENT);
    expect(parts[1]?.text).toContain(JSON.stringify("C:\\granted-project"));
    expect(hostedPromptParts(privateParts, false, undefined)).toEqual(privateParts.mock.results[0]?.value);
    expect(privateParts).toHaveBeenCalledTimes(1);
  });

  it("mounts no private integrations and denies memory, threads and administrative tools", () => {
    const integrations = { agents: { env: {} }, browser: {}, composio: {}, custom: {}, hooks: {}, data: {} } as NonNullable<SendTurnInput["integrations"]>;
    restrictHostedIntegrations(integrations);
    expect(Object.keys(integrations)).toEqual(["agents"]);
    for (const path of ["memory", "memory/log", "session-search", "session-read", "threads", "coordinate", "hook", "credential", "browser/mcp", "origin/tool"]) {
      expect(hostedInternalAllowed("POST", `/api/internal/${path}`)).toBe(false);
      expect(hostedInternalAllowed("GET", `/api/internal/${path}`)).toBe(false);
    }
    expect(hostedInternalAllowed("POST", "/api/internal/options-card")).toBe(true);
    expect(hostedInternalAllowed("GET", "/api/internal/tool-result")).toBe(true);
    expect(hostedInternalAllowed("POST", "/api/internal/tool-result")).toBe(true);
    expect(hostedInternalAllowed("DELETE", "/api/internal/tool-result")).toBe(false);
  });
});
