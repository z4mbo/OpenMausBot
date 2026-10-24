import { useEffect, useState } from "react";
import type { AgentSubscription, AgentSubscriptionsResponse } from "../../shared/agent-subscription";
import { t } from "@/lib/i18n";
import { api } from "@/state/store";

const PRODUCT: Record<Exclude<AgentSubscription["provider"], "key">, string> = { claude: "Claude", chatgpt: "ChatGPT", grok: "Grok" };
const LOCAL_TTL_MS = 5 * 60_000;

const titled = (plan: string) => plan === plan.toLowerCase()
  ? plan.split(/[\s_-]+/).filter(Boolean).map((word) => /^\d+x$/.test(word) ? word : word[0]!.toUpperCase() + word.slice(1)).join(" ")
  : plan;

/** "Claude Max", "ChatGPT Plus", "SuperGrok", "OpenRouter key". */
export function subscriptionLabel(subscription: AgentSubscription | null | undefined): string | null {
  if (!subscription) return null;
  const plan = subscription.plan?.trim();
  if (subscription.provider === "key") return plan ? t("runsOn.plan.keyNamed", { name: plan }) : t("runsOn.plan.key");
  const product = PRODUCT[subscription.provider];
  if (!plan) return product;
  const named = titled(plan);
  return named.toLowerCase().includes(product.toLowerCase()) ? named : `${product} ${named}`;
}

let local: { at: number; value: Promise<Record<string, AgentSubscription>> } | null = null;

function localSubscriptions(): Promise<Record<string, AgentSubscription>> {
  if (!local || Date.now() - local.at > LOCAL_TTL_MS) {
    const value = api<AgentSubscriptionsResponse>("/api/origin/shared-agents/subscriptions").then((body) => body.instances ?? {}, () => ({}));
    local = { at: Date.now(), value };
  }
  return local.value;
}

/** The account this computer runs a model instance on, once known. */
export function useLocalSubscription(instanceId: string | undefined, enabled = true): AgentSubscription | null {
  const [subscriptions, setSubscriptions] = useState<Record<string, AgentSubscription> | null>(null);
  useEffect(() => {
    if (!enabled || !instanceId) return;
    let alive = true;
    void localSubscriptions().then((value) => { if (alive) setSubscriptions(value); });
    return () => { alive = false; };
  }, [enabled, instanceId]);
  return instanceId ? subscriptions?.[instanceId] ?? null : null;
}
