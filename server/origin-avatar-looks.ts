import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Store } from "./store.ts";

/** A bot's look beyond its upstream colour: the Zap dot shading and any custom colour. Kept beside the bots. */
export interface AvatarLook { look?: "mascot" | "dot"; color?: string; face?: string }

const FILE = () => join(DATA_DIR, "origin-avatar-looks.json");
const HEX = /^#[0-9a-fA-F]{6}$/;

function readLooks(): Record<string, AvatarLook> {
  try {
    return existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, AvatarLook> : {};
  } catch {
    return {};
  }
}

export function createAvatarLookRoutes(deps: { store: Store }): RouteHandler {
  const { store } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/origin/avatar-looks") {
      return json(res, 200, { looks: Object.fromEntries(Object.entries(readLooks()).filter(([id]) => store.bot(id))) });
    }
    const match = method === "PUT" ? /^\/api\/bots\/([^/]+)\/avatar-look$/.exec(path) : null;
    if (!match) return PASS;
    if (auth.kind === "session" && !auth.scopes.includes("admin")) return json(res, 403, { error: "Changing a bot's look needs the admin scope" });
    const id = decodeURIComponent(match[1]);
    if (!store.bot(id)) return json(res, 404, { error: "No such bot" });
    const body = await readBody(req) as { look?: unknown; color?: unknown; face?: unknown } | null;
    if (body?.look !== undefined && body.look !== "mascot" && body.look !== "dot") return json(res, 400, { error: "look must be mascot or dot" });
    if (body?.color !== undefined && body.color !== null && !(typeof body.color === "string" && HEX.test(body.color))) {
      return json(res, 400, { error: "color must be a #RRGGBB colour or null" });
    }
    if (body?.face !== undefined && body.face !== null && !(typeof body.face === "string" && HEX.test(body.face))) {
      return json(res, 400, { error: "face must be a #RRGGBB colour or null" });
    }
    const looks = readLooks();
    const next: AvatarLook = { ...looks[id] };
    if (body?.look !== undefined) next.look = body.look as AvatarLook["look"];
    if (body?.color === null) delete next.color; else if (typeof body?.color === "string") next.color = body.color.toUpperCase();
    if (body?.face === null) delete next.face; else if (typeof body?.face === "string") next.face = body.face.toUpperCase();
    if (!next.color && !next.face && (next.look ?? "mascot") === "mascot") delete looks[id]; else looks[id] = next;
    writeFileSync(FILE(), JSON.stringify(looks, null, 2));
    return json(res, 200, { look: looks[id] ?? {} });
  };
}
