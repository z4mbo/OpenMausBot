import { expect, it } from "vitest";
import { providerQuotaRefusal } from "../../quota-refusal.ts";
import { acpPromptFailure } from "./error-policy.ts";

const support = { loginNote: "Sign in first" };

it("classifies provider payment refusals without making them quota exhaustion", () => {
  const error = new Error("Internal error: API error (status 402 Payment Required): Your account has no credits left");
  expect(acpPromptFailure(error, support, false)).toMatchObject({ code: "insufficient_funds", needsAuth: true, accountError: "insufficient_funds", retryableStartup: false });
  expect(providerQuotaRefusal(error)).toBeNull();
});

it("preserves explicit quota proof without treating it as payment or authentication", () => {
  const error = Object.assign(new Error("Usage limit reached"), { code: -32000, data: { code: "quota_exceeded" } });
  expect(acpPromptFailure(error, support, false)).toMatchObject({ code: undefined, needsAuth: false, accountError: undefined });
  expect(providerQuotaRefusal(error)).toEqual({ kind: "quota_exhausted", scope: "account" });
});

it("keeps provider account classification and startup restrictions distinct", () => {
  const classified = { ...support, classifyError: () => "quota_or_region_restriction" as const };
  expect(acpPromptFailure(new Error("Account region unavailable"), classified, false)).toMatchObject({ code: "quota_or_region_restriction", needsAuth: false, accountError: "quota_or_region_restriction", retryableStartup: false });
  expect(acpPromptFailure(new Error("permission denied"), support, true)).toMatchObject({ denied: true });
  expect(acpPromptFailure(Object.assign(new Error("connection reset"), { code: -32602 }), support, false)).toMatchObject({ retryableStartup: false });
});
