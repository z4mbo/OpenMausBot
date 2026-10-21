// Stands in for @/lib/use-origin-workspace in the Launchpad fixture: the open
// workspace is the seeded one, and its people and role come from the
// in-memory backend through the real hooks.
import { useCanCreateProject, useWorkspacePeople } from "../../src/lib/use-origin-workspace";

const config = await (await fetch("/__origin-launchpad.json")).json() as { teamId: string };

export { useCanCreateProject, useWorkspacePeople };
export const useActiveOriginWorkspace = (): { headId?: string; teamId: string | null } => ({ teamId: config.teamId });
