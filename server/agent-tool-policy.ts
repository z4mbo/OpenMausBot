/** The reviewed local reads of the built-in agents MCP. Names, prefixes or third-party annotations alone must never grant
 * read access; session recall keeps its own-bot scope. */
export const READ_ONLY_AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_bots",
  "list_team_setup",
  "list_shared_computers",
  "list_rooms",
  "list_threads",
  "assignment_status",
  "session_search",
  "session_read",
  "tool_result_read",
  "list_routines",
  "skills_list",
  "origin_list_projects",
  "origin_list_issues",
  "origin_get_issue",
  "origin_list_assets",
  "origin_vault_list",
  "origin_repo_status",
  "origin_team_chat",
  "origin_feedback",
  "origin_canvas",
  "origin_canvas_screenshot",
  "origin_page_list",
  "origin_pulse",
  "origin_call_notes",
  "origin_broadcast_list",
  "origin_studio_list",
  "origin_studio_workflow_list",
  "origin_studio_presets",
  "origin_pipeline_list_leads",
  "origin_pipeline_conversations",
  "origin_campaign_get",
  "origin_ship_status",
  "origin_brand_get",
  "origin_doc_list",
  "origin_doc_get",
  "origin_milestone_list",
]);

export const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const);

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOL_NAMES.has(name);
}

export function agentToolAnnotations(name: string): typeof READ_ONLY_ANNOTATIONS | undefined {
  return isReadOnlyAgentTool(name) ? READ_ONLY_ANNOTATIONS : undefined;
}
