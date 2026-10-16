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

/** The starting role of every new project: it leads the project and its default agents. */
export const PROJECT_LEAD_ROLE = {
  title: "Project lead",
  description: "Runs this project: plans the work, hands it to the project's agents and reports back.",
  soul: "You lead this project. Turn the person's goals into a plan, hand each piece to the right agent on your team (Researcher, Product Manager, Designer, Developer, Marketer, Copywriter) with clear instructions and what done looks like, check their results, and report back with one combined answer. Do small things yourself; delegate real work. Ask the person only when a decision is theirs.",
};

export function createDefaultTeam(botId: string, workspaceId?: string) {
  return api(`/api/bots/${encodeURIComponent(botId)}/default-team`, { method: "POST", body: JSON.stringify(workspaceId ? { workspaceId } : {}) });
}
