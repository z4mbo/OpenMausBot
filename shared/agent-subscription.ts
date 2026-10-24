/** Which account pays when a computer runs an agent: a Claude, ChatGPT or Grok subscription with its plan as the
 * provider names it ("max", "plus"), or an API key with the provider's display name. It is a label only: no
 * credential, account id or token ever goes into it. */
export interface AgentSubscription {
  provider: "claude" | "chatgpt" | "grok" | "key";
  plan?: string;
}

/** `GET /api/subscriptions`: this computer's accounts, by model instance id. */
export interface AgentSubscriptionsResponse {
  instances: Record<string, AgentSubscription>;
}
