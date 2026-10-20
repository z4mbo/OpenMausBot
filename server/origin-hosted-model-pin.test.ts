import { expect, it, vi } from "vitest";
import type { RuntimeEvent, RuntimeEventListener } from "./contracts.ts";
import { createHostedSidecar } from "./origin-model-host-sidecar.ts";
import type { HostedTurnInput } from "./origin-model-host-types.ts";
import { Store } from "./store.ts";
import { routeDirectTurn } from "./turn-route.ts";

it("pins a hosted account's exact model even when it equals a conversational bot's default", async () => {
  const chosen = { instanceId: "owner-claude", model: "claude-opus-5" };
  const store = new Store(() => chosen);
  const bot = store.createBot({ name: "Hosted researcher", modelSelection: chosen });
  store.patchBot(bot.id, { replyStyle: "conversational" });
  const privateThread = bot.threadId;
  const listeners = new Set<RuntimeEventListener>();
  let hostedThread = "";
  const sidecar = createHostedSidecar({ store, interrupt: async () => undefined, redact: text => text,
    observe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start: async (botId, text, options) => {
      hostedThread = options.threadId;
      const current = store.projectBotForTask(botId, options.threadId)!;
      const task = store.taskByThread(botId, options.threadId)!;
      const routed = routeDirectTurn(current, task, [], { text, images: [] }, {
        models: { default: chosen.model, options: [{ id: chosen.model, label: "Opus" }, { id: "claude-haiku-4-5", label: "Haiku" }] },
        adapter: { capabilities: {} },
      }, false);
      expect(routed.model).toBe(chosen.model);
      expect(task.modelSelection).toEqual(chosen);
      const message = store.appendMessage(options.threadId, { role: "user", kind: "text", text });
      for (const listener of listeners) listener({ type: "turn.completed", threadId: options.threadId, turnId: "synthetic-turn",
        providerInstanceId: chosen.instanceId, ok: true } as RuntimeEvent);
      options.onTurnSettled();
      return message;
    },
  });
  const input = { botId: bot.id, instanceId: chosen.instanceId, cwd: "C:\\synthetic-project", context: [], signal: new AbortController().signal,
    work: { runId: "synthetic-run", executionId: "synthetic-execution", requesterUserId: "synthetic-requester", requesterName: "Teammate", model: chosen.model, text: "hi there" },
    beforeDispatch: vi.fn(async () => undefined), activity: vi.fn(), emit: vi.fn() } as unknown as HostedTurnInput;
  expect(await sidecar.run(input)).toEqual({ ok: true });
  expect(bot.threadId).toBe(privateThread);
  expect(bot.modelSelection).toEqual(chosen);
  expect(new Store(() => chosen).taskByThread(bot.id, hostedThread)?.modelSelection).toEqual(chosen);
});
