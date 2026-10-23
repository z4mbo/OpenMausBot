import type { SharedDefinition } from "../shared/origin-shared-agents.ts";
import type { QuotaRefusal } from "../shared/runtime-events.ts";
import type { CloudKind, CloudTool, OutboundRow } from "./origin-thread-mirror.ts";

export interface HostedSource {
  sourceId: string;
  hostId: string;
  ownerUserId: string;
  ownerName: string;
  computerName: string;
  provider: string;
  label: string;
  billing: "subscription" | "metered" | "unknown";
  models: string[];
  heartbeatAt: number;
  expiresAt: number;
  capacity: number;
}

export interface HostedWork {
  executionId: string;
  runId: string;
  threadId: string;
  agentId: string;
  teamId: string;
  projectId?: string;
  sourceId: string;
  sourceKey: string;
  provider: string;
  model: string;
  requesterUserId: string;
  requesterName: string;
  requestClientId: string;
  requestSeq: number;
  text: string;
  definitionVersion: number;
  definitionHash: string;
  definition: SharedDefinition;
  status: "pending" | "claimed" | "running";
  leaseUntil?: number;
  billing: HostedSource["billing"];
  allowMetered: boolean;
}

export interface HostedContextRow {
  seq: number;
  role: "user" | "bot";
  kind: CloudKind;
  text?: string;
  tool?: CloudTool;
  status: "streaming" | "final" | "interrupted";
  createdAt: number;
  authorUserId?: string;
  authorName?: string;
  runBy?: string;
  executedByName?: string;
}

export interface HostedTurnInput {
  work: HostedWork;
  botId: string;
  instanceId: string;
  cwd: string;
  context: HostedContextRow[];
  signal: AbortSignal;
  beforeDispatch(): Promise<void>;
  activity(): void;
  emit(row: OutboundRow, patch: boolean): void;
}

export interface HostedTurnOutcome {
  ok: boolean;
  refusal?: QuotaRefusal;
}

export interface HostedPort {
  query(name: string, args: Record<string, unknown>): Promise<unknown>;
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export const hostingRefusal = (message: string, status = 409, code = "model_host_unavailable") => Object.assign(new Error(message), { status, code });
export const MODEL_HOST_NOT_READY = "Teammate-hosted model fallback is not available in this release";
