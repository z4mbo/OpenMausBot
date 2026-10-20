import { api } from "@/state/store";
import { cloudMutation } from "@/lib/origin-cloud";
import type { CloudCredential } from "./cloud-types";
import { decryptSecret } from "./vaultCrypto";

const ROUTE = "/api/origin/vault/agent-secrets";

async function handOver(projectId: string, item: CloudCredential, passphrase: string): Promise<void> {
  const value = await decryptSecret(item, passphrase);
  await api(ROUTE, { method: "PUT", body: JSON.stringify({ projectId, credentialId: item._id, value }) });
}

/** Gives this computer's agents the items marked usable by agents, decrypted here with the passphrase just entered. */
export async function shareUnlockedWithAgents(projectId: string, items: readonly CloudCredential[], passphrase: string): Promise<number> {
  const usable = items.filter((item) => item.agentUse);
  const results = await Promise.allSettled(usable.map((item) => handOver(projectId, item, passphrase)));
  return results.filter((result) => result.status === "fulfilled").length;
}

export async function forgetForAgents(projectId: string, credentialId?: string): Promise<void> {
  const params = new URLSearchParams({ projectId, ...(credentialId ? { credentialId } : {}) });
  await api(`${ROUTE}?${params}`, { method: "DELETE" }).catch(() => undefined);
}

export async function setAgentUse(projectId: string, item: CloudCredential, agentUse: boolean, passphrase: string): Promise<void> {
  await cloudMutation("credentials:setAgentUse", { projectId, credentialId: item._id, agentUse });
  if (agentUse) await handOver(projectId, { ...item, agentUse: true }, passphrase);
  else await forgetForAgents(projectId, item._id);
}
