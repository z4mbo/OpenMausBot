import { ORIGIN_PROJECT } from "./agents-origin-scope.ts";

type ToolDefinition = { name: string; description: string; inputSchema: { type: string; additionalProperties: boolean; properties: Record<string, unknown>; required?: string[] } };

export const STANDUP_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "origin_standup",
    description: "What happened in an Origin project in the last 24 hours, as its Chief's standup: PRs waiting for a merge, blocked agents (approvals, failed runs), issues done and moved. Without project, every project you reach. With a project admin's sign-in it is also posted to the members' Inbox.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
  {
    name: "origin_pulse",
    description: "How an Origin project is doing, in numbers over the last 7 or 30 days: its stage (Idea, Build, Launch, Grow), issues done and opened, cycle time, PRs waiting, pages live and views, posts published and engagement, leads by stage, conversion, pipeline value, unread replies, agent runs and spend against budget, and what needs a person. Without project, every project you reach.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT, range: { type: "integer", enum: [7, 30], description: "Days to cover. Default 7." } } },
  },
  {
    name: "origin_call_notes",
    description: "The latest call of an Origin project from the last week that still has action items: its key points, decisions and action items with the issues already drafted from them. The person sees it as a card that drafts the rest as issues.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project: ORIGIN_PROJECT } },
  },
];
