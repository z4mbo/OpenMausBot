import { describe, expect, it } from "vitest";
import { agentToolAnnotations, isReadOnlyAgentTool, READ_ONLY_AGENT_TOOL_NAMES } from "./agent-tool-policy.ts";

describe("built-in agent tool read policy", () => {
  it("includes only the reviewed local reads", () => {
    expect([...READ_ONLY_AGENT_TOOL_NAMES]).toEqual([
      "list_bots",
      "list_team_setup",
      "list_shared_computers",
      "list_rooms",
      "list_threads",
      "read_agent_transcript",
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
      "origin_call_notes",
      "origin_brand_get",
    ]);
    for (const name of READ_ONLY_AGENT_TOOL_NAMES) {
      expect(isReadOnlyAgentTool(name)).toBe(true);
      expect(agentToolAnnotations(name)).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it.each([
    "shared_computer", "ask_bot", "delegate_bot", "check_delegation", "wait_delegation", "start_thread", "close_thread", "post_to_room",
    // These post into the chat: never read-only.
    "attach_file", "show_widget", "update_widget",
    "create_bot", "request_credential", "request_sign_in", "memory_update", "propose_routine",
    "propose_routine_action", "propose_profile", "skill_manage",
    "propose_team_setup", "propose_bot_deletion",
    "origin_create_issue", "origin_update_issue", "origin_delete_issue", "origin_vault_store", "origin_comment_issue", "origin_assign_issue", "origin_complete_issue", "origin_add_asset",
    "list_secrets", "read_credentials", "list_bots_and_delete", "unknown", "",
    "mcp__agents__list_bots", "agents.list_bots", "LIST_BOTS", " list_bots",
  ])("does not infer read access for %s", (name) => {
    expect(isReadOnlyAgentTool(name)).toBe(false);
    expect(agentToolAnnotations(name)).toBeUndefined();
  });
});
