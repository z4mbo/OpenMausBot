import type { SendTurnInput } from "./contracts.ts";
import type { PromptPart } from "./system-prompt.ts";

export const HOSTED_CONFINEMENT = "This teammate-hosted turn uses only its canonical shared conversation and the granted project folder. The account owner's private chats, memory, profile, connected apps and shell are unavailable. Approval requests are answered by the account owner on this computer.";

export function hostedPromptParts(parts: () => PromptPart[], hosted: boolean, cwd: string | undefined): PromptPart[] {
  return hosted ? [{ id: "hosted-scope", label: "Shared model execution", text: HOSTED_CONFINEMENT },
    { id: "files", label: "Granted project folder", text: cwd ? `The files for this request are in ${JSON.stringify(cwd)}. Work only within that folder.` : "No project folder is available." }] : parts();
}

export function restrictHostedIntegrations(integrations: NonNullable<SendTurnInput["integrations"]>): void {
  for (const key of Object.keys(integrations) as Array<keyof typeof integrations>) if (key !== "agents") delete integrations[key];
}

export function hostedInternalAllowed(method: string, path: string): boolean {
  return method === "POST" && (path === "/api/internal/options-card" || path === "/api/internal/tool-result")
    || method === "GET" && path === "/api/internal/tool-result";
}
