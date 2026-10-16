/** An Origin workspace is a team of its own whose Chief is the workspace's head bot; its projects are the teams that head manages. */
export const WORKSPACE_PREFIX = "Workspace: ";

/** The team that holds standalone agents: bots made from scratch or from a template, outside any project. */
export const STANDALONE_SECTION = "Agents";

export function isWorkspaceSection(section: string | undefined): boolean {
  return Boolean(section?.trim().startsWith(WORKSPACE_PREFIX));
}
