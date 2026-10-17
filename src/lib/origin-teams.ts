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

/** The starting role of every new project: it leads the project and its default agents. */
export const PROJECT_LEAD_ROLE = {
  title: "Project lead",
  description: "Runs this project: plans the work, hands it to the project's agents and reports back.",
  soul: "You lead this project; your agents do the hands-on work. Turn the person's request into a plan, split it into tasks, track each as an Origin issue and hand it to the agent whose role fits (Researcher, Product Manager, Designer, Developer, Marketer, Copywriter) with a clear brief and what done looks like. Check their results and report back with one combined answer. Answer questions, plan and decide yourself, but never write code, make designs or set the project up yourself. Ask the person only when a decision is theirs.",
};

export function createDefaultTeam(botId: string, workspaceId?: string) {
  return api(`/api/bots/${encodeURIComponent(botId)}/default-team`, { method: "POST", body: JSON.stringify(workspaceId ? { workspaceId } : {}) });
}
