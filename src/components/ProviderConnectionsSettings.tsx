import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { AnthropicEveryClaudeBot, ApiKeyRow, OpenCodeProviderKeys, VpsConnection } from "./ApiKeys";
import { OtherOpenAiCompatServers } from "./OpenAiCompatServers";
import { ModelHostingSettings } from "./ModelHostingSettings";
import { Card } from "./SettingsPrimitives";

export function ProviderConnectionsSettings() {
  const { state } = useStore();
        return (
          <Card
            title={t("settings.connections.title")}
            subtitle={t("settings.connections.subtitle")}
          >
            <div className="flex flex-col gap-4">
              {state.config?.composio.mode === "managed" ? (
                <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[13px] text-success">
                  {t("settings.connections.ready")}
                </div>
              ) : null}
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("keys.providers.title")}</div>
              <p className="-mt-3 text-[12px] leading-relaxed text-ink-secondary">{t("keys.providers.subtitle")}</p>
              <ApiKeyRow section="openai" testProvider="openai" />
              <ApiKeyRow section="anthropic" testProvider="anthropic" />
              <AnthropicEveryClaudeBot />
              <ApiKeyRow section="xai" testProvider="xai" />
              <ApiKeyRow section="openrouter" testProvider="openrouter" />
              <ApiKeyRow section="mistral" testProvider="mistral" />
              <ApiKeyRow section="cerebras" testProvider="cerebras" />
              <ApiKeyRow section="groq" testProvider="groq" />
              <ApiKeyRow section="meta" testProvider="meta" />
              <OtherOpenAiCompatServers />
              <div className="pt-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("keys.integrations.title")}</div>
              <ApiKeyRow section="box" />
              <VpsConnection />
              <ApiKeyRow section="opencodeGo" />
              {state.config?.cloudHome !== true && (
                <p className="-mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
                  {t("keys.opencode.providersHint").split("{command}").flatMap((part, index) =>
                    index === 0 ? [part] : [<code key={index} className="font-mono">opencode auth login</code>, part])}
                </p>
              )}
              <OpenCodeProviderKeys />
              <ModelHostingSettings />
              <details className="rounded-lg border border-hairline/40 bg-inset px-3 py-2">
                <summary className="cursor-pointer text-[13px] text-ink-secondary">{t("settings.connections.selfHost")}</summary>
                <div className="mt-3">
                  <ApiKeyRow section="composio" />
                </div>
              </details>
            </div>
          </Card>
        );
}
