import { z } from "zod";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

const sourceSettings = z.object({
  teamId: z.string().regex(/^[a-z0-9]{1,64}$/), sourceKey: z.string().uuid().optional(),
  instanceId: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(80),
  models: z.array(z.string().trim().min(1).max(200)).max(100).refine(values => new Set(values).size === values.length),
  enabled: z.boolean(), projectIds: z.array(z.string().regex(/^[a-z0-9]{1,64}$/)).max(100).refine(values => new Set(values).size === values.length),
  workspaceHead: z.boolean(), capacity: z.number().int().min(1).max(8),
}).strict().refine(value => !value.enabled || value.models.length > 0 && (value.workspaceHead || value.projectIds.length > 0), "Choose models and at least one project or workspace scope");

export type SourceSettings = z.infer<typeof sourceSettings>;

export function createModelHostRoutes(deps: {
  ready(): boolean;
  reason?: string;
  settings(): Promise<unknown>;
  save(input: SourceSettings): Promise<unknown>;
  revoke(teamId: string): Promise<void>;
  catalog(botId: string): Promise<unknown>;
  visible(auth: RequestAuth, botId: string): boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, url, json, readBody }) => {
    if (!path.startsWith("/api/origin/model-host")) return PASS;
    if (path === "/api/origin/model-host/catalog" && method === "GET") {
      const botId = url.searchParams.get("botId");
      if (!botId || botId.length > 128) return json(res, 400, { error: "Choose a shared agent to list its eligible model accounts" });
      if (!deps.visible(auth, botId)) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { ready: deps.ready(), ...(!deps.ready() && deps.reason ? { reason: deps.reason } : {}), sources: await deps.catalog(botId) });
    }
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Sharing this computer's model accounts requires the owner admin scope" });
    if (path === "/api/origin/model-host" && method === "GET") return json(res, 200, await deps.settings());
    if (path === "/api/origin/model-host/sources" && method === "PUT") {
      const parsed = sourceSettings.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Choose a local model account, label, exact models, workspace/project grants and capacity between 1 and 8" });
      return json(res, 200, { source: await deps.save(parsed.data) });
    }
    if (path === "/api/origin/model-host/revoke" && method === "POST") {
      const parsed = z.object({ teamId: z.string().regex(/^[a-z0-9]{1,64}$/) }).strict().safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Choose the workspace whose computer grant should be revoked" });
      await deps.revoke(parsed.data.teamId);
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
