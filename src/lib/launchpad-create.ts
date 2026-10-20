import { api, type Action, type Bot, type ModelSelection } from "@/state/store";
import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import type { WorkspaceMember } from "@/lib/origin-members";
import { BotCreationDraft } from "./bot-creation-draft";
import { createConfiguredBot } from "./create-configured-bot";
import { PROJECT_LEAD_ROLE, createDefaultTeam } from "./origin-teams";
import { linkCloudRecord } from "./origin-cloud-links";
import { createOriginProject, type ProjectAccess, type RepositoryChoice } from "./origin-project-access";
import { exclusiveWithSync, requestOriginSync } from "./origin-sync";
import { activeWorkspaceId } from "./origin-workspaces";

/** The new project's Chief as the new-project dialog would create it by default: the host's defaults with the project-lead role. */
export async function chiefDraft(name: string): Promise<BotCreationDraft> {
  const result = await api<{ defaults: NewBotDefaults; modelSelection: ModelSelection }>("/api/bot-defaults");
  const defaults = structuredClone(result.defaults);
  const selection = defaults.profile.modelSelection;
  if (!selection || (selection.instanceId === "" && selection.model === "")) defaults.profile.modelSelection = result.modelSelection;
  Object.assign(defaults.profile, PROJECT_LEAD_ROLE, { name });
  return new BotCreationDraft(defaults, () => {});
}

export const needsLocalAutoConsent = (draft: BotCreationDraft) => draft.bot.approvalMode === "auto" && draft.bot.computer === "local" && !draft.consent.acknowledgeLocalAuto;

/** Creates the shared project (and its repository), then its Chief with the default team, linked to it; the same steps as the new-project dialog. */
export async function createLaunchProject(args: {
  draft: BotCreationDraft; teamId: string; headId?: string; access: ProjectAccess; repository: RepositoryChoice;
  members: readonly WorkspaceMember[]; myEmail: string; dispatch(action: Action): void; onProgress(text: string): void;
}): Promise<{ bot: Bot; projectId: string; warnings: string[] }> {
  const name = args.draft.bot.name;
  return exclusiveWithSync(async () => {
    args.onProgress(args.repository.mode === "new" ? "Creating the project and its GitHub repository…" : "Creating the project…");
    const project = await createOriginProject({ teamId: args.teamId, name, access: args.access, members: args.members, myEmail: args.myEmail, repository: args.repository });
    args.onProgress("Setting up its Chief…");
    let created: Awaited<ReturnType<typeof createConfiguredBot>>;
    try { created = await createConfiguredBot(args.draft); }
    catch (cause) {
      requestOriginSync();
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)}. The project exists in Origin and will appear in the sidebar shortly.`);
    }
    args.dispatch({ type: "botAdded", bot: created.bot });
    if (!created.bot.section?.trim()) {
      try { await createDefaultTeam(created.bot.id, args.headId || activeWorkspaceId()); }
      catch (cause) { created.warnings.push(`Chief created without its default team: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    await linkCloudRecord({ projects: { [created.bot.id]: project.projectId } });
    if (project.missed.length) created.warnings.push(`Project created, but access could not be granted to ${project.missed.join(", ")}. Change it in the project's settings.`);
    if (project.repository.state === "error") created.warnings.push(`Project created, but its GitHub repository was not: ${project.repository.error} Retry from the project's Settings.`);
    return { bot: created.bot, projectId: project.projectId, warnings: created.warnings };
  });
}
