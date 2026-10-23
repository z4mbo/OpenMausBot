import { cloudMutation } from "@/lib/origin-cloud";
import { api } from "@/state/store";
import type { BroadcastPost, PostCampaign } from "./broadcast-model";

/** A new draft with the post's channels, texts, accounts, media and reel settings, in the same campaigns. Published results are not copied. */
export async function duplicatePost(projectId: string, post: BroadcastPost, campaigns: readonly PostCampaign[]): Promise<string> {
  const postId = await cloudMutation<string>("broadcast:save", {
    projectId, assetIds: post.media.map((item) => item.assetId), format: post.format ?? "post", ...(post.reel ? { reel: post.reel } : {}),
    variants: post.variants.map(({ channel, text, accountId, accountLabel }) => ({ channel, text, ...(accountId ? { accountId, accountLabel } : {}) })),
  });
  for (const campaign of campaigns) await cloudMutation("campaigns:link", { projectId, campaignId: campaign.id, kind: "post", itemId: postId });
  return postId;
}

/** Schedules the post for now and asks this app to publish what is due. */
export async function publishNow(postId: string): Promise<void> {
  await cloudMutation("broadcast:schedule", { postId });
  void api("/api/origin/broadcast/run", { method: "POST" }).catch(() => undefined);
}
