import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { HostedPort } from "./origin-model-host-types.ts";

export function modelHostConnection(origin: string, sessionToken?: string): HostedPort {
  const http = new ConvexHttpClient(origin, { logger: false });
  const authenticated = (args: Record<string, unknown>) => sessionToken ? { ...args, sessionToken } : args;
  const bounded = async <T>(action: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([action, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Origin model hosting is not responding")), 8_000); timer.unref?.();
    })]); } finally { clearTimeout(timer); }
  };
  return {
    query: (name, args) => bounded(http.query(makeFunctionReference<"query">(name), authenticated(args))),
    mutation: (name, args) => bounded(http.mutation(makeFunctionReference<"mutation">(name), authenticated(args))),
  };
}
