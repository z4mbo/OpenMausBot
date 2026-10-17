import { anyApi } from "convex/server";
import type { api as backendApi } from "@origin/backend/convex/_generated/api";

export const api = anyApi as unknown as typeof backendApi;
