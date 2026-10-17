// server/index.ts runs ROUTES right after the auth gate, so those handlers are already authenticated; PUBLIC_ROUTES run just before it.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { cloudSyncRoutes } from "./cloud-sync.ts";

export const PASS: unique symbol = Symbol("route.pass");

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  path: string;
  method: string;
  auth: RequestAuth;
  json: typeof json;
  readBody: typeof readBody;
}

/** Resolve with PASS to decline; anything else means the request was answered. */
export type RouteHandler = (ctx: RouteContext) => Promise<typeof PASS | void>;

/** Modules with no wiring from index.ts are listed here; index.ts pushes the rest. */
export const ROUTES: RouteHandler[] = [cloudSyncRoutes];

export type PublicRouteContext = Omit<RouteContext, "auth">;

/** Security: runs before the auth gate, so each handler must verify its own credential (a signature, a single-use state). */
export type PublicRouteHandler = (ctx: PublicRouteContext) => Promise<typeof PASS | void>;

export const PUBLIC_ROUTES: PublicRouteHandler[] = [];

/** True means stop routing. A handler that wrote a response but returned PASS still counts as answered. */
export async function dispatchRoutes<C extends PublicRouteContext>(routes: readonly ((ctx: C) => Promise<typeof PASS | void>)[], ctx: C): Promise<boolean> {
  for (const route of routes) {
    const out = await route(ctx);
    if (out !== PASS || ctx.res.headersSent || ctx.res.writableEnded) return true;
  }
  return false;
}
