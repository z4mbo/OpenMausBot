import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginGitHub, type OriginProjectBot } from "./origin-cloud.ts";
import { originTeamChat } from "./origin-members.ts";
import { createOriginTurnContext } from "./origin-project-context.ts";
import { createProjectFolders } from "./origin-project-folders.ts";

const RECONCILE_EVERY_MS = 120_000;
const FIRST_RECONCILE_MS = 5_000;

export interface OriginAgentSupportDeps {
  bots(): readonly OriginProjectBot[];
  github(): OriginGitHub;
  chosenRoot(): string | undefined;
  saveRoot(root: string | null): void;
  cwdOf(botId: string): string | undefined;
  setCwd(botId: string, cwd: string): void;
  /** False where bots do not run on the person's own computer. */
  localFolders: boolean;
}

/** Project folders, the per-turn project context and the team chat the Origin agent tools share. */
export function createOriginAgentSupport(deps: OriginAgentSupportDeps) {
  const cloud = () => readOriginCloud(defaultOriginCloudFile());
  const warn = (error: unknown) => console.warn("origin project folders:", error instanceof Error ? error.message : error);
  const folders = createProjectFolders({
    bots: deps.bots, cloud, connect: convexOriginClient, chosenRoot: deps.chosenRoot, saveRoot: deps.saveRoot,
    cwdOf: deps.cwdOf, setCwd: deps.setCwd, enabled: deps.localFolders,
  });
  const teamChat = originTeamChat();
  const context = createOriginTurnContext({
    bots: deps.bots, state: cloud, connect: convexOriginClient, github: deps.github, teamChat, folder: folders.folderOf,
  });
  const reconcile = () => void folders.reconcile().catch(warn);
  setTimeout(reconcile, FIRST_RECONCILE_MS).unref();
  setInterval(reconcile, RECONCILE_EVERY_MS).unref();
  return {
    routes: folders.routes,
    context,
    teamChat,
    folder: folders.folderOf,
    /** A project link or a project's Origin data changed. */
    changed() {
      context.invalidate();
      reconcile();
    },
  };
}
