import type { CloudUser } from "../../src/lib/origin-cloud/types";

export * from "../../src/lib/origin-cloud/index";
const person: CloudUser = { _id: "fixture-user", username: "SyntheticAccountNameWithFortyCharactersX", email: "fixture@example.test" };
export const cloudUrl = () => null;
export const useCloudUrl = cloudUrl;
export const useCloudSession = () => ({ ready: true, token: null, user: person, login: async () => {}, logout: async () => {} });
export function useCloudQuery<T = unknown>(name: string, args: Record<string, unknown> | "skip"): T | undefined {
  return args !== "skip" && name === "auth:me" ? person as T : undefined;
}
export const cloudMutation = async () => { throw new Error("Account mutations are disabled in the synthetic header fixture"); };
export const cloudAction = cloudMutation;
export const cloudQueryOnce = cloudMutation;
