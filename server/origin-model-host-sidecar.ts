import type { RuntimeEvent, RuntimeEventListener } from "./contracts.ts";
import { randomUUID } from "node:crypto";
import type { HostedTurnInput, HostedTurnOutcome } from "./origin-model-host-types.ts";
import { quotaWorkEvent } from "./quota-refusal.ts";
import type { ResolvedSender } from "../shared/wire.ts";
import { sharedStreamingPreview, toCloudRow } from "./origin-thread-mirror.ts";
import type { Message, Store } from "./store.ts";

export interface HostedStartOptions {
  threadId: string;
  sender: ResolvedSender;
  hostedExecution: { beforeDispatch(): Promise<void> };
  onTurnSettled(): void;
  onDispatchError(message: string): void;
}

interface SidecarDeps {
  store: Store;
  start(botId: string, text: string, options: HostedStartOptions): Promise<Message>;
  interrupt(botId: string, threadId: string): Promise<void>;
  observe(listener: RuntimeEventListener): () => void;
  redact(text: string): string;
}

export function createHostedSidecar(deps: SidecarDeps) {
  const threads = new Set<string>();
  return {
    owns: (threadId: string) => threads.has(threadId),
    async run(input: HostedTurnInput): Promise<HostedTurnOutcome> {
      const { work, botId } = input;
      const task = deps.store.createTask(botId, `Shared request · ${work.requesterName}`.slice(0, 80), false,
        undefined, undefined, "ask", { instanceId: input.instanceId, model: work.model }, input.cwd);
      if (!task) throw new Error("The shared agent no longer exists on this computer");
      deps.store.patchTask(botId, task.threadId, { sharedPrivate: true,
        modelSelection: { instanceId: input.instanceId, model: work.model },
        hostedRequest: { runId: work.runId, executionId: work.executionId, requesterUserId: work.requesterUserId } });
      threads.add(task.threadId);
      for (const row of input.context) {
        if (row.kind !== "text" && row.kind !== "activity" && row.kind !== "compaction") continue;
        deps.store.applyRemoteMessage(task.threadId, {
          role: row.role, kind: row.kind === "activity" ? "activity" : "text",
          ...(row.text !== undefined ? { text: row.text.replace(/<attached-(?:image|file|audio)\b[^>]*\/?\s*>/gi, "[Attachment unavailable on this computer]") } : {}), ...(row.tool ? { tool: row.tool } : {}), at: row.createdAt,
          remote: { cloudId: `host-context:${work.runId}:${row.seq}`, name: row.role === "user" ? row.authorName ?? "Workspace member" : row.executedByName ?? row.runBy ?? "Shared agent", status: row.status },
        });
      }
      let terminal: Extract<RuntimeEvent, { type: "turn.completed" }> | undefined;
      let stream: { clientId: string; text: string; published: boolean } | undefined;
      let streamTimer: ReturnType<typeof setTimeout> | undefined;
      const streamed = new Map<string, string>();
      const publishStream = () => {
        streamTimer = undefined;
        if (!stream || input.signal.aborted) return;
        const text = sharedStreamingPreview(stream.text, deps.redact);
        if (!text) return;
        input.emit({ clientId: stream.clientId, role: "bot", kind: "text", text, status: "streaming" }, stream.published);
        stream.published = true;
      };
      let began = false, activity = false, complete!: () => void;
      let pendingRows: Array<{ message: Message; patch: boolean }> = [];
      const settled = new Promise<void>(resolve => { complete = resolve; });
      const flush = () => {
        const rows = pendingRows; pendingRows = [];
        for (const { message, patch } of rows) {
          const row = toCloudRow(message, deps.redact);
          if (row?.role === "bot") input.emit(row, patch);
        }
      };
      const markActivity = () => { if (!activity) { activity = true; input.activity(); } flush(); };
      const offEvents = deps.observe(event => {
        if (event.threadId !== task.threadId || event.providerInstanceId !== input.instanceId) return;
        if (event.type === "turn.started") began = true;
        if (began && quotaWorkEvent(event)) markActivity();
        if (began && event.type === "content.delta" && event.streamKind === "assistant_text") {
          stream ??= { clientId: `stream:${randomUUID()}`, text: "", published: false };
          stream.text = (stream.text + event.delta).slice(0, 60_000);
          if (!stream.published) publishStream();
          else streamTimer ??= setTimeout(publishStream, 400);
        }
        if (event.type === "turn.completed") terminal = event;
      });
      const offRows = deps.store.onChange(change => {
        if ((change.type !== "message" && change.type !== "message.patch") || change.threadId !== task.threadId || change.message.role !== "bot" || change.message.remote) return;
        if (activity) {
          const row = toCloudRow(change.message, deps.redact);
          if (row?.role === "bot") {
            if (row.kind === "text" && change.type === "message" && stream) {
              clearTimeout(streamTimer); streamTimer = undefined;
              if (stream.published) streamed.set(change.message.id, stream.clientId);
              stream = undefined;
            }
            const clientId = streamed.get(change.message.id);
            input.emit(clientId ? { ...row, clientId, status: "final" } : row, Boolean(clientId) || change.type === "message.patch");
          }
        } else pendingRows.push({ message: structuredClone(change.message), patch: change.type === "message.patch" });
      });
      let interrupted: Promise<void> | undefined;
      const abort = () => { interrupted ??= deps.interrupt(botId, task.threadId).catch(() => undefined); complete(); };
      input.signal.addEventListener("abort", abort, { once: true });
      try {
        if (input.signal.aborted) throw new Error("The hosted request was cancelled");
        await deps.start(botId, work.text, {
          threadId: task.threadId, sender: { name: work.requesterName, id: `origin:${work.requesterUserId}` },
          hostedExecution: { beforeDispatch: input.beforeDispatch },
          onTurnSettled: () => queueMicrotask(complete), onDispatchError: () => queueMicrotask(complete),
        });
        await settled;
        if (!input.signal.aborted && (activity || terminal?.refusal?.retry !== "safe_initial_refusal")) flush();
        return { ok: !input.signal.aborted && terminal?.ok === true,
          ...(!activity && terminal?.refusal ? { refusal: terminal.refusal } : {}) };
      } finally {
        clearTimeout(streamTimer);
        if (interrupted) await interrupted;
        pendingRows = []; input.signal.removeEventListener("abort", abort); offEvents(); offRows(); threads.delete(task.threadId);
        deps.store.setTaskClosedBy(botId, task.threadId, { botId, name: "Hosted execution", at: Date.now() });
      }
    },
  };
}
