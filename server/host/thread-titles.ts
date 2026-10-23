import type { ApiRequestBudget, ProviderInstance } from "../contracts.ts";
import { titleFromLlm, type BotRecord } from "../store.ts";
import { threadTitlePrompt, type ThreadTitleSource } from "../thread-title.ts";

export function createThreadTitleHost(deps: {
  enabled(): boolean;
  instance(instanceId: string): ProviderInstance | null;
  modelRefusal(bot: Pick<BotRecord, "modelSelection">): string | undefined;
  providerRefusal(instance: ProviderInstance): string | undefined;
  assertBudget(): void;
  apiBudget(instance: ProviderInstance, botId: string): ApiRequestBudget | undefined | Promise<ApiRequestBudget | undefined>;
}) {
  async function generateThreadTitle(provider: ProviderInstance, text: string, source: ThreadTitleSource = "first-message", botId = "thread-titles"): Promise<string | null> {
    const prompt = threadTitlePrompt(text, source);
    const expiry = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        provider.generateText!(prompt, { signal: expiry.signal, apiBudget: await deps.apiBudget(provider, botId) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { expiry.abort(); reject(new Error("thread title timed out")); }, 10_000); }),
      ]);
      return titleFromLlm(reply);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }
  function threadTitleGate(bot: Pick<BotRecord, "modelSelection">): { ok: true; instance: ProviderInstance } | { ok: false; refusal: string } {
    if (!deps.enabled()) return { ok: false, refusal: "generated thread titles are turned off on this server" };
    const modelRefusal = deps.modelRefusal(bot);
    if (modelRefusal) return { ok: false, refusal: modelRefusal };
    const instance = deps.instance(bot.modelSelection.instanceId);
    if (!instance?.generateText) return { ok: false, refusal: "this bot's model can't generate a title — rename the thread instead" };
    const refusal = deps.providerRefusal(instance);
    if (refusal) return { ok: false, refusal };
    try { deps.assertBudget(); }
    catch (error) { return { ok: false, refusal: error instanceof Error ? error.message : String(error) }; }
    return { ok: true, instance };
  }
  return { generateThreadTitle, threadTitleGate };
}
