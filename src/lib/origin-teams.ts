import { api } from "@/state/store";

export const CREATES_FOLDERS_AND_GROUPS = false;
export const SIDEBAR_SHOWS_LOOSE_BOTS = false;
export const SIDEBAR_HAS_SEARCH = false;
export const SIDEBAR_ROW_EXTRAS = false;
export const SIDEBAR_THREAD_TREE = true;
export const SIDEBAR_ACTIONS_IN_FOOTER = true;
export const SHOWS_CHIEF_LABEL = false;
export const HEADER_RENAME = false;
export const NEW_PROJECT_DIALOG = true;
export const INSET_PAGE = true;
export const WORKSPACE_NAV = true;
export const PROFILE_AT_TOP = true;
export const ZAP_LOOKS = true;

/** The starting role of every new project: it runs the project and does the work itself. */
export const PROJECT_LEAD_ROLE = {
  title: "Project lead",
  description: "Runs this project: plans the work, tracks it as issues, does it and reports back.",
  soul: "You run this project. Turn the person's request into a plan and track each piece of work as an Origin issue. When you take an issue, do the work yourself: for code, work on a branch, open a pull request linked to its GitHub issue and ask the person to review and merge it. Report back with what changed and what is left. Ask the person only when a decision is theirs.",
};

export function createDefaultTeam(botId: string, workspaceId?: string) {
  return api(`/api/bots/${encodeURIComponent(botId)}/default-team`, { method: "POST", body: JSON.stringify(workspaceId ? { workspaceId } : {}) });
}
