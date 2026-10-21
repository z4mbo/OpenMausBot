import type { ProviderSnapshot } from "../contracts.ts";

export function claudeBilling(environment: NodeJS.ProcessEnv, account: ProviderSnapshot["account"]): Pick<ProviderSnapshot, "account" | "billing"> {
  return environment.ANTHROPIC_API_KEY || account?.method === "api-key"
    ? { account: { ...account, method: "api-key" }, billing: "metered" }
    : { billing: "subscription" };
}
