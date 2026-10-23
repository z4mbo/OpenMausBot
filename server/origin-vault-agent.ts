import { createHash } from "node:crypto";
import { addHeldSecretScrubber, HELD_SECRET_MASK } from "../shared/redact.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient, type OriginCloudState, type OriginToolResult } from "./origin-cloud.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { capped } from "../shared/origin-chat-cards.ts";
import { vaultCardItem } from "../shared/origin-chat-card-items.ts";
import { parseServiceEnv, serviceSecretValues, vaultService, type ServiceEnv } from "../shared/vault-services.ts";
import { secretForms } from "./login-store.ts";

export const VAULT_AGENT_ROUTE = "/api/origin/vault/agent-secrets";
/** The held-values key of the signed-in person's own Vault; project keys are Convex ids, which never equal it. */
export const PERSONAL_VAULT = "personal";
const VALUE_MAX = 16_384;
const VALUE_MIN = 8;
const HELD_FOR_MS = 8 * 60 * 60_000;

type Args = Record<string, unknown>;
type Credential = { _id: string; title: string; kind?: string; service?: string; username?: string; url?: string; agentUse?: boolean };
type Held = { value: string; env?: ServiceEnv; masked: string[]; identity: string; until: number };

/** The project an agent's vault tool reads, resolved by the Origin tools' own project picking. */
export interface VaultToolScope {
  client: OriginCloudClient;
  sessionToken: string;
  projectId: string;
  projectName?: string;
}

const list = (value: unknown): Credential[] => (Array.isArray(value) ? value.filter((row): row is Credential => Boolean(row) && typeof row === "object" && typeof (row as Credential).title === "string") : []);

/** The value an agent receives, or why this item cannot be handed over. */
function heldValue(item: Credential, value: string): { env?: ServiceEnv; masked: string[] } | string {
  if (item.kind !== "service") return value.length < VALUE_MIN ? `Agents can use secrets of ${VALUE_MIN} characters or more, which Origin can keep out of logs` : { masked: secretForms(value) };
  const env = parseServiceEnv(item.service ?? "", value);
  if (!env) return "This sign-in's values don't match its service";
  return { env, masked: serviceSecretValues(item.service ?? "", env).flatMap(secretForms) };
}

function itemLine(row: Credential, value: Held | undefined, pending: string): string {
  const service = row.kind === "service" ? vaultService(row.service) : undefined;
  const parts = [row.title, service ? `${service.label} sign-in` : row.kind || "secret", row.username && `username ${row.username}`, row.url];
  const head = `- ${parts.filter(Boolean).join(" · ")}`;
  if (!value) return `${head}${row.agentUse ? pending : ""}`;
  if (value.env) return `${head}\n${Object.entries(value.env).map(([name, text]) => `  env ${name}=${JSON.stringify(text)}`).join("\n")}`;
  return `${head}\n  value: ${value.value}`;
}

/**
 * Vault items a member marked as usable by agents, handed over decrypted by that member's own app after they unlocked
 * the vault: a project's items for that project's agents, and the person's own items for all of their agents.
 * Security: values live in this server's memory only, for the sign-in that handed them over, until the
 * member locks the vault, eight hours pass or the server stops,
 * and every value is registered with the redaction scrubber so it is masked in logs, tool titles and transcripts.
 */
export function createVaultAgentSecrets(options: { cloud?: () => OriginCloudState; connect?: (url: string) => OriginCloudClient; now?: () => number } = {}) {
  const cloud = options.cloud ?? (() => readOriginCloud(defaultOriginCloudFile()));
  const connect = options.connect ?? convexOriginClient;
  const now = options.now ?? Date.now;
  /** Project id or PERSONAL_VAULT -> item id -> the value, the sign-in that handed it over and when it lapses. */
  const held = new Map<string, Map<string, Held>>();
  const generations = new Map<string, number>();
  const identity = () => {
    const { url, sessionToken } = cloud();
    return createHash("sha256").update(`${url ?? ""}|${sessionToken ?? ""}`).digest("hex");
  };
  const usable = (scope: string, credentialId: string) => {
    const entry = held.get(scope)?.get(credentialId);
    return entry && entry.identity === identity() && entry.until > now() ? entry : undefined;
  };
  const close = addHeldSecretScrubber((text) => {
    let out = text;
    for (const values of held.values()) for (const { masked } of values.values()) for (const form of masked) out = out.split(form).join(HELD_SECRET_MASK);
    return out;
  });

  const credentials = async (client: OriginCloudClient, sessionToken: string, scope: string) =>
    list(await client.query(scope === PERSONAL_VAULT ? "personalCredentials:list" : "credentials:list", scope === PERSONAL_VAULT ? { sessionToken } : { projectId: scope, sessionToken }));

  const routes: RouteHandler = async ({ req, res, url, path, method, json, readBody }) => {
    if (path !== VAULT_AGENT_ROUTE) return PASS;
    if (method === "DELETE") {
      const scope = url.searchParams.get("scope") === PERSONAL_VAULT ? PERSONAL_VAULT : url.searchParams.get("projectId") ?? "";
      const credentialId = url.searchParams.get("credentialId");
      if (credentialId) held.get(scope)?.delete(credentialId);
      else held.delete(scope);
      generations.set(scope, (generations.get(scope) ?? 0) + 1);
      return json(res, 200, { ok: true });
    }
    if (method !== "PUT") return PASS;
    const body = await readBody(req).catch(() => null) as Args | null;
    const scope = body?.scope === PERSONAL_VAULT ? PERSONAL_VAULT : typeof body?.projectId === "string" ? body.projectId : "";
    const credentialId = typeof body?.credentialId === "string" ? body.credentialId : "";
    const value = typeof body?.value === "string" ? body.value : "";
    if (!scope || !credentialId || !value || value.length > VALUE_MAX) return json(res, 400, { error: "projectId or scope, credentialId and value required" });
    const generation = generations.get(scope) ?? 0;
    const { url: convexUrl, sessionToken } = cloud();
    if (!convexUrl || !sessionToken) return json(res, 409, { error: "Sign in to Origin on this computer first" });
    const client = connect(convexUrl);
    let item: Credential | undefined;
    try {
      if (scope !== PERSONAL_VAULT) {
        const project = await client.query("projects:get", { projectId: scope, sessionToken }) as { memberRole?: string };
        if (project.memberRole === "viewer") return json(res, 403, { error: "Edit role required" });
      }
      item = (await credentials(client, sessionToken, scope)).find((row) => row._id === credentialId);
    } catch {
      return json(res, 403, { error: "No access to this vault" });
    }
    if (!item?.agentUse) return json(res, 409, { error: "Mark this item as usable by agents first" });
    const prepared = heldValue(item, value);
    if (typeof prepared === "string") return json(res, 400, { error: prepared });
    if ((generations.get(scope) ?? 0) !== generation) return json(res, 409, { error: "The vault was locked meanwhile" });
    let values = held.get(scope);
    if (!values) held.set(scope, values = new Map());
    values.set(credentialId, { value, ...prepared, identity: identity(), until: now() + HELD_FOR_MS });
    return json(res, 200, { ok: true });
  };

  const tools = <C>(scope: (args: Args, ctx: C) => Promise<VaultToolScope>) => ({
    async origin_vault_list(args: Args, ctx: C): Promise<OriginToolResult> {
      const { client, sessionToken, projectId, projectName } = await scope(args, ctx);
      const [rows, own, project] = await Promise.all([
        credentials(client, sessionToken, projectId),
        credentials(client, sessionToken, PERSONAL_VAULT).catch(() => []),
        (client.query("projects:get", { projectId, sessionToken }) as Promise<{ memberRole?: string } | null>).catch(() => null),
      ]);
      const mine = own.filter((row) => row.agentUse);
      if (!rows.length && !mine.length) return { text: "This Origin project's vault is empty." };
      const editor = Boolean(project?.memberRole) && project?.memberRole !== "viewer";
      const lines = rows.map((row) => itemLine(row, editor && row.agentUse ? usable(projectId, row._id) : undefined, " (agents may use it once a member unlocks the vault)"));
      const personal = mine.map((row) => itemLine(row, usable(PERSONAL_VAULT, row._id), " (agents may use it once its owner unlocks their personal vault)"));
      const { items, more } = capped(rows.map(vaultCardItem));
      return {
        text: [
          "Vault entries. A value shows only for an item a member marked usable by agents and unlocked on this computer; use it where the work needs it (an environment file, a config field) and never repeat it in chat, an issue or a commit. A service sign-in lists the environment variables its command line reads: set them on the command that needs them (for example `VERCEL_TOKEN=... vercel deploy`), never in a file you commit. Other values stay encrypted with the person's passphrase; ask for one with request_credential. The person sees the entries' names on a card in chat, never their values.",
          ...(rows.length ? [lines.join("\n")] : []),
          ...(personal.length ? ["From the signed-in person's own vault:", personal.join("\n")] : []),
        ].join("\n"),
        card: { kind: "vault", projectId, ...(projectName ? { projectName } : {}), items, ...(more ? { more } : {}) },
      };
    },
  });

  return { routes, tools, close };
}

let shared: ReturnType<typeof createVaultAgentSecrets> | null = null;

export function vaultAgentSecrets() {
  shared ??= createVaultAgentSecrets();
  return shared;
}
