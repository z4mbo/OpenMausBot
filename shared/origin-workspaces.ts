/** An Origin workspace is a team of its own whose Chief is the workspace's head bot; its projects are the teams that head manages. */
export const WORKSPACE_PREFIX = "Workspace: ";

export function isWorkspaceSection(section: string | undefined): boolean {
  return Boolean(section?.trim().startsWith(WORKSPACE_PREFIX));
}
