import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

export const CAMPAIGN_TOOL_DEFINITIONS = [
  {
    name: "origin_campaign_create",
    description: "Create a launch campaign in an Origin project, or change one with campaign: goal, audience, channels, dates, budget note and status. It ties together the Publish posts, Studio generations and issues of one push." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        campaign: { type: "string", maxLength: 120, description: "Id or name of a campaign to change; omit to create one." },
        name: { type: "string", maxLength: 120, description: "Required for a new campaign." },
        goal: { type: "string", maxLength: 2_000 },
        audience: { type: "string", maxLength: 1_000 },
        channels: { type: "array", maxItems: 6, uniqueItems: true, items: { type: "string", enum: ["x", "bluesky", "linkedin", "facebook", "instagram", "tiktok"] } },
        start_date: { type: "string", maxLength: 10, description: "YYYY-MM-DD; empty clears it." },
        end_date: { type: "string", maxLength: 10, description: "YYYY-MM-DD; empty clears it." },
        budget_note: { type: "string", maxLength: 300 },
        status: { type: "string", enum: ["planning", "running", "done"] },
        project: ORIGIN_PROJECT,
      },
    },
  },
  {
    name: "origin_campaign_get",
    description: "List an Origin project's campaigns, or read one with campaign: its brief, posts with per-channel status, links and likes or reposts, Studio generations and issues." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { campaign: { type: "string", maxLength: 120, description: "Id or name; omit to list them." }, project: ORIGIN_PROJECT },
    },
  },
  {
    name: "origin_campaign_link",
    description: "Attach a Publish post, Studio generation or Origin issue to a campaign, or detach it with remove." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        campaign: { type: "string", minLength: 1, maxLength: 120, description: "Id or name from origin_campaign_get." },
        kind: { type: "string", enum: ["post", "generation", "issue"] },
        item_id: { type: "string", minLength: 1, maxLength: 64, description: "From origin_broadcast_list, origin_studio_list or origin_list_issues." },
        remove: { type: "boolean" },
        project: ORIGIN_PROJECT,
      },
      required: ["campaign", "kind", "item_id"],
    },
  },
];
