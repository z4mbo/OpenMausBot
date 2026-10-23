import { BRAND_VOICE } from "./agents-brand-tools.ts";
import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

export const BROADCAST_TOOL_DEFINITIONS = [
  {
    name: "origin_broadcast_draft",
    description: "Draft a social post in an Origin project's Publish section, or change one with post_id: text per channel (X 280, Bluesky 300, LinkedIn 3000, Facebook, Instagram 2200 and media required, TikTok 2200 and one video required) and media from the project's Assets or Studio. A person approves it before it can be scheduled; your edit to a post clears its approval." + BRAND_VOICE + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        post_id: { type: "string", maxLength: 64, description: "Omit to draft a new post." },
        channels: { type: "array", maxItems: 6, uniqueItems: true, items: { type: "string", enum: ["x", "bluesky", "linkedin", "facebook", "instagram", "tiktok"] }, description: "Required for a new post." },
        text: { type: "string", maxLength: 64_000, description: "Text for every channel." },
        texts: { type: "object", additionalProperties: { type: "string", maxLength: 64_000 }, description: "Per-channel text that replaces text, keyed by channel." },
        media: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 }, description: "Asset names or ids from origin_list_assets; [] removes all." },
        campaign: { type: "string", maxLength: 120, description: "Id or name of a campaign from origin_campaign_get to attach the post to." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_broadcast_list",
    description: "List an Origin project's Publish posts, or one campaign's: id, status, approval, schedule, channels with their published links or errors, media and text." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["all", "approval", "draft", "scheduled", "publishing", "published", "failed"], description: "Default all; approval lists the posts an agent wrote that wait for a person." },
        campaign: { type: "string", maxLength: 120, description: "Id or name of a campaign: only its posts." },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_broadcast_schedule",
    description: "Schedule an approved Publish post to go out at a time, or now; the person's app publishes it with their channel keys. A post an agent wrote needs a person's approval first." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        post_id: { type: "string", minLength: 1, maxLength: 64 },
        at: { type: "string", maxLength: 40, description: "ISO 8601 time with offset; omit to publish now." },
        project: ORIGIN_PROJECT,
      },
      required: ["post_id"],
    },
  },
  {
    name: "origin_broadcast_unschedule",
    description: "Take a scheduled Publish post off the calendar so it does not go out; it becomes a draft again." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { post_id: { type: "string", minLength: 1, maxLength: 64 }, project: ORIGIN_PROJECT },
      required: ["post_id"],
    },
  },
];
