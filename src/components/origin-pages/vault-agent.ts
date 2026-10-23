import { api } from "@/state/store";
import { cloudMutation } from "@/lib/origin-cloud";
import type { CloudCredential } from "./cloud-types";
import { decryptSecret } from "./vaultCrypto";
import { vaultFunctions, type VaultScope } from "./vault-scope";

const ROUTE = "/api/origin/vault/agent-secrets";

const target = (scope: VaultScope): Record<string, string> => (scope === "personal" ? { scope: "personal" } : { projectId: scope.projectId });

export async function handOver(scope: VaultScope, item: CloudCredential, passphrase: string): Promise<void> {
  const value = await decryptSecret(item, passphrase);
  await api(ROUTE, { method: "PUT", body: JSON.stringify({ ...target(scope), credentialId: item._id, value }) });
}

/** Gives this computer's agents the items marked usable by agents, decrypted here with the passphrase just entered. */
export async function shareUnlockedWithAgents(scope: VaultScope, items: readonly CloudCredential[], passphrase: string): Promise<number> {
  const usable = items.filter((item) => item.agentUse);
  const results = await Promise.allSettled(usable.map((item) => handOver(scope, item, passphrase)));
  return results.filter((result) => result.status === "fulfilled").length;
}

export async function forgetForAgents(scope: VaultScope, credentialId?: string): Promise<void> {
  const params = new URLSearchParams({ ...target(scope), ...(credentialId ? { credentialId } : {}) });
  await api(`${ROUTE}?${params}`, { method: "DELETE" }).catch(() => undefined);
}

export async function setAgentUse(scope: VaultScope, item: CloudCredential, agentUse: boolean, passphrase: string): Promise<void> {
  const functions = vaultFunctions(scope);
  await cloudMutation(functions.setAgentUse, { ...functions.args, credentialId: item._id, agentUse });
  if (agentUse) await handOver(scope, { ...item, agentUse: true }, passphrase);
  else await forgetForAgents(scope, item._id);
}
