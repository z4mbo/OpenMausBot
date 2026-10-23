/** One message of a project's team chat, as the Origin tools read it. */
export interface OriginChatLine { id: string; authorName: string; body: string; createdAt: number }

/** The project team chat ("project:<id>" in the app's realtime store) and the workspace channel everyone reads; never direct messages. */
export interface OriginTeamChat {
  recent(teamId: string, projectId: string, limit: number): Promise<OriginChatLine[]>;
  workspace?(teamId: string, limit: number): Promise<OriginChatLine[]>;
  /** Posts as the agent itself, never as the person. */
  post(teamId: string, projectId: string, agent: { id: string; name: string }, body: string): Promise<OriginChatLine>;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

export function chatLine(line: OriginChatLine): string {
  return `- ${new Date(line.createdAt).toISOString().slice(0, 16).replace("T", " ")} ${line.authorName}: ${clip(line.body.replace(/\s+/g, " "), 600)}`;
}
