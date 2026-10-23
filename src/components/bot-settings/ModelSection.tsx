import { EffortRow, ModelPicker } from "../ModelPicker";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./BotEditorContext";
import { ProposalStatus } from "./ProposalStatus";
import { ThreadModelsLine } from "../ThreadModelsLine";
import { t } from "@/lib/i18n";
import { Select } from "../Select";
import { ModelFallbackSettings } from "../ModelFallbackSettings";

export function ModelSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const { draft } = useBotEditor();
  const modelVariants = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.modelVariants;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="min-w-0 rounded-xl bg-card p-4">
        <ModelPicker
          bot={bot}
          contained
          label={
            <div>
              <div className="text-[15px] font-medium text-ink">Default model</div>
              <div className="mt-0.5 text-[13px] text-ink-secondary">
                {draft ? "Starting model for the new bot and its threads." : "For groups and every thread that uses the bot's model. A thread keeps its own model only when you pick one in it."}
              </div>
              <ProposalStatus bot={bot} kind="chief" />
            </div>
          }
        />
        {!draft && <ThreadModelsLine bot={bot} className="mt-3" />}
      </div>

      <EffortRow
        bot={bot}
        className="rounded-xl bg-card p-4"
        label={
          <div>
            <div className="text-[15px] font-medium text-ink">{modelVariants ? "Reasoning" : "Effort"}</div>
            {/* Codex applies a level to the whole thread and cannot take one back, so this says what the app sends, not where the engine ends up. */}
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              {modelVariants ? (draft ? "Starting reasoning variant for the new bot." : "For groups and every thread that uses the bot's model.") : `How hard this bot thinks in groups and every thread that uses its model${bot.modelSelection.effort ? "" : " (Default: no level is sent)"}`}
            </div>
            <ProposalStatus bot={bot} kind="chief" />
          </div>
        }
      />
      {!draft && <ModelFallbackSettings key={bot.id} bot={bot} />}
      {!draft && state.config?.cacheKeepWarm && (
        <KeepWarmRow bot={bot} workspaceOn={state.config.cacheKeepWarm.enabled}
          onChange={(cacheKeepWarm) => dispatch({ type: "updateBot", botId: bot.id, patch: { cacheKeepWarm } })} />
      )}
    </div>
  );
}

function KeepWarmRow({ bot, workspaceOn, onChange }: { bot: Bot; workspaceOn: boolean; onChange: (value: boolean | null) => void }) {
  const value = bot.cacheKeepWarm === true ? "on" : bot.cacheKeepWarm === false ? "off" : "follow";
  return (
    <div className="rounded-xl bg-card p-4">
      <label htmlFor="bot-cache-keepwarm" className="text-[15px] font-medium text-ink">{t("bot.keepWarm.title")}</label>
      <div className="mt-0.5 text-[13px] text-ink-secondary">{t("bot.keepWarm.help")}</div>
      <Select className="mt-3 max-w-full" id="bot-cache-keepwarm" value={value}
        onChange={(event) => onChange(event.target.value === "on" ? true : event.target.value === "off" ? false : null)}>
        <option value="follow">{t("bot.keepWarm.follow", { state: t(workspaceOn ? "bot.keepWarm.on" : "bot.keepWarm.off") })}</option>
        <option value="on">{t("bot.keepWarm.on")}</option>
        <option value="off">{t("bot.keepWarm.off")}</option>
      </Select>
    </div>
  );
}
