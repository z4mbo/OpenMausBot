import { isWorkspaceSection } from "../../shared/origin-workspaces";
import type { TeamMapSnapshot } from "./team-map";

interface FlowBot {
  id: string;
  name: string;
  section?: string;
  chiefOfStaff?: boolean;
  managedSections?: string[];
  busy?: boolean;
  activity?: string;
  tasks?: Array<{ threadId: string; busy?: boolean; activity?: string; openedBy?: { botId: string } }>;
}

interface FlowRoom {
  id: string;
  dm?: boolean;
  section?: string;
  memberIds: string[];
}

export type FlowLink = "running" | "queued" | "busy" | "idle";

export function flowLink(chief: FlowBot, agent: FlowBot, snapshot: TeamMapSnapshot): FlowLink {
  const between = (link: { sourceBotId: string; targetBotId: string }) => link.sourceBotId === chief.id && link.targetBotId === agent.id;
  const handedOver = agent.tasks?.some((task) => task.openedBy?.botId === chief.id && (task.busy || task.activity === "working" || task.activity === "waiting-on-you"));
  if (handedOver || snapshot.running.some(between)) return "running";
  if (snapshot.queued.some(between)) return "queued";
  return agent.busy ? "busy" : "idle";
}

export function botThreadIds(bot: { threadId: string; mainThreadId?: string; tasks?: Array<{ threadId: string }> }): string[] {
  return [...new Set([bot.threadId, bot.mainThreadId, ...(bot.tasks ?? []).map((task) => task.threadId)].filter((id): id is string => Boolean(id)))];
}

export function roomThreadsSpokenBy(rooms: readonly { threadId: string; busyBotId?: string | null; tasks?: Array<{ threadId: string; busyBotId?: string | null }> }[], botId: string): string[] {
  return rooms.flatMap((room) => [
    ...(room.busyBotId === botId ? [room.threadId] : []),
    ...(room.tasks ?? []).filter((task) => task.busyBotId === botId).map((task) => task.threadId),
  ]);
}

export function workspaceHeadOf<T extends FlowBot>(bots: readonly T[], chief: FlowBot): T | undefined {
  const team = chief.section?.trim();
  if (!team) return undefined;
  return bots.find((bot) => bot.id !== chief.id && bot.chiefOfStaff && isWorkspaceSection(bot.section) && bot.managedSections?.some((name) => name.trim() === team));
}

export function projectRoomOf<T extends FlowRoom>(rooms: readonly T[], chief: FlowBot): T | undefined {
  const team = chief.section?.trim();
  return team ? rooms.find((room) => !room.dm && room.section?.trim() === team) : undefined;
}

export function projectRoster(head: FlowBot | undefined, chief: FlowBot, agents: readonly FlowBot[]): string[] {
  return [...new Set([...(head ? [head.id] : []), chief.id, ...agents.map((agent) => agent.id)])];
}

export function missingMembers(room: FlowRoom, roster: readonly string[]): string[] {
  return roster.filter((id) => !room.memberIds.includes(id));
}

export function projectRoomBulletin(head: FlowBot | undefined, chief: FlowBot, agents: readonly FlowBot[]): string {
  const chain = [
    "the people in this project",
    ...(head ? [`${head.name} (workspace lead)`] : []),
    `${chief.name} (project lead)`,
    ...(agents.length ? [agents.map((agent) => agent.name).join(", ")] : []),
  ].join(" → ");
  return `Team room for ${chief.name}. Chain of command: ${chain}. ${chief.name} answers by default; @mention anyone to bring them in.`;
}
