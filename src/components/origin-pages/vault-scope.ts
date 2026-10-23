/** A project's shared Vault, or the signed-in person's own. */
export type VaultScope = { projectId: string } | "personal";

export function vaultFunctions(scope: VaultScope) {
  const module = scope === "personal" ? "personalCredentials" : "credentials";
  return {
    list: `${module}:list`, create: `${module}:create`, update: `${module}:update`, remove: `${module}:remove`, setAgentUse: `${module}:setAgentUse`,
    args: scope === "personal" ? {} : { projectId: scope.projectId },
  };
}
