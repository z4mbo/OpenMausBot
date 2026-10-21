import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginGitHub, type OriginProjectBot } from "./origin-cloud.ts";
import { originTeamChat } from "./origin-members.ts";
import { createOriginTurnContext } from "./origin-project-context.ts";
import { createProjectFolders } from "./origin-project-folders.ts";
import type { ProjectGit } from "./github/project-git.ts";
import { PASS, type PublicRouteHandler } from "./routes/table.ts";

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
  /** Git access to each project's repository from its folder. */
  git?: ProjectGit;
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
  const reconcile = () => void folders.reconcile().then((paths) => deps.localFolders ? deps.git?.prepare(paths) : undefined).catch(warn);
  setTimeout(reconcile, FIRST_RECONCILE_MS).unref();
  setInterval(reconcile, RECONCILE_EVERY_MS).unref();
  return {
    routes: folders.routes,
    publicRoutes: deps.git?.routes ?? ((async () => PASS) satisfies PublicRouteHandler),
    context,
    teamChat,
    folder: folders.folderOf,
    /** A project link or a project's Origin data changed. */
    changed() {
      context.invalidate();
      deps.git?.invalidate();
      reconcile();
    },
  };
}
