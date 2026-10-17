/** Which page each project shows: its chat, or one of its sections. Messages count as read only while the chat is on screen. */
export type ChiefSection = "chat" | "issues" | "agents" | "team-chat" | "call" | "assets" | "vault" | "repo" | "feedback" | "settings";

const chosen = new Map<string, ChiefSection>();

export const chiefSectionOf = (botId: string): ChiefSection => chosen.get(botId) ?? "chat";
export const setChiefSectionOf = (botId: string, section: ChiefSection) => { chosen.set(botId, section); };
export const chatHiddenFor = (botId: string): boolean => chiefSectionOf(botId) !== "chat";
