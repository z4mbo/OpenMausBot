import type { IncomingMessage } from "node:http";
import { isShipAction } from "../../shared/origin-ship.ts";
import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient } from "../origin-cloud.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { ShipError } from "./providers.ts";
import { createShipRuntime, installShipRuntime, type ShipRuntimeOptions } from "./runtime.ts";
import { draftRelease, findTarget, publishRelease, shipAct, shipOverview, shipPreviews, shipStatus, type ShipRuntime, type ShipScope } from "./service.ts";

type Args = Record<string, unknown>;

const PROJECT_ID = /^[a-z0-9]{1,64}$/;
const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function bot(value: unknown): { botId: string; name: string } | undefined {
  const raw = record(value);
  const botId = text(raw.botId).trim(), name = text(raw.name).trim();
  return botId && name ? { botId: botId.slice(0, 80), name: name.slice(0, 80) } : undefined;
}

function sessionOf(req: IncomingMessage): string {
  const header = req.headers["x-origin-session"];
  return (Array.isArray(header) ? header[0] : header)?.trim() ?? "";
}

export function createShipRoutes(options: ShipRuntimeOptions & { runtime?: ShipRuntime; connect?: (url: string) => OriginCloudClient; cloudUrl?: () => string | undefined } = {}): RouteHandler {
  const runtime = options.runtime ?? createShipRuntime(options);
  installShipRuntime(runtime);
  const connect = options.connect ?? convexOriginClient;
  const cloudUrl = options.cloudUrl ?? (() => readOriginCloud(defaultOriginCloudFile()).url);
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/origin/ship/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Ship uses this app's own provider keys and needs the admin scope" });
    const sessionToken = sessionOf(req);
    const address = cloudUrl();
    if (!sessionToken || !address) return json(res, 401, { error: "Sign in to Origin first" });
    const body = method === "POST" ? record(await readBody(req)) : {};
    const projectId = text(body.projectId) || url.searchParams.get("projectId") || "";
    if (!PROJECT_ID.test(projectId)) return json(res, 400, { error: "projectId is required" });
    const scope: ShipScope = { client: connect(address), sessionToken, projectId };
    try {
      if (path === "/api/origin/ship/status" && method === "GET") return json(res, 200, await shipStatus(runtime, scope, undefined, url.searchParams.get("fresh") === "1"));
      if (path === "/api/origin/ship/act" && method === "POST") {
        if (!isShipAction(body.action)) return json(res, 400, { error: "action must be deploy, redeploy, promote or rollback" });
        const overview = await shipOverview(scope);
        const target = findTarget(overview, text(body.targetId));
        if (!target) return json(res, 404, { error: "Deploy target not found" });
        return json(res, 200, { message: await shipAct(runtime, scope, overview, target, body.action, text(body.deploymentId) || undefined) });
      }
      if (path === "/api/origin/ship/previews" && method === "POST") {
        const pulls = (Array.isArray(body.pulls) ? body.pulls : []).slice(0, 40).map(record)
          .map((pull) => ({ number: Number(pull.number), branch: text(pull.branch).slice(0, 200) }))
          .filter((pull) => Number.isSafeInteger(pull.number) && pull.number > 0 && pull.branch);
        return json(res, 200, { previews: pulls.length ? await shipPreviews(runtime, scope, pulls) : {} });
      }
      if (path === "/api/origin/ship/release/draft" && method === "POST") {
        const writer = bot(body.writer);
        const draft = await draftRelease(runtime, scope, { projectName: text(body.projectName).slice(0, 120) || "This project", ...(writer ? { writer } : {}), ...(typeof body.announce === "boolean" ? { announce: body.announce } : {}) });
        return json(res, 200, { releaseId: draft.releaseId, tag: draft.tag, pulls: draft.pulls.length, written: draft.written });
      }
      if (path === "/api/origin/ship/release/publish" && method === "POST") {
        const releaseId = text(body.releaseId);
        if (!releaseId) return json(res, 400, { error: "releaseId is required" });
        const announcer = bot(body.announcer);
        return json(res, 200, await publishRelease(runtime, scope, releaseId, announcer));
      }
      return PASS;
    } catch (error) {
      const status = error instanceof ShipError ? error.status : /Login required/.test(String(error)) ? 401
        : /Admin role required|Edit role required|No active project access/.test(String(error)) ? 403 : 502;
      const message = (error instanceof Error ? error.message : String(error)).replaceAll(sessionToken, "[redacted]");
      return json(res, status, { error: (/Uncaught Error: ([^\n]+)/.exec(message)?.[1] ?? message).slice(0, 400) });
    }
  };
}
