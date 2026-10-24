// The Campaigns cloud shim (real Convex functions in memory, over HTTP), with the signed-in person's
// name and avatar so the runs-on badge can draw their initials.
import type { CloudUser } from "../../src/lib/origin-cloud/types";
import { cloudQueryOnce } from "./origin-campaigns-cloud";

export * from "./origin-campaigns-cloud";

const me = await cloudQueryOnce<CloudUser | null>("auth:me").catch(() => null);
export const useCloudSession = () => ({ token: "origin-runs-on-fixture", user: me, ready: true, login: async () => {}, logout: async () => {} });
