import { useState } from "react";
import { cloudMutation } from "@/lib/origin-cloud";
import { useAction } from "../origin-pages/ui";
import type { PipelineActivity } from "../../../shared/origin-pipeline";
import { pipelineServer } from "./pipeline-api";

export type DraftEdits = { subject: string; body: string; goal: string };

export function useActivityActions(projectId: string, leadId: string, activity: PipelineActivity, botId: string) {
  const action = useAction();
  const [draft, setDraft] = useState<DraftEdits | null>(null);
  const send = () => action.run(() => pipelineServer.send({ projectId, activityId: activity._id, botId }), "Could not send");
  const approve = () => action.run(async () => {
    const edits = draft ? Object.fromEntries((["subject", "body", "goal"] as const).filter((key) => activity[key] !== undefined && draft[key].trim() && draft[key] !== activity[key]).map((key) => [key, draft[key]])) : {};
    await cloudMutation("pipeline:reviewContact", { projectId, activityId: activity._id, approve: true, ...edits });
    setDraft(null);
    await pipelineServer.send({ projectId, activityId: activity._id, botId });
  }, "Could not send");
  const discard = () => action.run(() => cloudMutation("pipeline:reviewContact", { projectId, activityId: activity._id, approve: false }), "Could not discard");
  const check = () => action.run(() => pipelineServer.refresh({ projectId, leadId, activityId: activity._id, botId }), "Could not check the call");
  const edit = () => setDraft({ subject: activity.subject ?? "", body: activity.body ?? "", goal: activity.goal ?? "" });
  return { action, draft, setDraft, send, approve, discard, check, edit };
}
