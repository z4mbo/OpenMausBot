import type { ProviderErrorCode } from "../../contracts.ts";
import { engineFailureKind } from "../engine-errors.ts";
import { classifyError } from "../retry.ts";

/** Failures fixed on the provider account, not by retrying; the reporting process stays pooled. */
export type AccountErrorCode = Extract<ProviderErrorCode,
  "invalid_credentials" | "inactive_subscription" | "insufficient_funds" | "quota_or_region_restriction">;
const ACCOUNT_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set<AccountErrorCode>([
  "invalid_credentials", "inactive_subscription", "insufficient_funds", "quota_or_region_restriction",
]);
const isAccountError = (code: ProviderErrorCode | undefined): code is AccountErrorCode =>
  code !== undefined && ACCOUNT_ERROR_CODES.has(code);

export function acpPromptFailure(error: unknown, support: {
  classifyError?(error: unknown): ProviderErrorCode | undefined;
  loginNote: string;
}, approvalUnconfirmed: boolean) {
  const message = error instanceof Error ? error.message : String(error);
  const code = support.classifyError?.(error) ?? (engineFailureKind(message) === "credits" ? "insufficient_funds" : undefined);
  const needsAuth = code === "invalid_credentials" || code === "inactive_subscription"
    || code === "insufficient_funds" || message === support.loginNote;
  const accountError = isAccountError(code) ? code : undefined;
  const failure = classifyError({ text: message });
  const transientStartup = failure.transient || (failure.reason === "unknown" && code === "upstream_outage");
  const denied = /\b(?:(?:permission|access) denied|(?:approval|permission) (?:required|denied|rejected)|requires? (?:approval|permission)|policy (?:restriction|violation)|(?:blocked|denied|restricted) by (?:the )?policy)\b/i.test(message);
  const retryableStartup = approvalUnconfirmed || (transientStartup && (!code || code === "upstream_outage")
    && ![-32700, -32600, -32601, -32602].includes((error as any)?.code));
  return { message, code, needsAuth, accountError, denied, retryableStartup };
}
