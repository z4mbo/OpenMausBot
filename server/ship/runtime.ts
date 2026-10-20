import { BROADCAST_RULES, type BroadcastChannel } from "../../shared/broadcast.ts";
import type { GitHubService } from "../github/service.ts";
import { integrationConfigured, integrationKey, type IntegrationId } from "../integration-keys.ts";
import { loopbackShipGitHub, projectShipGitHub } from "./github.ts";
import { providerClients, type ShipHttp } from "./providers.ts";
import type { ShipRuntime } from "./service.ts";

export interface ShipRuntimeOptions {
  github?: () => GitHubService;
  summarize?: ShipRuntime["summarize"];
  fetch?: typeof fetch;
  /** OMB_SHIP_PROVIDER_URL: a stand-in for every provider and GitHub, for the isolated fixture only. */
  providerUrl?: string;
}

const TEXT_CHANNELS: readonly BroadcastChannel[] = ["x", "bluesky", "linkedin", "facebook"];

/** Security: the override only ever points at this computer, so a fixture can never send real tokens elsewhere. */
export function loopbackOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function createShipRuntime(options: ShipRuntimeOptions = {}): ShipRuntime {
  const origin = loopbackOrigin(options.providerUrl ?? process.env.OMB_SHIP_PROVIDER_URL);
  const http: ShipHttp = { fetch: options.fetch ?? fetch, ...(origin ? { origin } : {}) };
  return {
    http, providers: providerClients(http),
    github: origin ? loopbackShipGitHub({ ...http, origin }) : options.github ? projectShipGitHub(http, options.github) : null,
    token: (provider) => integrationKey(provider)?.apiToken ?? null,
    ...(options.summarize ? { summarize: options.summarize } : {}),
    channels: () => TEXT_CHANNELS.filter((channel) => integrationConfigured(BROADCAST_RULES[channel].integration as IntegrationId)),
    now: Date.now,
  };
}

let installed: ShipRuntime | null = null;

export function installShipRuntime(runtime: ShipRuntime): void {
  installed = runtime;
}

/** The runtime the Ship routes were created with; the agent tools share it so they reach the same GitHub connection and writer. */
export function shipRuntime(): ShipRuntime {
  installed ??= createShipRuntime();
  return installed;
}
