import { MILESTONE_LIMITS } from "../../shared/origin-milestones.ts";
import { ORIGIN_PROJECT, ORIGIN_SCOPE } from "./agents-origin-scope.ts";

const ISSUES = { type: "array", maxItems: MILESTONE_LIMITS.assignAtOnce, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64 } };

export const LAUNCHPAD_TOOL_DEFINITIONS = [
  {
    name: "origin_milestone_list",
    description: "List an Origin project's milestones with target day, progress and issues." + ORIGIN_SCOPE,
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_milestone_set",
    description: "Create, change or delete an Origin project milestone such as MVP or Launch; issues puts issues in it, remove_issues takes them out." + ORIGIN_SCOPE,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        milestone: { type: "string", maxLength: MILESTONE_LIMITS.title, description: "Id or name of the milestone; a name not found creates it." },
        name: { type: "string", maxLength: MILESTONE_LIMITS.title, description: "Renames an existing milestone." },
        target_date: { type: "string", maxLength: 10, description: "YYYY-MM-DD; empty clears it." },
        description: { type: "string", maxLength: MILESTONE_LIMITS.description },
        status: { type: "string", enum: ["planned", "active", "completed"] },
        issues: { ...ISSUES, description: "Issue ids or ORI keys from origin_list_issues to put in this milestone." },
        remove_issues: { ...ISSUES, description: "Issue ids or ORI keys to take out of it." },
        delete: { type: "boolean", description: "Delete the milestone; its issues stay." },
        project: ORIGIN_PROJECT,
      },
      required: ["milestone"],
    },
  },
];
