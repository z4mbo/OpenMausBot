import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Link2, Search, X } from "lucide-react";
import { useStore, currentTaskBot, type Bot, type InstanceInfo, type ModelSelection } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";
import type { ModelVariantOption } from "../../shared/runtime-events";
import { filterCustomModels, partitionCustomModels, suggestedModels } from "@/lib/custom-models";
import { configuredModelInstances, isClaudeAccount, isCustomOnly, SIGN_IN_FAMILY_LABEL, signInFamily, splitEngineRail, type SignInFamily } from "@/lib/engine-rail";
import { InstanceProviderMark } from "./ProviderIcons";
import { hasSavedApiKey, needsCli, needsSignIn } from "./EngineSetup";
import { ConfirmDialog } from "./ConfirmDialog";
import { approvalModeFor, modelSwitchNeedsAsk } from "../../shared/approval-mode";
import { cn } from "@/lib/cn";
import { COMPOSER_TOOL_ACTIVE } from "@/lib/composer-tool";
import { useMenuMotion } from "./MenuMotion";
import { repeatedModelLabels, SimpleModelPane } from "./SimpleModelPane";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { compactModelLabel, friendlyEffort, simpleEffortLevels } from "@/lib/model-friendly";
import { t } from "@/lib/i18n";
import { threadsOnOwnModel } from "../../shared/thread-model";
import { ThreadModelsLine } from "./ThreadModelsLine";
import { Select } from "./Select";
import { ModelFallbackSettings, modelLabel } from "./ModelFallbackSettings";
import { RemoteModelPicker } from "./RemoteModelPicker";
import { ClaudeAccountSelect, ModelPickerList } from "./ModelPickerList";
import { offersLocalModels, pickerGroupKey, probeLocalModels } from "./model-picker-groups";
import { useSpaceAbove } from "@/hooks/use-space-above";
import { modelSelectionForPick } from "@/lib/model-picker-selection";
export { modelSelectionForPick } from "@/lib/model-picker-selection";
export { ClaudeAccountSelect } from "./ModelPickerList";
export { LOCAL_PROBE_TIMEOUT_MS, offersLocalModels, probeLocalModels } from "./model-picker-groups";

const COMPACT_MODEL_COUNT = 5;

function modelProvider(instance: InstanceInfo | undefined, model: string): string | undefined {
  return instance?.models.options.find((option) => option.id === model)?.provider;
}

export function engineStatus(instance: InstanceInfo): string {
  if (needsCli(instance)) return t("model.setupRequired");
  if (needsSignIn(instance)) return t("model.signInRequired");
  return instance.snapshot.version ?? t("model.ready");
}

export function effortLabel(level: EffortLevel): string {
  return level === "xhigh" ? "X-High" : level[0].toUpperCase() + level.slice(1);
}

/**
 * Default (undefined) sends nothing and lets the engine decide; `none` is a level the engine is told to use. Only pi
 * offers both.
 */
export function EffortRow({
  bot,
  threadId,
  updateBotDefault,
  className,
  label,
  compact = false,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (instance?.capabilities?.modelVariants) {
    return <ModelVariantRow bot={bot} threadId={threadId} updateBotDefault={updateBotDefault} className={className} label={label} compact={compact} />;
  }
  const levels = instance?.capabilities?.effortLevels;
  if (!levels?.length) return null;

  if (compact) return (
    <label className={cn("flex items-center justify-between gap-3", className)}>
      {label}
      <Select size="sm" className="max-w-[65%]" aria-label="Reasoning effort" value={selection.effort ?? ""}
        onChange={(event) => dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
          selection: { ...selection, effort: levels.find((level) => level === event.target.value) } })}>
        <option value="">Default</option>
        {levels.map((level) => <option key={level} value={level}>{effortLabel(level)}</option>)}
      </Select>
    </label>
  );

  return (
    <div className={className}>
      {label}
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Reasoning effort">
        {[undefined, ...levels].map((level) => (
          <button
            key={level ?? "default"}
            type="button"
            aria-pressed={selection.effort === level}
            title={
              level === undefined
                ? "Send no effort level and let the provider decide"
                : `Ask for ${effortLabel(level)} reasoning effort`
            }
            onClick={() => dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort: level } })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              selection.effort === level
                ? "border-accent/60 bg-control text-ink"
                : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
            )}
          >
            {level === undefined ? "Default" : effortLabel(level)}
          </button>
        ))}
      </div>
    </div>
  );
}

function variantLabel(option: ModelVariantOption): string {
  return option.id === "default" ? "OpenCode default" : option.label;
}

/** ACP variant ids are opaque; their model/session declares the available choices. */
export function ModelVariantRow({ bot, threadId, updateBotDefault, className, label, compact = false, wide = false }: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
  wide?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!instance?.capabilities?.modelVariants) return null;
  const session = state.modelVariantSessions[threadId ?? bot.threadId];
  const reported = session?.instanceId === selection.instanceId && session.model === selection.model ? session.variants : undefined;
  const options = reported?.options ?? instance.models.options.find((option) => option.id === selection.model)?.variants ?? [];
  if (!options.length && selection.variant === undefined) return null;
  const missing = selection.variant !== undefined && !options.some((option) => option.id === selection.variant);
  const unavailable = missing && reported !== undefined;
  const current = reported?.currentValue;
  const choose = (variant?: string) => {
    const { effort: _effort, variant: _variant, ...model } = selection;
    dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
      selection: { ...model, ...(variant !== undefined ? { variant } : {}) } });
  };
  if (compact) return (
    <div className={className}>
      <label className="flex items-center justify-between gap-3">
        {label}
        <Select size="sm" aria-label="Reasoning variant" disabled={bot.busy} className={wide ? "flex-1" : "max-w-[65%]"}
          value={selection.variant === undefined ? "unset" : missing ? "missing" : String(options.findIndex((option) => option.id === selection.variant))}
          onChange={(event) => choose(options[Number(event.target.value)]?.id)}>
          <option value="unset">Use session setting</option>
          {missing && <option value="missing" disabled>{selection.variant} ({unavailable ? "unavailable" : "unverified"})</option>}
          {options.map((option, index) => <option key={option.id} value={String(index)}>{variantLabel(option)}</option>)}
        </Select>
      </label>
      {missing && <p className="mt-1 text-[11px] text-ink-secondary">{unavailable ? "Saved variant is unavailable. Choose another or use the session setting." : "Saved variant has not been checked in this session."}</p>}
    </div>
  );
  return (
    <div className={className}>
      {label}
      {(selection.variant === undefined || missing) && (
        <p className="mt-2 text-[12px] text-ink-secondary">
          {unavailable ? `Saved variant “${selection.variant}” is unavailable. Choose an available variant.`
            : missing ? `Saved variant “${selection.variant}” has not been checked in this session.` : "No variant selected."}
          {current !== undefined && ` Session: ${variantLabel(options.find((option) => option.id === current) ?? { id: current, label: current })}.`}
        </p>
      )}
      {selection.variant !== undefined && (
        <button type="button" disabled={bot.busy} onClick={() => choose()}
          title="Send no variant selection; OpenCode keeps its session or configured setting"
          className="mt-2 block text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink disabled:opacity-50">
          Clear variant selection
        </button>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Reasoning variant">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={bot.busy}
              aria-pressed={selection.variant === option.id}
              title={`Use ${variantLabel(option)} for this model`}
              onClick={() => choose(option.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50",
                selection.variant === option.id ? "border-accent/60 bg-control text-ink" : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {variantLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FollowBotModelRow({ name, model, follows, onPick }: { name: string; model: string; follows: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      data-follow-bot-model
      aria-pressed={follows}
      data-picker-item
      onClick={onPick}
      className={cn(
        "mx-1.5 flex w-[calc(100%-0.75rem)] shrink-0 items-center gap-2.5 rounded-xl px-1.5 py-2 text-left outline-none transition-colors hover:bg-control/70 focus-visible:bg-control/70 focus-visible:ring-2 focus-visible:ring-focus/60",
        follows && "bg-control/50",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {follows ? <Check size={15} strokeWidth={2.25} className="text-accent-text" aria-hidden="true" /> : <Link2 size={14} className="text-ink-secondary" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{t("model.useBotModel", { name })}</span>
        <span className="block truncate text-[11.5px] text-ink-tertiary">{model}</span>
      </span>
    </button>
  );
}

function ModelSearch({
  value,
  onChange,
  onEscape,
  local,
}: {
  value: string;
  onChange: (value: string) => void;
  onEscape: () => void;
  local: boolean;
}) {
  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 focus-within:border-focus">
        <Search size={13} className="shrink-0 text-ink-secondary" />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            onEscape();
          }}
          placeholder={t("model.search")}
          aria-label={local ? t("model.searchLocal") : t("model.search")}
          className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
      </div>
    </div>
  );
}

export type RailProvider = {
  instance: InstanceInfo;
  target: InstanceInfo;
  label: string;
  selected: boolean;
};

export function railProviders(instances: InstanceInfo[], selectedInstance: InstanceInfo | undefined,
  claudeInstance: InstanceInfo | undefined, openaiInstance: InstanceInfo | undefined) {
  const firstOf: Record<SignInFamily, InstanceInfo | undefined> = {
    claude: instances.find((instance) => isClaudeAccount(instance) && instance.claudeAccount?.isDefault)
      ?? instances.find(isClaudeAccount),
    openai: instances.find((instance) => signInFamily(instance) === "openai"),
  };
  const opensOn: Record<SignInFamily, InstanceInfo | undefined> = { claude: claudeInstance, openai: openaiInstance };
  const providers = instances.filter((instance) => {
    const family = signInFamily(instance);
    return !family || instance === firstOf[family];
  });
  const entry = (instance: InstanceInfo): RailProvider => {
    const family = signInFamily(instance);
    return {
      instance,
      target: family ? opensOn[family] ?? instance : instance,
      label: family ? SIGN_IN_FAMILY_LABEL[family] : instance.displayName,
      selected: family ? signInFamily(selectedInstance) === family : instance.instanceId === selectedInstance?.instanceId,
    };
  };
  const { subscription, api, custom } = splitEngineRail(providers);
  return { subscription: subscription.map(entry), api: api.map(entry), custom: custom.map(entry) };
}

function apiKeysLabel(instances: InstanceInfo[]): string {
  return t(instances.some(hasSavedApiKey) ? "model.addOrChangeApiKeys" : "model.addApiKeys");
}

const SEGMENTS = "grid min-w-0 gap-0.5 rounded-xl bg-inset p-0.5";
const SEGMENT = "min-w-0 truncate rounded-[10px] px-1 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 @max-[22rem]/pickerfoot:px-0 @max-[22rem]/pickerfoot:text-[11.5px]";
const SEGMENT_ON = "bg-menu text-ink shadow-sm ring-1 ring-hairline/40";
const SEGMENT_OFF = "text-ink-secondary hover:text-ink";

export function EffortSegments({ levels, current, disabled, onPick }: {
  levels: readonly EffortLevel[];
  current?: EffortLevel;
  disabled: boolean;
  onPick: (level: EffortLevel | undefined) => void;
}) {
  const options = [undefined, ...levels];
  return (
    <div role="group" aria-label={t("model.simple.effort")} data-model-effort-control className={SEGMENTS}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((level) => (
        <button key={level ?? "default"} type="button" aria-pressed={current === level} disabled={disabled}
          title={level === undefined ? t("model.effort.defaultHint") : t("model.effort.levelHint", { level: effortLabel(level) })}
          onClick={() => onPick(level)} className={cn(SEGMENT, current === level ? SEGMENT_ON : SEGMENT_OFF)}>
          {level === undefined ? t("model.effort.default") : effortLabel(level)}
        </button>
      ))}
    </div>
  );
}

export function ScopeSegments({ scope, onScope }: { scope: "thread" | "bot"; onScope: (scope: "thread" | "bot") => void }) {
  return (
    <div role="group" aria-label={t("model.scope.aria")} className={cn(SEGMENTS, "grid-cols-2")}>
      {(["thread", "bot"] as const).map((value) => (
        <button key={value} type="button" aria-pressed={scope === value} onClick={() => onScope(value)}
          title={t(value === "bot" ? "model.scope.botHint" : "model.scope.threadHint")}
          className={cn(SEGMENT, scope === value ? SEGMENT_ON : SEGMENT_OFF)}>
          {t(value === "bot" ? "model.scope.bot" : "model.scope.thread")}
        </button>
      ))}
    </div>
  );
}

const POPOVER_WIDTH = 420;
export const SIMPLE_POPOVER_WIDTH = 380;
const SIMPLE_SEARCH_AFTER = 12;

export function ModelPicker({
  bot,
  threadId,
  className,
  contained = false,
  label,
}: {
  bot: Bot;
  threadId?: string;
  className?: string;
  contained?: boolean;
  label?: ReactNode;
}) {
  const { state, dispatch, refreshInstances, refreshModels: refreshInstanceModels } = useStore();
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open && !bot.busy);
  const [railId, setRailId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [probingLocal, setProbingLocal] = useState<string | null>(null);
  const [scope, setScope] = useState<"bot" | "thread">("thread");
  const advanced = useAdvancedMode();
  const ownerOrAdmin = useOwnerOrAdmin();
  // Cloud guests change only their own conversation's model, never the shared bot's default; thread-only until
  // authority loads.
  const simpleUpdatesBotDefault = !state.config?.cloudHome || ownerOrAdmin === true;
  const [fullView, setFullView] = useState(false);
  const [setupFor, setSetupFor] = useState<string | undefined>(undefined);
  const [pendingSwitch, setPendingSwitch] = useState<{ botId: string; threadId: string;
    selection: ModelSelection; updateBotDefault: boolean; name: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [changedBotModel, setChangedBotModel] = useState(false);
  const refreshingRef = useRef(false);
  const remoteConfirmation = useRef(false);
  const lastClaudeIdRef = useRef<string | null>(null);
  const lastOpenaiIdRef = useRef<string | null>(null);
  const space = useSpaceAbove(open && !contained, triggerRef, 600);

  const simpleView = !advanced && !fullView;
  const popoverWidth = simpleView ? SIMPLE_POPOVER_WIDTH : POPOVER_WIDTH;

  const selection = bot.modelSelection;
  const active = state.instances.find((instance) => instance.instanceId === selection.instanceId);
  const pickerInstances = configuredModelInstances(state.instances, selection.instanceId);
  const selectedVariantLabel = selection.variant === undefined ? undefined : variantLabel(
    active?.models.options.find((option) => option.id === selection.model)?.variants?.find((option) => option.id === selection.variant)
      ?? { id: selection.variant, label: selection.variant },
  );
  const claudeAccounts = pickerInstances.filter(isClaudeAccount);
  const openaiAccounts = pickerInstances.filter((instance) => signInFamily(instance) === "openai");
  const multipleClaudeAccounts = state.instances.filter(isClaudeAccount).length > 1;
  const showActiveAccount = (multipleClaudeAccounts && isClaudeAccount(active)) || Boolean(active?.snapshot.chatgptPlan);
  const railInstance =
    pickerInstances.find((instance) => instance.instanceId === (railId ?? selection.instanceId)) ?? pickerInstances[0];
  const customOnly = isCustomOnly(railInstance);

  const refreshLocalInstances = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    void refreshInstances()
      .catch(() => {
      })
      .finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
  }, [refreshInstances]);

  const refreshFor = useCallback((instanceId: string | undefined) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    void refreshInstances()
      .then(() => instanceId ? refreshInstanceModels(instanceId) : undefined)
      .catch(() => {
      })
      .finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
      });
  }, [refreshInstanceModels, refreshInstances]);

  useEffect(() => {
    if (open) refreshLocalInstances();
  }, [open, refreshLocalInstances]);

  useEffect(() => {
    if (bot.busy) setOpen(false);
  }, [bot.busy]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (remoteConfirmation.current) return;
      const clickedNode = event.target instanceof Node ? event.target : null;
      if (!rootRef.current?.contains(clickedNode)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (remoteConfirmation.current || event.key !== "Escape") return;
      if (simpleView && query) setQuery("");
      else close();
    };
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, query, simpleView, close]);

  const resetList = () => {
    setQuery("");
    setShowAll(false);
  };

  const lookForLocal = (instance: InstanceInfo) => {
    if (needsCli(instance) || instance.policy || probingLocal === instance.instanceId) return;
    setProbingLocal(instance.instanceId);
    void probeLocalModels(instance.instanceId, refreshInstanceModels).then(() =>
      setProbingLocal((current) => (current === instance.instanceId ? null : current)));
  };

  const openApiKeys = () => {
    setOpen(false);
    dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
  };

  const openEngines = () => {
    setOpen(false);
    dispatch({ type: "toggleAppSettings", open: true, section: "engines" });
  };

  const selectRail = (instance: InstanceInfo) => {
    if (isClaudeAccount(instance)) lastClaudeIdRef.current = instance.instanceId;
    if (signInFamily(instance) === "openai") lastOpenaiIdRef.current = instance.instanceId;
    setRailId(instance.instanceId);
    resetList();
  };

  const profile = state.bots.find((candidate) => candidate.id === bot.id) ?? bot;
  const follows = threadId ? profile.tasks?.find((task) => task.threadId === threadId)?.followsBotModel : undefined;
  const botModelInstance = state.instances.find((instance) => instance.instanceId === profile.modelSelection.instanceId);
  const botModelName = botModelInstance
    ? `${botModelInstance.displayName} · ${modelLabel(botModelInstance, profile.modelSelection.model)}`
    : profile.modelSelection.model;
  const ownModelThreads = threadsOnOwnModel(profile.modelSelection, profile.tasks ?? []).length;

  const pickBotModel = () => {
    if (bot.busy) return;
    setOpen(false);
    if (follows !== false) return;
    const target = currentTaskBot(profile, threadId ?? bot.threadId);
    if (modelSwitchNeedsAsk(approvalModeFor(target),
      state.instances.find((candidate) => candidate.instanceId === target.modelSelection.instanceId)?.driverKind,
      botModelInstance?.driverKind)) {
      setPendingSwitch({ botId: bot.id, threadId: threadId ?? bot.threadId, selection: profile.modelSelection, updateBotDefault: false, name: botModelName });
      return;
    }
    dispatch({ type: "setModel", botId: bot.id, threadId: threadId ?? bot.threadId, updateBotDefault: false, selection: profile.modelSelection });
    triggerRef.current?.focus();
  };

  const pick = (instance: InstanceInfo, model: string) => {
    if (bot.busy || instance.policy) return;
    const nextSelection = modelSelectionForPick(selection, instance, model);
    const updateBotDefault = !threadId || (simpleView ? simpleUpdatesBotDefault : scope === "bot");
    const targets = updateBotDefault ? [currentTaskBot(profile, threadId ?? bot.threadId), profile] : [bot];
    if (targets.some((target) => modelSwitchNeedsAsk(approvalModeFor(target),
      state.instances.find((candidate) => candidate.instanceId === target.modelSelection.instanceId)?.driverKind,
      instance.driverKind))) {
      setPendingSwitch({ botId: bot.id, threadId: threadId ?? bot.threadId,
        selection: nextSelection, updateBotDefault, name: modelLabel(instance, model) });
      setOpen(false);
      return;
    }
    dispatch({
      type: "setModel",
      botId: bot.id,
      threadId: threadId ?? bot.threadId,
      updateBotDefault,
      selection: nextSelection,
    });
    if (updateBotDefault && threadId) setChangedBotModel(true);
    close();
  };

  const official = railInstance?.models.options.filter((option) => !option.custom) ?? [];
  const custom = railInstance?.models.options.filter((option) => option.custom) ?? [];
  const currentModel = selection.instanceId === railInstance?.instanceId ? selection.model : undefined;

  const simpleOpensOn = (accounts: InstanceInfo[], lastId: string | null) =>
    accounts.find((account) => account.instanceId === lastId)
      ?? accounts.find((account) => account.instanceId === selection.instanceId)
      ?? accounts.find((account) => !needsCli(account) && !needsSignIn(account))
      ?? accounts[0];
  const simpleProviders = (() => {
    const groups = railProviders(pickerInstances, railInstance,
      simpleOpensOn(claudeAccounts, lastClaudeIdRef.current), simpleOpensOn(openaiAccounts, lastOpenaiIdRef.current));
    return [...groups.subscription, ...groups.api, ...groups.custom];
  })();
  const simpleFamily = signInFamily(railInstance);
  const simpleAccounts = simpleFamily === "claude" ? claudeAccounts : simpleFamily === "openai" ? openaiAccounts : [];
  const simpleLabel = simpleProviders.find((provider) => provider.selected)?.label ?? railInstance?.displayName ?? "";
  const simpleSignIn = !customOnly && needsSignIn(railInstance);
  const simpleOfficial = customOnly || simpleSignIn ? [] : official;
  const simpleLocal = partitionCustomModels(custom);
  const simpleAll = [...simpleOfficial, ...simpleLocal.pinned, ...simpleLocal.rest];
  const simpleSetup = Boolean(railInstance && (railInstance.policy || needsCli(railInstance) || (simpleSignIn && simpleAll.length === 0)));
  const simpleSuggested = railInstance
    ? suggestedModels(simpleAll, railInstance.models.default, currentModel, COMPACT_MODEL_COUNT)
    : [];
  const simpleOpened = [...simpleSuggested, ...simpleAll.filter((option) => !simpleSuggested.includes(option))];
  const simpleSearch = showAll && simpleAll.length > SIMPLE_SEARCH_AFTER;
  const simpleQuery = simpleSearch ? query : "";
  const simpleModels = simpleQuery ? filterCustomModels(simpleOpened, simpleQuery) : showAll ? simpleOpened : simpleSuggested;
  const lookForLocalIn = (instance: InstanceInfo) => {
    if (offersLocalModels(instance, instance.models.options.filter((option) => option.custom).length)) lookForLocal(instance);
  };
  const browseSimple = (instance: InstanceInfo) => {
    selectRail(instance);
    lookForLocalIn(instance);
  };
  const activeLevels = active?.capabilities?.effortLevels ?? [];
  const setEffort = (level: EffortLevel | undefined, updateBotDefault: boolean) => dispatch({ type: "setModel", botId: bot.id, threadId,
    ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort: level } });
  const simpleEffort = activeLevels.length > 0 ? {
    levels: simpleEffortLevels(activeLevels, selection.effort),
    current: selection.effort,
    onPick: (level: EffortLevel) => setEffort(level, Boolean(threadId) && simpleUpdatesBotDefault),
  } : null;

  const botModelId = follows !== undefined && profile.modelSelection.instanceId === railInstance?.instanceId
    ? profile.modelSelection.model : undefined;

  const summary = active
    ? `${active.displayName} · ${modelLabel(active, selection.model)}${
        modelProvider(active, selection.model) ? ` · ${modelProvider(active, selection.model)}` : ""
      }${selectedVariantLabel ? ` · ${selectedVariantLabel}` : selection.effort ? ` · ${effortLabel(selection.effort)} effort` : ""}`
    : selection.model;
  const followLine = follows === true ? `\n${t("model.followsBot", { name: profile.name })}` : follows === false ? `\n${t("model.ownModel")}` : "";
  const shownLabel = contained ? modelLabel(active, selection.model) : compactModelLabel(modelLabel(active, selection.model), signInFamily(active));
  const footer = !simpleView && !contained && (Boolean(threadId) || activeLevels.length > 0 || Boolean(active?.capabilities?.modelVariants));

  const trigger = (
    <button data-tour="model"
      ref={triggerRef}
      type="button"
      disabled={Boolean(bot.busy)}
      onClick={() => {
        if (bot.busy) return;
        if (active && isClaudeAccount(active)) lastClaudeIdRef.current = active.instanceId;
        if (active && signInFamily(active) === "openai") lastOpenaiIdRef.current = active.instanceId;
        const initial = pickerInstances.find((instance) => instance.instanceId === selection.instanceId) ?? pickerInstances[0];
        setRailId(initial?.instanceId ?? null);
        setChangedBotModel(false);
        setOpen((wasOpen) => {
          const next = !wasOpen;
          if (next) {
            resetList();
            setFullView(false);
            setSetupFor(undefined);
          }
          return next;
        });
      }}
      aria-expanded={open && !bot.busy}
      aria-haspopup="dialog"
      aria-label={t("model.triggerAria", { summary })}
      className={cn(
        contained
          ? "flex h-8 items-center gap-2 rounded-full border border-hairline/50 bg-control/50 pl-2.5 pr-3 text-[13px] font-medium text-ink transition-colors hover:bg-raised-hover"
          : "flex h-8 min-w-0 items-center gap-1.5 rounded-full pl-2 pr-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-ink/[0.07] hover:text-ink",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
        open && (contained ? "bg-raised-hover" : COMPOSER_TOOL_ACTIVE),
      )}
      title={bot.busy ? `${summary}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${summary}${followLine}`}
    >
      {active && <InstanceProviderMark instance={active} size={15} className="shrink-0" />}
      <span className="flex min-w-0 items-center gap-1 @max-[22rem]/composer:hidden">
        {active && showActiveAccount && (
          <span data-model-account className="shrink-0 text-ink-tertiary @max-[34rem]/composer:hidden">{active.displayName} · </span>
        )}
        <span className="min-w-0 truncate">{shownLabel}</span>
        {selection.source && <span className="shrink-0 text-ink-tertiary">· {t("modelHost.shared")}</span>}
        {selectedVariantLabel !== undefined ? (
          <span data-model-variant className="max-w-[120px] shrink-0 truncate font-normal text-ink-tertiary">· {selectedVariantLabel}</span>
        ) : selection.effort && (
          <span data-model-effort className="shrink-0 font-normal text-ink-tertiary @max-[30rem]/composer:hidden">
            · {advanced ? effortLabel(selection.effort) : friendlyEffort(selection.effort)}
          </span>
        )}
      </span>
      <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-tertiary transition-transform", open && "rotate-180")} />
    </button>
  );
  const followRow = follows !== undefined
    ? <FollowBotModelRow name={profile.name} model={botModelName} follows={follows} onPick={pickBotModel} />
    : undefined;

  return (
    <div ref={rootRef} className={cn(contained ? "w-full min-w-0" : "flex min-w-0", className)}>
      {contained ? (
        <div className="flex min-w-0 items-center justify-between gap-4">
          {label}
          {trigger}
        </div>
      ) : (
        trigger
      )}

      {motion.shown && (
        <div
          data-model-picker-content
          role="dialog"
          aria-label={t("model.choose")}
          {...motion.exitProps}
          style={contained ? undefined : { width: popoverWidth, maxHeight: space }}
          className={cn(
            "flex flex-col overflow-hidden rounded-2xl border border-hairline/60 bg-menu",
            contained
              ? "relative mt-3 w-full max-h-[min(460px,60dvh)]"
              : "absolute bottom-full left-0 z-40 mb-2 max-w-full origin-bottom-left",
            motion.className,
          )}
        >
          {simpleView ? (
            <>
              {followRow && <div className="shrink-0 border-b border-hairline/40 py-1.5">{followRow}</div>}
              <div className="flex min-h-0 min-w-0 flex-1">
                <SimpleModelPane
                  providers={simpleProviders}
                  onProvider={browseSimple}
                  account={railInstance && simpleAccounts.length > 1 ? (
                    <ClaudeAccountSelect accounts={simpleAccounts} selectedId={railInstance.instanceId} onSelect={browseSimple} />
                  ) : undefined}
                  managedBy={railInstance?.policy?.organizationName ?? null}
                  needsSetup={railInstance && simpleSetup ? { name: simpleAccounts.length > 1 ? railInstance.displayName : simpleLabel } : null}
                  signIn={railInstance && simpleSignIn && !simpleSetup ? { name: simpleLabel } : null}
                  onSetUp={() => {
                    setSetupFor(railInstance ? pickerGroupKey(railInstance) : undefined);
                    setFullView(true);
                  }}
                  models={simpleModels}
                  repeatedLabels={repeatedModelLabels(simpleAll)}
                  query={simpleQuery}
                  showAll={simpleAll.length > simpleSuggested.length && !simpleQuery ? {
                    count: simpleAll.length,
                    open: showAll,
                    onToggle: () => {
                      if (showAll) {
                        resetList();
                        return;
                      }
                      setShowAll(true);
                      if (railInstance) lookForLocalIn(railInstance);
                    },
                  } : null}
                  onRefresh={() => refreshFor(railInstance?.instanceId)}
                  refreshing={refreshing}
                  search={simpleSearch ? (
                    <ModelSearch
                      value={query}
                      local={simpleOfficial.length === 0}
                      onChange={setQuery}
                      onEscape={() => (query ? setQuery("") : setOpen(false))}
                    />
                  ) : undefined}
                  currentModelId={currentModel}
                  botModelId={botModelId}
                  onPick={(model) => railInstance && pick(railInstance, model)}
                  variantsRow={active?.capabilities?.modelVariants ? (
                    <ModelVariantRow compact wide bot={bot} threadId={threadId} updateBotDefault={Boolean(threadId) && simpleUpdatesBotDefault}
                      label={<span className="shrink-0 text-[12px] font-medium text-ink-secondary">{t("model.simple.reasoning")}</span>} />
                  ) : undefined}
                  effort={simpleEffort}
                  onManage={openEngines}
                />
              </div>
            </>
          ) : (
            <ModelPickerList
              instances={pickerInstances}
              selection={selection}
              botModel={follows !== undefined ? profile.modelSelection : undefined}
              lead={followRow}
              refreshing={refreshing}
              onRefresh={(instance) => refreshFor(instance.instanceId)}
              probing={probingLocal}
              onProbe={lookForLocal}
              onPick={pick}
              onSettings={openEngines}
              onApiKeys={window.ogb?.remoteClient?.active === true ? undefined : openApiKeys}
              apiKeysLabel={apiKeysLabel(pickerInstances)}
              onClose={close}
              startOn={setupFor}
            />
          )}
          {footer && (
            <div data-model-picker-footer className="@container/pickerfoot shrink-0 border-t border-hairline/40 px-3 py-2.5">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 @max-[22rem]/pickerfoot:grid-cols-1 @max-[22rem]/pickerfoot:gap-y-1.5">
              {active?.capabilities?.modelVariants ? (
                <ModelVariantRow compact wide bot={bot} threadId={threadId} updateBotDefault={Boolean(threadId && scope === "bot")} className="col-span-full"
                  label={<span className="shrink-0 text-[12px] font-medium text-ink-secondary">{t("model.simple.reasoning")}</span>} />
              ) : activeLevels.length > 0 && (
                <>
                  <span className="text-[12px] font-medium text-ink-secondary">{t("model.effort.label")}</span>
                  <EffortSegments levels={activeLevels} current={selection.effort} disabled={Boolean(bot.busy)}
                    onPick={(level) => setEffort(level, Boolean(threadId && scope === "bot"))} />
                </>
              )}
              {threadId && (
                <>
                  <span className="text-[12px] font-medium text-ink-secondary">{t("model.scope.label")}</span>
                  <ScopeSegments scope={scope} onScope={setScope} />
                </>
              )}
            </div>
            </div>
          )}
          <RemoteModelPicker key={`${profile.id}:${threadId ?? bot.threadId}`} bot={bot} threadId={threadId} updateBotDefault={!threadId || (simpleView ? simpleUpdatesBotDefault : scope === "bot")} onChosen={() => setOpen(false)} confirmationRef={remoteConfirmation} />
          <ModelFallbackSettings key={profile.id} bot={profile} compact />
        </div>
      )}
      {!contained && changedBotModel && !open && ownModelThreads > 0 && (
        <div data-thread-models-notice role="status"
          className="absolute bottom-full left-0 z-30 mb-2 flex max-w-full items-center gap-2 rounded-xl border border-hairline/50 bg-menu py-2 pl-3 pr-2">
          <ThreadModelsLine bot={profile} />
          <button type="button" aria-label={t("common.close")} onClick={() => setChangedBotModel(false)}
            className="shrink-0 rounded-md p-1 text-ink-secondary hover:bg-control/60 hover:text-ink">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      <ConfirmDialog
        open={pendingSwitch !== null}
        title={t("model.providerSwitch.title")}
        body={t(pendingSwitch?.updateBotDefault ? "model.providerSwitch.botBody" : "model.providerSwitch.threadBody", {
          model: pendingSwitch?.name ?? "",
        })}
        tone="neutral"
        confirmLabel={t("model.providerSwitch.confirm")}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          if (!pendingSwitch || bot.busy || pendingSwitch.botId !== bot.id || pendingSwitch.threadId !== (threadId ?? bot.threadId)) {
            setPendingSwitch(null); return;
          }
          dispatch({ type: "setModel", botId: pendingSwitch.botId, threadId: pendingSwitch.threadId,
            selection: pendingSwitch.selection, updateBotDefault: pendingSwitch.updateBotDefault,
            resetApprovalToAsk: true });
          if (pendingSwitch.updateBotDefault && threadId) setChangedBotModel(true);
          setPendingSwitch(null);
        }}
      />
    </div>
  );
}
