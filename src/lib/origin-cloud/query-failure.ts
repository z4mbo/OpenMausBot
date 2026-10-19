import { createContext } from "react";

export const OriginQueryFailures = createContext(false);
export const OriginQueryRecovery = createContext<{ attempt: number; label: string; failureCount: number; retry(): void; reportFailure(key: string, failed: boolean): void } | null>(null);

export const isAuthorityQuery = (name: string) => name === "auth:me" || name === "projects:get" || name === "workspaces:access";

export class OriginQueryUnavailable extends Error {
  constructor() { super("The workspace query could not be completed"); this.name = "OriginQueryUnavailable"; }
}
