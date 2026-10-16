import { api } from "@/state/store";

export function createDefaultTeam(botId: string) {
  return api(`/api/bots/${encodeURIComponent(botId)}/default-team`, { method: "POST" });
}
