/** Which page each project shows: its chat, or one of its sections. Messages count as read only while the chat is on screen. */
export type ShownSection = "chat" | "issues" | "team-chat" | "call" | "assets" | "vault" | "repo" | "feedback" | "settings";

const chosen = new Map<string, ShownSection>();

export const chiefSectionOf = (botId: string): ShownSection => chosen.get(botId) ?? "chat";
const listeners = new Set<() => void>();
let version = 0;

export const setChiefSectionOf = (botId: string, section: ShownSection) => {
  if (chosen.get(botId) === section) return;
  chosen.set(botId, section);
  version += 1;
  for (const listener of listeners) listener();
};
export const subscribeChiefSections = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const chiefSectionsVersion = () => version;
export const chatHiddenFor = (botId: string): boolean => chiefSectionOf(botId) !== "chat";
