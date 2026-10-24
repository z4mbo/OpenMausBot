import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleArrowUp, HardDrive, KeyRound, Loader2, LogIn, RefreshCw, Search, Settings2, Wrench } from "lucide-react";
import type { InstanceInfo, ModelSelection } from "@/state/store";
import type { SignInFamily } from "@/lib/engine-rail";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { modelBlurb } from "@/lib/model-friendly";
import { formatTokens } from "@/lib/usage";
import { filterCustomModels, partitionCustomModels } from "@/lib/custom-models";
import { InstanceProviderMark } from "./ProviderIcons";
import { EngineSetup, EngineUpdateNotice, needsCli, needsSignIn } from "./EngineSetup";
import { ChatGptPlanStatus } from "./ChatGptPlanStatus";
import { Select } from "./Select";
import { groupMatches, groupModels, offersLocalModels, pickerGroups, SUGGESTED_COUNT, type ModelOption, type PickerGroup } from "./model-picker-groups";

type Page = { kind: "list" } | { kind: "provider" | "local"; key: string };

const ROW = "mx-1.5 flex w-[calc(100%-0.75rem)] min-w-0 items-center gap-2.5 rounded-xl px-1.5 py-2 text-left outline-none transition-colors hover:bg-control/70 focus-visible:bg-control/70 focus-visible:ring-2 focus-visible:ring-focus/60";
const SLOT = "flex size-5 shrink-0 items-center justify-center";
const BADGE = "shrink-0 rounded-md border border-hairline/60 px-1.5 text-[10.5px] font-medium leading-[1.125rem] text-ink-secondary";

const ACCESS_LABEL = { subscription: "model.access.plan", api: "model.access.apiKey", custom: "model.access.local" } as const;

function focusableItems(root: HTMLElement | null): HTMLElement[] {
  return [...(root?.querySelectorAll<HTMLElement>("[data-picker-item]") ?? [])].filter((item) => !(item as HTMLButtonElement).disabled);
}

function navigate(event: KeyboardEvent, root: HTMLElement | null, search: HTMLInputElement | null) {
  const items = focusableItems(root);
  const index = items.indexOf(document.activeElement as HTMLElement);
  const go = (next: number) => {
    event.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
  };
  if (event.key === "ArrowDown") go(index + 1);
  else if (event.key === "ArrowUp") {
    if (index <= 0 && search) {
      event.preventDefault();
      search.focus();
    } else go(index - 1);
  } else if (event.key === "Home") go(0);
  else if (event.key === "End") go(items.length - 1);
  else if (search && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && index >= 0) search.focus();
}

function rove(root: HTMLElement | null, focused?: Element | null) {
  const items = focusableItems(root);
  const anchor = items.find((item) => item === focused)
    ?? items.find((item) => item.dataset.roving === "true")
    ?? items.find((item) => item.getAttribute("aria-current") === "true" || item.getAttribute("aria-pressed") === "true")
    ?? items[0];
  for (const item of items) {
    item.tabIndex = item === anchor ? 0 : -1;
    if (item === anchor) item.dataset.roving = "true";
    else delete item.dataset.roving;
  }
}

function touchScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches === true;
}

export function ModelRow({ option, current, isDefault, botModel, onPick }: {
  option: ModelOption;
  current: boolean;
  isDefault: boolean;
  botModel: boolean;
  onPick: () => void;
}) {
  const blurb = modelBlurb(option);
  const descriptor = blurb ?? (option.provider ? t("model.provider", { name: option.provider }) : undefined);
  return (
    <button type="button" data-picker-item data-model-row={option.id} aria-current={current || undefined} onClick={onPick}
      title={[option.label, option.provider, blurb].filter(Boolean).join(" · ")}
      className={cn(ROW, current && "bg-control/40")}>
      <span className={SLOT}>{current && <Check size={15} strokeWidth={2.25} className="text-accent-text" aria-hidden="true" />}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{option.label}</span>
          {isDefault && <span className={BADGE}>{t("model.badge.default")}</span>}
          {option.loaded && <span className={cn(BADGE, "border-success/40 text-success")}>{t("model.badge.loaded")}</span>}
          {botModel && <span data-bot-model className="shrink-0 text-[11px] text-ink-tertiary">{t("model.botModelTag")}</span>}
        </span>
        {descriptor && <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-ink-tertiary">{descriptor}</span>}
      </span>
      {option.contextWindow ? (
        <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary" title={t("model.contextWindow", { tokens: formatTokens(option.contextWindow) })}>
          {formatTokens(option.contextWindow)}
        </span>
      ) : null}
    </button>
  );
}

function ActionRow({ icon, label, ariaLabel, detail, tone, onClick, disabled, chevron = true, ...data }: {
  icon: ReactNode;
  label: string;
  ariaLabel?: string;
  detail?: string;
  tone?: "warning" | "accent";
  onClick: () => void;
  disabled?: boolean;
  chevron?: boolean;
  [key: `data-${string}`]: string | boolean | undefined;
}) {
  return (
    <button type="button" data-picker-item onClick={onClick} disabled={disabled} aria-label={ariaLabel} {...data}
      className={cn(ROW, "text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50")}>
      <span className={cn(SLOT, tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent-text" : "text-ink-secondary")}>{icon}</span>
      <span className={cn("min-w-0 flex-1 truncate font-medium", tone === "accent" ? "text-accent-text" : "text-ink")}>{label}</span>
      {detail && <span className="shrink-0 text-[11px] text-ink-tertiary">{detail}</span>}
      {chevron && <ChevronRight size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />}
    </button>
  );
}

export function ClaudeAccountSelect({ accounts, selectedId, onSelect }: {
  accounts: InstanceInfo[];
  selectedId: string;
  onSelect: (instance: InstanceInfo) => void;
}) {
  return (
    <label className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-ink-secondary">
      <span>{t("model.account")}:</span>
      <Select size="sm" className="flex-1"
        aria-label={t("model.account")}
        value={selectedId}
        onChange={(event) => {
          const account = accounts.find((instance) => instance.instanceId === event.target.value);
          if (account) onSelect(account);
        }}
      >
        {accounts.map((account) => <option key={account.instanceId} value={account.instanceId}>{account.displayName}</option>)}
      </Select>
    </label>
  );
}

function statusLabel(group: PickerGroup): string | null {
  if (group.status === "policy") return t("policy.managedBy", { organization: group.instance.policy!.organizationName });
  if (group.status === "setup") return t("model.setupRequired");
  if (group.status === "signIn") return t("model.signInRequired");
  return null;
}

export function ModelPickerList({
  instances,
  selection,
  botModel,
  lead,
  refreshing,
  onRefresh,
  probing,
  onProbe,
  onPick,
  onSettings,
  onApiKeys,
  apiKeysLabel,
  onClose,
  startOn,
}: {
  instances: InstanceInfo[];
  selection: ModelSelection;
  botModel?: Pick<ModelSelection, "instanceId" | "model">;
  lead?: ReactNode;
  refreshing: boolean;
  onRefresh: (instance: InstanceInfo) => void;
  probing: string | null;
  onProbe: (instance: InstanceInfo) => void;
  onPick: (instance: InstanceInfo, model: string) => void;
  onSettings: () => void;
  onApiKeys?: () => void;
  apiKeysLabel: string;
  onClose: () => void;
  startOn?: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>(() => startOn ? { kind: "provider", key: startOn } : { kind: "list" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [chosen, setChosen] = useState<Partial<Record<SignInFamily, string>>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => pickerGroups(instances, selection, chosen), [instances, selection, chosen]);
  const openGroup = page.kind === "list" ? undefined : groups.find((group) => group.key === page.key);

  useLayoutEffect(() => rove(bodyRef.current));

  useLayoutEffect(() => {
    if (page.kind !== "list") {
      bodyRef.current?.querySelector<HTMLElement>("[data-picker-back]")?.focus();
      return;
    }
    bodyRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
    if (!touchScreen()) searchRef.current?.focus();
  }, [page]);

  const back = () => setPage({ kind: "list" });
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });
  const chooseAccount = (group: PickerGroup, instanceId: string) => {
    if (group.family) setChosen((current) => ({ ...current, [group.family!]: instanceId }));
  };
  const openLocal = (group: PickerGroup) => {
    setPage({ kind: "local", key: group.key });
    onProbe(group.instance);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (page.kind !== "list") {
        event.preventDefault();
        event.stopPropagation();
        back();
      } else if (query) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        searchRef.current?.focus();
      } else {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      return;
    }
    if ((event.target as HTMLElement).tagName === "SELECT") return;
    if (event.target === searchRef.current) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusableItems(bodyRef.current)[0]?.focus();
      } else if (event.key === "Enter" && query.trim()) {
        event.preventDefault();
        bodyRef.current?.querySelector<HTMLButtonElement>("[data-model-row]")?.click();
      }
      return;
    }
    navigate(event, bodyRef.current, page.kind === "list" ? searchRef.current : null);
  };

  if (page.kind !== "list" && openGroup) {
    return (
      <div data-model-picker-page={page.kind} className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown} ref={bodyRef}>
        {page.kind === "provider"
          ? <ProviderPage group={openGroup} refreshing={refreshing} onRefresh={onRefresh} onBack={back} onAccount={(id) => chooseAccount(openGroup, id)} />
          : <LocalPage group={openGroup} selection={selection} botModel={botModel} probing={probing === openGroup.instance.instanceId} onPick={onPick} onBack={back} />}
      </div>
    );
  }

  const q = query.trim();
  const blocks = groups.flatMap((group) => {
    const currentModel = group.instance.instanceId === selection.instanceId ? selection.model : undefined;
    const { shown, more } = groupModels(group, query, expanded.has(group.key), currentModel);
    if (q && shown.length === 0 && !groupMatches(group, query)) return [];
    return [{ group, shown, more, currentModel }];
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline/40 py-1.5 pl-3 pr-1.5">
        <Search size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("model.search")}
          aria-label={t("model.search")}
          className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        <button type="button" onClick={onSettings} aria-label={t("settings.engines.title")} title={t("settings.engines.title")}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <Settings2 size={15} aria-hidden="true" />
        </button>
      </div>
      <div ref={bodyRef} data-model-list onFocus={(event) => rove(bodyRef.current, (event.target as HTMLElement).closest("[data-picker-item]"))}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1.5">
        {lead && !q && <div className="pt-1.5">{lead}</div>}
        {groups.length === 0 && <p className="px-4 py-5 text-[12.5px] text-ink-secondary">{t("model.noProviders")}</p>}
        {blocks.map(({ group, shown, more, currentModel }) => {
          const status = statusLabel(group);
          const update = group.instance.snapshot.update;
          const local = offersLocalModels(group.instance, group.local.length) && group.status !== "setup" && group.status !== "policy";
          return (
            <section key={group.key} data-model-group={group.key} aria-label={group.label}>
              <div className="sticky top-0 z-[1] flex min-h-9 items-center gap-1 bg-menu pb-0.5 pl-3 pr-1.5 pt-2">
                <button type="button" onClick={() => setPage({ kind: "provider", key: group.key })}
                  aria-label={t("model.providerDetails", { name: group.label })}
                  className={cn("group/head flex min-w-0 items-center gap-2.5 rounded-lg py-0.5 pr-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", group.status === "policy" && "opacity-60")}>
                  <span className={SLOT}><InstanceProviderMark instance={group.instance} size={15} /></span>
                  <span className="shrink-0 text-[12px] font-semibold text-ink">{group.label}</span>
                  <span className={cn("min-w-0 truncate text-[11px]", status ? "text-warning" : "text-ink-tertiary")}>{status ?? t(ACCESS_LABEL[group.access])}</span>
                  <ChevronRight size={13} className="shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover/head:opacity-100 group-focus-visible/head:opacity-100 touch:opacity-100" aria-hidden="true" />
                </button>
                <span className="min-w-0 flex-1" />
                {group.accounts.length > 1 && (
                  <Select size="sm" variant="ghost" aria-label={t("model.accountFor", { name: group.label })} value={group.instance.instanceId} className="min-w-0 max-w-[9rem]"
                    onChange={(event) => chooseAccount(group, event.target.value)}>
                    {group.accounts.map((account) => <option key={account.instanceId} value={account.instanceId}>{account.displayName}</option>)}
                  </Select>
                )}
                {group.status === "ready" && (
                  <button type="button" data-model-refresh disabled={refreshing} onClick={() => onRefresh(group.instance)}
                    aria-label={refreshing ? t("model.refreshing", { name: group.instance.displayName }) : t("model.refresh", { name: group.instance.displayName })}
                    title={t("model.refreshTitle")}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-tertiary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait">
                    {refreshing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
                  </button>
                )}
              </div>
              {update && !q && (
                <ActionRow data-model-update icon={<CircleArrowUp size={15} aria-hidden="true" />} tone="warning" label={update.title}
                  onClick={() => setPage({ kind: "provider", key: group.key })} />
              )}
              {group.status === "policy" && (
                <p data-policy-blocked className="px-3 pb-2 pl-[2.625rem] pr-4 text-[12px] leading-relaxed text-ink-secondary">{t("policy.modelBlocked", { organization: group.instance.policy!.organizationName })}</p>
              )}
              {group.status === "setup" && (
                <ActionRow data-model-setup icon={<Wrench size={14} aria-hidden="true" />} tone="accent" label={t("model.setUpProvider", { name: group.label })}
                  onClick={() => setPage({ kind: "provider", key: group.key })} />
              )}
              {group.status === "signIn" && (
                <ActionRow data-model-sign-in icon={<LogIn size={14} aria-hidden="true" />} tone="accent" label={t("model.signInProvider", { name: group.label })}
                  onClick={() => setPage({ kind: "provider", key: group.key })} />
              )}
              {shown.map((option) => (
                <ModelRow key={option.id} option={option} current={option.id === currentModel}
                  isDefault={option.id === group.instance.models.default && !option.custom}
                  botModel={botModel?.instanceId === group.instance.instanceId && botModel.model === option.id}
                  onPick={() => onPick(group.instance, option.id)} />
              ))}
              {group.status === "ready" && !q && shown.length === 0 && (
                <div className="flex items-center gap-2 px-3 pb-2 pl-[2.625rem] text-[12px] text-ink-secondary">
                  <span>{t("model.simple.noModels")}</span>
                  <button type="button" data-picker-item onClick={() => onRefresh(group.instance)} disabled={refreshing}
                    className="rounded-md px-1 font-medium text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60">
                    {t("common.checkAgain")}
                  </button>
                </div>
              )}
              {!q && (more > 0 || (expanded.has(group.key) && group.models.length > SUGGESTED_COUNT)) && (
                <ActionRow data-model-show-all icon={<ChevronDown size={14} className={cn("transition-transform", more === 0 && "rotate-180")} aria-hidden="true" />}
                  label={more > 0 ? t("model.showAll", { count: group.models.length }) : t("model.showSuggested")} chevron={false}
                  onClick={() => toggle(group.key)} />
              )}
              {!q && local && (
                <ActionRow data-model-local-entry icon={<HardDrive size={14} aria-hidden="true" />}
                  label={t("model.useLocal")} detail={group.local.length > 0 ? t("model.available", { count: group.local.length }) : undefined}
                  ariaLabel={group.local.length > 0 ? t("model.useLocalCount", { count: group.local.length }) : t("model.useLocal")}
                  disabled={needsCli(group.instance)} onClick={() => openLocal(group)} />
              )}
            </section>
          );
        })}
        {q && blocks.length === 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-ink-secondary">{t("model.noMatch", { query: q })}</p>
        )}
        {!q && onApiKeys && (
          <div className="mt-1 border-t border-hairline/40 pt-1">
            <ActionRow data-model-add-api-keys icon={<KeyRound size={14} aria-hidden="true" />} label={apiKeysLabel} onClick={onApiKeys} />
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeader({ group, title, onBack, children }: { group: PickerGroup; title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-hairline/40 py-1.5 pl-1.5 pr-1.5">
      <button type="button" data-picker-back onClick={onBack} aria-label={t("model.backToModels")} title={t("model.backToModels")}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <InstanceProviderMark instance={group.instance} size={15} className="shrink-0" />
      <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function ProviderPage({ group, refreshing, onRefresh, onBack, onAccount }: {
  group: PickerGroup;
  refreshing: boolean;
  onRefresh: (instance: InstanceInfo) => void;
  onBack: () => void;
  onAccount: (instanceId: string) => void;
}) {
  const instance = group.instance;
  const blocked = needsCli(instance) || needsSignIn(instance);
  const official = instance.models.options.filter((option) => !option.custom);
  const account = [instance.snapshot.account?.email, instance.snapshot.account?.organization].filter(Boolean).join(" · ");
  return (
    <>
      <PageHeader group={group} title={group.label} onBack={onBack}>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium", blocked ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>
          {needsCli(instance) ? t("model.setupRequired") : needsSignIn(instance) ? t("model.signInRequired") : instance.snapshot.version ?? t("model.ready")}
        </span>
        <button type="button" data-model-refresh disabled={refreshing} onClick={() => onRefresh(instance)}
          aria-label={refreshing ? t("model.refreshing", { name: instance.displayName }) : t("model.refresh", { name: instance.displayName })}
          title={t("model.refreshTitle")}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait">
          {refreshing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
        </button>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3.5 py-3 text-[12.5px] text-ink-secondary">
        {group.accounts.length > 1 && (
          <ClaudeAccountSelect accounts={group.accounts} selectedId={instance.instanceId} onSelect={(next) => onAccount(next.instanceId)} />
        )}
        {instance.snapshot.authenticated && account && <p className="truncate text-[12px]" title={account}>{account}</p>}
        {instance.snapshot.chatgptPlan && instance.snapshot.authenticated && <ChatGptPlanStatus key={instance.instanceId} instanceId={instance.instanceId} />}
        {instance.snapshot.update && <EngineUpdateNotice update={instance.snapshot.update} instance={instance} />}
        {instance.policy ? (
          <div data-policy-blocked className="leading-relaxed">
            <p className="font-medium text-ink">{t("policy.managedBy", { organization: instance.policy.organizationName })}</p>
            <p className="mt-1">{t("policy.modelBlocked", { organization: instance.policy.organizationName })}</p>
          </div>
        ) : blocked && (
          <>
            <EngineSetup instance={instance} intent="cloud" />
            {instance.claudeAccount && needsSignIn(instance) && (
              <p className="text-[11.5px] leading-relaxed">
                {instance.claudeAccount.signInShell === "powershell" && `${t("engines.account.powershell")} `}
                {t("engines.account.signInHint")}
              </p>
            )}
            <p className="text-center text-[11.5px] text-ink-tertiary">
              {instance.snapshot.chatgptPlan ? t("engineSetup.chatgpt.modelsAfterSignIn") : official.length > 0
                ? official.length === 1 ? t("model.afterSetupOne") : t("model.afterSetupMany", { count: official.length })
                : t("model.localSoon")}
            </p>
          </>
        )}
        {!blocked && !instance.policy && (
          <p className="text-[11.5px] leading-relaxed">{instance.access === "api" ? t("model.apiKeyHint") : group.access === "custom" ? t("model.localHint") : t("model.planHint")}</p>
        )}
      </div>
    </>
  );
}

function LocalPage({ group, selection, botModel, probing, onPick, onBack }: {
  group: PickerGroup;
  selection: ModelSelection;
  botModel?: Pick<ModelSelection, "instanceId" | "model">;
  probing: boolean;
  onPick: (instance: InstanceInfo, model: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const instance = group.instance;
  const custom = instance.models.options.filter((option) => option.custom);
  const { pinned, rest } = partitionCustomModels(filterCustomModels(custom, query));
  const row = (option: ModelOption) => (
    <ModelRow key={option.id} option={option} current={selection.instanceId === instance.instanceId && selection.model === option.id}
      isDefault={false} botModel={botModel?.instanceId === instance.instanceId && botModel.model === option.id}
      onPick={() => onPick(instance, option.id)} />
  );
  const looking = (
    <span role="status" className="flex items-center justify-center gap-2">
      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
      {t("model.lookingLocal")}
    </span>
  );
  return (
    <>
      <PageHeader group={group} title={t("model.localModelsFor", { name: group.label })} onBack={onBack} />
      {custom.length > SUGGESTED_COUNT && (
        <div className="flex shrink-0 items-center gap-1 border-b border-hairline/40 py-1.5 pl-3 pr-1.5">
          <Search size={15} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("model.search")} aria-label={t("model.searchLocal")}
            className="h-8 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none" />
        </div>
      )}
      <div className="min-h-[9rem] flex-1 overflow-y-auto overscroll-contain py-1.5">
        <p className="px-3.5 pb-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("model.localHint")}</p>
        {probing && custom.length > 0 && <div className="flex px-3.5 pb-1.5 text-[11.5px] text-ink-secondary">{looking}</div>}
        {pinned.length > 0 && <h4 className="px-3.5 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-tertiary">{t("model.loadedNow")}</h4>}
        {pinned.map(row)}
        {pinned.length > 0 && rest.length > 0 && <div className="mx-3.5 my-1.5 border-t border-hairline/40" role="separator" />}
        {rest.map(row)}
        {custom.length === 0 && (
          <div className="mx-3 rounded-xl border border-dashed border-hairline/50 px-3 py-5 text-center">
            {probing ? <div className="text-[12.5px] text-ink-secondary">{looking}</div> : (
              <>
                <div className="text-[12.5px] font-medium text-ink">{t("model.noLocal")}</div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{t("model.noLocalHint")}</div>
              </>
            )}
          </div>
        )}
        {custom.length > 0 && pinned.length + rest.length === 0 && (
          <p className="px-3.5 py-5 text-center text-[12.5px] text-ink-secondary">{t("model.noMatch", { query: query.trim() })}</p>
        )}
      </div>
    </>
  );
}
