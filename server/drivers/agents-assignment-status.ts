import { peerName } from "../peer-roster.ts";
import type { Json } from "./agents-client.ts";

const STATUS_WORDS: Record<string, string> = {
  queued: "queued, not started yet",
  running: "running",
  needs_input: "waiting on the person",
  waiting: "waiting on its own hand-offs",
  resume: "wrapping up (its hand-offs settled)",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};
const RESULT_HEAD = 2_000;
const jsonRecord = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);

export function assignmentLine(a: Json): string {
  const id = typeof a.id === "string" && a.id ? a.id : "?";
  const who = typeof a.botName === "string" && a.botName ? `@${peerName(a.botName)}`
    : typeof a.botId === "string" && a.botId ? a.botId : "a teammate";
  const status = String(a.status ?? "unknown");
  const outcome = typeof a.outcome === "string" && a.outcome && a.outcome !== "done" && a.outcome !== status ? ` (${a.outcome})` : "";
  const detail = typeof a.outcomeDetail === "string" && a.outcomeDetail.trim() ? `: ${a.outcomeDetail.trim()}` : "";
  return `${id} → ${who}: ${STATUS_WORDS[status] ?? status}${outcome}${detail}`;
}

export function renderAssignmentStatus(r: Json, id: string): string {
  const raw = jsonRecord(r.assignment) ? r.assignment : r;
  const a: Json = { id, ...raw, botName: raw.botName ?? r.toBotName };
  const lines = [`Assignment ${assignmentLine(a)}`];
  const question = typeof a.question === "string" ? a.question.trim() : "";
  if (question && (a.status === "needs_input" || a.outcome === "needs_input")) {
    lines.push(`It is parked on a question for the person: ${JSON.stringify(question)}. Nothing moves until the person answers it in that thread; tell them and do not keep checking.`);
  }
  const result = typeof a.result === "string" ? a.result.trim() : "";
  if (result) lines.push(`Result${result.length > RESULT_HEAD ? " (first part)" : ""}: ${result.slice(0, RESULT_HEAD)}`);
  const children = Array.isArray(r.children) ? r.children.filter(jsonRecord) : [];
  if (children.length) lines.push("Its own hand-offs:", ...children.map((child) => `- ${assignmentLine(child)}`));
  const settled = a.status === "completed" || a.status === "failed" || a.status === "cancelled" || a.status === "done";
  if (!settled) lines.push("It is not settled. Its result resumes you on its own; do not wait on it in this turn.");
  return lines.join("\n");
}
