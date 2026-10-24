import type { Json } from "./agents-client.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";

/** The issue goes out through coordinate_bots, with every check that route makes, before Origin records who has it. */
async function assignOriginIssue(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { apiResponse } = context.client;
  const origin = (phase?: "record") => apiResponse("/api/internal/origin/tool", {
    method: "POST", body: JSON.stringify({ name: "origin_assign_issue", arguments: args, ...(phase ? { phase } : {}) }),
  });
  const prepared = await origin();
  const handoff = prepared.body.handoff && typeof prepared.body.handoff === "object" ? prepared.body.handoff as Json : null;
  if (!prepared.ok || prepared.body.isError === true || !handoff) {
    return { text: String(prepared.body.text ?? prepared.body.error ?? "origin_assign_issue did not answer."), isError: true };
  }
  const sent = await apiResponse("/api/internal/coordinate-bots", {
    method: "POST",
    body: JSON.stringify({ botIds: [handoff.botId], message: handoff.message, reason: handoff.reason, done_when: handoff.doneWhen, thread: "new" }),
  });
  if (!sent.ok || sent.body.error) return { text: `Not assigned, nothing was sent: ${String(sent.body.error ?? `HTTP ${sent.status}`)}`, isError: true };
  const recorded = await origin("record");
  const noted = recorded.ok && recorded.body.isError !== true
    ? String(recorded.body.text ?? "")
    : `The assignment went out, but Origin did not record it: ${String(recorded.body.text ?? recorded.body.error ?? `HTTP ${recorded.status}`)}`;
  return { text: `Assigned to ${String(handoff.botName)}: ${JSON.stringify(sent.body)} ${noted} End your turn now; the result resumes you.` };
}

const record = (value: unknown): Json | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null);

/** Runs an Origin tool on the server. A result naming a reviewer (the Chief, once an issue's pull request is ready) starts the review in a new thread. */
export async function callOriginTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  if (name === "origin_assign_issue") return assignOriginIssue(args, context);
  const { apiResponse } = context.client;
  const { ok, body } = await apiResponse("/api/internal/origin/tool", { method: "POST", body: JSON.stringify({ name, arguments: args }) });
  const text = String(body.text ?? body.error ?? `${name} did not answer.`);
  if (!ok || body.isError === true) return { text, isError: true };
  const reviewer = record(body.reviewer);
  if (!reviewer) return { text };
  const sent = await apiResponse("/api/internal/coordinate-bots", {
    method: "POST",
    body: JSON.stringify({ botIds: [reviewer.botId], message: reviewer.message, reason: reviewer.reason, thread: "new", reply: "none" }),
  });
  return sent.ok && !sent.body.error
    ? { text }
    : { text: `${text} Asking ${String(reviewer.botName)} to review did not go through (${String(sent.body.error ?? `HTTP ${sent.status}`)}); tell your Chief the pull request is ready.` };
}
