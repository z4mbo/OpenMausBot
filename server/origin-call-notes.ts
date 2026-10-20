import { convexOriginClient, defaultOriginCloudFile, readOriginCloud, type OriginCloudClient, type OriginCloudState } from "./origin-cloud.ts";

export interface CallNotesInput {
  /** The Origin project the call belongs to; a call outside a project keeps no notes. */
  room: string;
  callName: string;
  startedAt: number;
  minutes: number;
  summary: { keyPoints: string[]; decisions: string[]; actionItems: { title: string; owner?: string }[] };
  transcript?: string;
}

const PROJECT_ID = /^[a-z0-9]{1,64}$/;

/** Saves a call's summary and action items in Origin, where the project's Calls page offers them as Draft issues. */
export async function recordCallNotes(
  input: CallNotesInput,
  session: () => OriginCloudState = () => readOriginCloud(defaultOriginCloudFile()),
  connect: (url: string) => OriginCloudClient = convexOriginClient,
): Promise<boolean> {
  const { url, sessionToken } = session();
  if (!url || !sessionToken || !PROJECT_ID.test(input.room)) return false;
  const { keyPoints, decisions, actionItems } = input.summary;
  if (!keyPoints.length && !decisions.length && !actionItems.length) return false;
  await connect(url).mutation("callNotes:record", {
    sessionToken, projectId: input.room, callName: input.callName, startedAt: input.startedAt, minutes: input.minutes,
    keyPoints, decisions, actionItems, ...(input.transcript ? { transcript: input.transcript } : {}),
  });
  return true;
}
