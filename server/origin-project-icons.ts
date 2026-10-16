import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { botAvatarUrlSchema } from "../shared/bot-avatar.ts";
import { DATA_DIR } from "./config.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Store } from "./store.ts";

/** A project's favicon, kept beside the bots so upstream's bot record stays unchanged. Absent means the crown. */
const FILE = () => join(DATA_DIR, "origin-project-icons.json");

function readIcons(): Record<string, string> {
  try {
    return existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function createProjectIconRoutes(deps: { store: Store; storedAvatarExists(url: string): boolean }): RouteHandler {
  const { store, storedAvatarExists } = deps;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/origin/project-icons") {
      const icons = readIcons();
      return json(res, 200, { icons: Object.fromEntries(Object.entries(icons).filter(([id]) => store.bot(id))) });
    }
    const match = method === "PUT" ? /^\/api\/bots\/([^/]+)\/project-icon$/.exec(path) : null;
    if (!match) return PASS;
    if (auth.kind === "session" && !auth.scopes.includes("admin")) return json(res, 403, { error: "Changing a project icon needs the admin scope" });
    const id = decodeURIComponent(match[1]);
    if (!store.bot(id)) return json(res, 404, { error: "No such bot" });
    const body = await readBody(req) as { iconUrl?: unknown } | null;
    const icons = readIcons();
    if (body?.iconUrl === null || body?.iconUrl === "") {
      delete icons[id];
    } else {
      const parsed = botAvatarUrlSchema.safeParse(body?.iconUrl);
      if (!parsed.success || !storedAvatarExists(parsed.data)) return json(res, 400, { error: "iconUrl must reference a stored PNG, JPEG, GIF, or WebP image" });
      icons[id] = parsed.data;
    }
    writeFileSync(FILE(), JSON.stringify(icons, null, 2));
    return json(res, 200, { iconUrl: icons[id] ?? null });
  };
}
