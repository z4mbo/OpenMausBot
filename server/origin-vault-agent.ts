import { createHash } from "node:crypto";
import { addHeldSecretScrubber, HELD_SECRET_MASK } from "../shared/redact.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient, type OriginCloudState, type OriginToolResult } from "./origin-cloud.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const VAULT_AGENT_ROUTE = "/api/origin/vault/agent-secrets";
const VALUE_MAX = 16_384;
const VALUE_MIN = 8;
const HELD_FOR_MS = 8 * 60 * 60_000;

type Args = Record<string, unknown>;
type Credential = { _id: string; title: string; kind?: string; username?: string; url?: string; agentUse?: boolean };

/** The project an agent's vault tool reads, resolved by the Origin tools' own project picking. */
export interface VaultToolScope {
  client: OriginCloudClient;
  sessionToken: string;
  projectId: string;
}

const list = (value: unknown): Credential[] => (Array.isArray(value) ? value.filter((row): row is Credential => Boolean(row) && typeof row === "object" && typeof (row as Credential).title === "string") : []);

/**
 * Vault items a member marked as usable by agents, handed over decrypted by that member's own app after they unlocked
 * the vault. Security: values live in this server's memory only, for the sign-in that handed them over, until the
 * member locks the vault, eight hours pass or the server stops,
 * and every value is registered with the redaction scrubber so it is masked in logs, tool titles and transcripts.
 */
export function createVaultAgentSecrets(options: { cloud?: () => OriginCloudState; connect?: (url: string) => OriginCloudClient; now?: () => number } = {}) {
  const cloud = options.cloud ?? (() => readOriginCloud(defaultOriginCloudFile()));
  const connect = options.connect ?? convexOriginClient;
  const now = options.now ?? Date.now;
  /** Project id -> item id -> the value, the sign-in that handed it over and when it lapses. */
  const held = new Map<string, Map<string, { value: string; identity: string; until: number }>>();
  const generations = new Map<string, number>();
  const identity = () => {
    const { url, sessionToken } = cloud();
    return createHash("sha256").update(`${url ?? ""}|${sessionToken ?? ""}`).digest("hex");
  };
  const usable = (projectId: string, credentialId: string) => {
    const entry = held.get(projectId)?.get(credentialId);
    return entry && entry.identity === identity() && entry.until > now() ? entry.value : undefined;
  };
  const close = addHeldSecretScrubber((text) => {
    let out = text;
    for (const values of held.values()) for (const { value } of values.values()) out = out.split(value).join(HELD_SECRET_MASK);
    return out;
  });

  const credentials = async (client: OriginCloudClient, sessionToken: string, projectId: string) =>
    list(await client.query("credentials:list", { projectId, sessionToken }));

  const routes: RouteHandler = async ({ req, res, url, path, method, json, readBody }) => {
    if (path !== VAULT_AGENT_ROUTE) return PASS;
    if (method === "DELETE") {
      const projectId = url.searchParams.get("projectId") ?? "";
      const credentialId = url.searchParams.get("credentialId");
      if (credentialId) held.get(projectId)?.delete(credentialId);
      else held.delete(projectId);
      generations.set(projectId, (generations.get(projectId) ?? 0) + 1);
      return json(res, 200, { ok: true });
    }
    if (method !== "PUT") return PASS;
    const body = await readBody(req).catch(() => null) as Args | null;
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const credentialId = typeof body?.credentialId === "string" ? body.credentialId : "";
    const value = typeof body?.value === "string" ? body.value : "";
    if (!projectId || !credentialId || !value || value.length > VALUE_MAX) return json(res, 400, { error: "projectId, credentialId and value required" });
    if (value.length < VALUE_MIN) return json(res, 400, { error: `Agents can use secrets of ${VALUE_MIN} characters or more, which Origin can keep out of logs` });
    const generation = generations.get(projectId) ?? 0;
    const { url: convexUrl, sessionToken } = cloud();
    if (!convexUrl || !sessionToken) return json(res, 409, { error: "Sign in to Origin on this computer first" });
    const client = connect(convexUrl);
    try {
      const project = await client.query("projects:get", { projectId, sessionToken }) as { memberRole?: string };
      if (project.memberRole === "viewer") return json(res, 403, { error: "Edit role required" });
      const item = (await credentials(client, sessionToken, projectId)).find((row) => row._id === credentialId);
      if (!item?.agentUse) return json(res, 409, { error: "Mark this item as usable by agents first" });
    } catch {
      return json(res, 403, { error: "No access to this project's vault" });
    }
    if ((generations.get(projectId) ?? 0) !== generation) return json(res, 409, { error: "The vault was locked meanwhile" });
    let values = held.get(projectId);
    if (!values) held.set(projectId, values = new Map());
    values.set(credentialId, { value, identity: identity(), until: now() + HELD_FOR_MS });
    return json(res, 200, { ok: true });
  };

  const tools = <C>(scope: (args: Args, ctx: C) => Promise<VaultToolScope>) => ({
    async origin_vault_list(args: Args, ctx: C): Promise<OriginToolResult> {
      const { client, sessionToken, projectId } = await scope(args, ctx);
      const [rows, project] = await Promise.all([credentials(client, sessionToken, projectId), (client.query("projects:get", { projectId, sessionToken }) as Promise<{ memberRole?: string } | null>).catch(() => null)]);
      if (!rows.length) return { text: "This Origin project's vault is empty." };
      const editor = Boolean(project?.memberRole) && project?.memberRole !== "viewer";
      const lines = rows.map((row) => {
        const value = editor && row.agentUse ? usable(projectId, row._id) : undefined;
        const parts = [row.title, row.kind || "secret", row.username && `username ${row.username}`, row.url];
        return `- ${parts.filter(Boolean).join(" · ")}${value !== undefined ? `\n  value: ${value}` : row.agentUse ? " (agents may use it once a member unlocks the vault)" : ""}`;
      });
      return { text: `Vault entries. A value shows only for an item a member marked usable by agents and unlocked on this computer; use it where the work needs it (an environment file, a config field) and never repeat it in chat, an issue or a commit. Other values stay encrypted with the person's passphrase; ask for one with request_credential.\n${lines.join("\n")}` };
    },
  });

  return { routes, tools, close };
}

let shared: ReturnType<typeof createVaultAgentSecrets> | null = null;

export function vaultAgentSecrets() {
  shared ??= createVaultAgentSecrets();
  return shared;
}
