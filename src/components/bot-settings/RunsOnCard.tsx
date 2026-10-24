import { useState, type ReactNode } from "react";
import { Cloud, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { subscriptionLabel } from "@/lib/agent-subscription";
import { t } from "@/lib/i18n";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import type { Bot } from "@/state/store";
import type { AgentSubscription } from "../../../shared/agent-subscription";
import { MemberAvatar } from "../origin-members/MemberAvatar";
import { Switch } from "../SettingsPrimitives";

type Mode = "sender" | "member" | "cloud";
type Host = { _id: string; name: string; kind: string; ownerName: string; ownerAvatarUrl: string | null; mine: boolean; shared: boolean; online: boolean; plan: AgentSubscription | null };
type RunsOn = { mode: Mode; host: Host | null; canEdit: boolean };

const hostMode = (host: Host): Mode => host.kind === "local" ? "member" : "cloud";
const hostLabel = (host: Host) => host.mine
  ? t(host.kind === "local" ? "runsOn.yourComputer" : "runsOn.yourServer", { name: host.name })
  : t(host.kind === "local" ? "runsOn.theirComputer" : "runsOn.theirServer", { owner: host.ownerName, name: host.name });

const MODES: { mode: Mode; icon: ReactNode }[] = [
  { mode: "sender", icon: <Users size={15} /> },
  { mode: "member", icon: <UserRound size={15} /> },
  { mode: "cloud", icon: <Cloud size={15} /> },
];

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-tertiary">
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", online ? "bg-success" : "bg-ink-tertiary")} />
      {online ? t("runsOn.online") : t("runsOn.offline")}
    </span>
  );
}

/** Who answers a shared agent and whose subscription pays: each sender, one member who opted in, or an always-on server. */
export function RunsOnCard({ bot }: { bot: Bot }) {
  const shared = bot.shared;
  const current = useCloudQuery<RunsOn>("agentHosts:runsOn", shared ? { agentId: shared.agentId } : "skip");
  const hosts = useCloudQuery<Host[]>("agentHosts:list", shared ? { teamId: shared.teamId, agentId: shared.agentId } : "skip");
  const [opened, setOpened] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!shared) return null;
  const canEdit = current?.canEdit === true;
  const mode = opened ?? current?.mode ?? "sender";
  const chosen = current?.host?._id ?? null;
  const mine = (hosts ?? []).filter((host) => host.mine);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setOpened(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0]! : t("runsOn.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const choose = (hostId: string | null) => void run(() => cloudMutation("agentHosts:setRunsOn", { agentId: shared.agentId, hostId }));
  const pickMode = (next: Mode) => {
    if (next === "sender") {
      if (current?.mode !== "sender") choose(null);
      else setOpened(null);
      return;
    }
    setOpened(next);
  };

  const hostRow = (host: Host) => {
    const plan = subscriptionLabel(host.plan);
    return (
      <button key={host._id} type="button" role="radio" aria-checked={chosen === host._id} disabled={!canEdit || busy} onClick={() => choose(host._id)}
        data-runs-on-host={host._id}
        className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-(--motion-fast)",
          chosen === host._id ? "bg-control" : "enabled:hover:bg-control/60", (!canEdit || busy) && "cursor-default")}>
        {host.kind === "local"
          ? <MemberAvatar person={{ name: host.ownerName, email: "", avatarUrl: host.ownerAvatarUrl }} className="size-6 text-[10px]" />
          : <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inset text-ink-secondary"><Cloud size={13} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">{hostLabel(host)}</span>
          <span className="block truncate text-[11.5px] text-ink-secondary">
            {plan ?? t("runsOn.planUnknown")}{host.mine && !host.shared ? ` · ${t(canEdit ? "runsOn.notOfferedYet" : "runsOn.notOffered")}` : ""}
          </span>
        </span>
        <OnlineDot online={host.online} />
      </button>
    );
  };

  const candidates = (which: Exclude<Mode, "sender">) => (hosts ?? []).filter((host) => hostMode(host) === which);
  const hostList = (which: Exclude<Mode, "sender">) => {
    const list = candidates(which);
    return (
      <div className="ml-7 mt-1 flex flex-col gap-0.5" role="radiogroup" aria-label={t(`runsOn.mode.${which}.pick`)}>
        {list.map(hostRow)}
        {!list.length && <p className="px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{t(`runsOn.mode.${which}.empty`)}</p>}
        {which === "member" && list.length > 0 && <p className="px-2.5 pt-1 text-[11px] leading-relaxed text-ink-tertiary">{t("runsOn.mode.member.hint")}</p>}
      </div>
    );
  };

  return (
    <div className="rounded-xl bg-card p-4" data-testid="access-runs-on">
      <div className="text-[15px] font-medium text-ink">{t("runsOn.title", { name: bot.name })}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("runsOn.body")}</p>
      <div className="mt-3 flex flex-col gap-1" role="radiogroup" aria-label={t("runsOn.title", { name: bot.name })}>
        {MODES.map(({ mode: option, icon }) => (
          <div key={option} data-runs-on-mode={option}>
            <button type="button" role="radio" aria-checked={mode === option} aria-expanded={option === "sender" ? undefined : mode === option}
              disabled={!canEdit || busy} onClick={() => pickMode(option)}
              className={cn("flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-(--motion-fast)",
                mode === option ? "bg-raised ring-1 ring-accent/60" : "enabled:hover:bg-raised/60", (!canEdit || busy) && "cursor-default")}>
              <span className="mt-0.5 text-ink-secondary">{icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{t(`runsOn.mode.${option}.title`)}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-secondary">{t(`runsOn.mode.${option}.detail`)}</span>
                <span className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] leading-relaxed">
                  <span className="text-ink-tertiary">{t("runsOn.pays")}</span><span className="text-ink-secondary">{t(`runsOn.mode.${option}.pays`)}</span>
                  <span className="text-ink-tertiary">{t("runsOn.whenOffline")}</span><span className="text-ink-secondary">{t(`runsOn.mode.${option}.offline`)}</span>
                </span>
              </span>
            </button>
            {option !== "sender" && mode === option && hostList(option)}
          </div>
        ))}
      </div>
      {current?.host && !current.host.online && (
        <p className="mt-2 text-[11.5px] text-warning" role="status">{t("runsOn.offlineNote", { label: hostLabel(current.host) })}</p>
      )}
      {!canEdit && current && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("runsOn.readOnly")}</p>}
      {mine.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t border-hairline/40 pt-3">
          {mine.map((host) => (
            <div key={host._id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{t("runsOn.offer", { name: host.name })}</span>
              <Switch checked={host.shared} disabled={busy} aria-label={t("runsOn.offer", { name: host.name })}
                onClick={() => void run(() => cloudMutation("agentHosts:share", { hostId: host._id, shared: !host.shared }))} />
            </div>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("runsOn.offerDetail")}</p>
        </div>
      )}
      {error && <p className="mt-2 text-[11.5px] text-danger" role="alert">{error}</p>}
    </div>
  );
}
