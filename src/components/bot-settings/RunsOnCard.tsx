import { useState } from "react";
import { Cloud, Monitor, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import type { Bot } from "@/state/store";

type Host = { _id: string; name: string; kind: string; ownerName: string; mine: boolean; shared: boolean; online: boolean };
type RunsOn = { host: Host | null; canEdit: boolean };

const hostLabel = (host: Host) => host.mine
  ? t(host.kind === "server" ? "runsOn.yourServer" : "runsOn.yourComputer", { name: host.name })
  : t(host.kind === "server" ? "runsOn.theirServer" : "runsOn.theirComputer", { owner: host.ownerName, name: host.name });

/** Where a shared agent's messages run: each sender's own app, or one member's computer or an always-on server for everyone. */
export function RunsOnCard({ bot }: { bot: Bot }) {
  const shared = bot.shared;
  const current = useCloudQuery<RunsOn>("agentHosts:runsOn", shared ? { agentId: shared.agentId } : "skip");
  const hosts = useCloudQuery<Host[]>("agentHosts:list", shared ? { teamId: shared.teamId } : "skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!shared) return null;
  const chosen = current?.host?._id ?? null;
  const canEdit = current?.canEdit === true;
  const mine = hosts?.find((host) => host.mine && host.shared);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^[\s\S]*Uncaught Error: /, "").split("\n")[0]! : t("runsOn.saveError"));
    } finally {
      setBusy(false);
    }
  };
  const choose = (hostId: string | null) => void run(() => cloudMutation("agentHosts:setRunsOn", { agentId: shared.agentId, hostId }));

  const option = (id: string | null, icon: React.ReactNode, title: string, detail: string, status?: { online: boolean }) => (
    <button key={id ?? "sender"} type="button" role="radio" aria-checked={chosen === id} disabled={!canEdit || busy} onClick={() => choose(id)}
      className={cn("flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-(--motion-fast)",
        chosen === id ? "bg-raised ring-1 ring-accent/60" : "hover:bg-raised/60", (!canEdit || busy) && "cursor-default opacity-80")}>
      <span className="mt-0.5 text-ink-secondary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className="truncate">{title}</span>
          {status && <span className={cn("size-1.5 shrink-0 rounded-full", status.online ? "bg-green-500" : "bg-ink-tertiary")} aria-label={status.online ? t("runsOn.online") : t("runsOn.offline")} />}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-secondary">{detail}</span>
      </span>
    </button>
  );

  return (
    <div className="rounded-xl bg-card p-4" data-testid="access-runs-on">
      <div className="text-[15px] font-medium text-ink">{t("runsOn.title", { name: bot.name })}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("runsOn.body")}</p>
      <div className="mt-3 flex flex-col gap-1" role="radiogroup" aria-label={t("runsOn.title", { name: bot.name })}>
        {option(null, <Users size={15} />, t("runsOn.sender"), t("runsOn.senderDetail"))}
        {(hosts ?? []).map((host) => option(host._id, host.kind === "server" ? <Cloud size={15} /> : <Monitor size={15} />, hostLabel(host),
          host.mine ? t("runsOn.mineDetail") : t("runsOn.theirsDetail", { owner: host.ownerName }), { online: host.online }))}
      </div>
      {current?.host && !current.host.online && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("runsOn.offlineNote", { label: hostLabel(current.host) })}</p>}
      {!canEdit && current && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("runsOn.readOnly")}</p>}
      {mine && (
        <button type="button" disabled={busy} onClick={() => void run(() => cloudMutation("agentHosts:share", { hostId: mine._id, shared: false }))}
          className="mt-3 text-[12px] text-ink-secondary underline-offset-2 hover:text-ink hover:underline">
          {t("runsOn.stopSharing")}
        </button>
      )}
      {error && <p className="mt-2 text-[11.5px] text-danger" role="alert">{error}</p>}
    </div>
  );
}
