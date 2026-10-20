// Stands in for @/lib/origin-cloud-links in the journey fixture: each
// fixture Chief is linked to its own project in the in-memory backend.
import type { CloudLinks } from "../../src/lib/origin-import";

export * from "../../src/lib/origin-cloud-links";

const config = await (await fetch("/__origin-pulse.json")).json() as { teamId: string; seed: string; sketch: string; forge: string; rocket: string };
const links: CloudLinks = {
  workspaces: { "fixture-head": config.teamId },
  projects: { "fixture-seed": config.seed, "fixture-sketch": config.sketch, "fixture-forge": config.forge, "fixture-rocket": config.rocket },
};

export const useCloudLinks = (): CloudLinks => links;
export const useCloudProjectFor = (bot: { id: string } | undefined): string | undefined => (bot ? links.projects[bot.id] : undefined);
export const useCloudWorkspaceFor = (bot: { id: string } | undefined): string | undefined => (bot ? config.teamId : undefined);
