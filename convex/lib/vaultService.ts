import { vaultService } from "../../lib/vault-services";

export function serviceOf(kind: string, service: string | undefined): string | undefined {
  if (kind !== "service") return undefined;
  if (!vaultService(service)) throw new Error("Choose the service this sign-in is for");
  return service;
}
