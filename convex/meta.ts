import { v } from "convex/values";
import { query } from "./_generated/server";

export const capabilities = query({
  args: {},
  returns: v.object({ protocolVersion: v.number(), features: v.array(v.string()) }),
  handler: async () => ({ protocolVersion: 1, features: ["workspace", "teammates", "presence", "approvals", "voice"] }),
});
