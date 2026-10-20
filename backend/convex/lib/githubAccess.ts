import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/** Security: after a role change or removal, the push access Origin gave the person's linked GitHub is brought in line. */
export async function reviewGitHubAccess(ctx: MutationCtx, teamId: Id<"teams"> | undefined, email: string): Promise<void> {
  if (teamId) await ctx.scheduler.runAfter(0, internal.githubLinks.reviewAccess, { teamId, email });
}
