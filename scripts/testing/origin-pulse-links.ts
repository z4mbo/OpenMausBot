// Stands in for @/lib/origin-cloud-links in the Pulse fixture: the Rocket and
// Apollo projects are linked to the fixture's Chiefs, Notes to none.
import type { CloudLinks } from "../../src/lib/origin-import";

export * from "../../src/lib/origin-cloud-links";

const config = await (await fetch("/__origin-pulse.json")).json() as { rocket: string; apollo: string };
const links: CloudLinks = { workspaces: {}, projects: { "fixture-rocket": config.rocket, "fixture-apollo": config.apollo } };

export const useCloudLinks = (): CloudLinks => links;
