import { Cloud } from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPACT_BUBBLE } from "@/lib/compact-chip";
import { subscriptionLabel, useLocalSubscription } from "@/lib/agent-subscription";
import { t } from "@/lib/i18n";
import { useCloudQuery, useCloudSession } from "@/lib/origin-cloud";
import type { Bot } from "@/state/store";
import type { AgentSubscription } from "../../shared/agent-subscription";
import { MemberAvatar } from "./origin-members/MemberAvatar";

export interface RunsOnBadgeProps {
  /** "member": a person's computer and subscription; "cloud": an always-on server. */
  kind: "member" | "cloud";
  /** The person or, for cloud, the server's name. */
  name: string;
  /** The person is the one reading: the badge says "You". */
  you?: boolean;
  avatarUrl?: string | null;
  /** "Claude Max", "ChatGPT Plus", "OpenRouter key". */
  subscription?: string | null;
  offline?: boolean;
}

function badgeText({ kind, name, you, subscription }: RunsOnBadgeProps): string {
  const who = kind === "cloud" ? t("runsOn.badge.cloud") : you ? t("runsOn.badge.you") : name;
  return subscription && kind === "member" ? `${who} · ${subscription}` : who;
}

function badgeDescription(props: RunsOnBadgeProps): string {
  const subscription = props.subscription ?? "";
  const runner = props.kind === "cloud" ? t("runsOn.badge.cloudTitle", { name: props.name })
    : props.you ? t(subscription ? "runsOn.badge.youTitle" : "runsOn.badge.youTitleNoPlan", { subscription })
    : t(subscription ? "runsOn.badge.memberTitle" : "runsOn.badge.memberTitleNoPlan", { name: props.name, subscription });
  const plan = props.kind === "cloud" && props.subscription ? ` ${t("runsOn.badge.cloudPlan", { subscription: props.subscription })}` : "";
  return `${runner}${plan}${props.offline ? ` ${t("runsOn.badge.offline")}` : ""}`;
}

/** Whose computer and subscription answer this agent, for the chat header. */
export function RunsOnBadge(props: RunsOnBadgeProps) {
  const description = badgeDescription(props);
  return (
    <span role="note" data-testid="runs-on-badge" data-runs-on-kind={props.kind} title={description} aria-label={description}
      className={cn("flex min-w-0 max-w-[220px] shrink items-center gap-1.5 rounded-full border border-hairline/40 bg-raised/60 py-1 pl-1 pr-2.5 text-[12px] text-ink-secondary",
        COMPACT_BUBBLE)}>
      <span className="relative flex shrink-0">
        {props.kind === "cloud"
          ? <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-inset text-ink-secondary"><Cloud size={12} /></span>
          : <MemberAvatar person={{ name: props.name, email: "", avatarUrl: props.avatarUrl }} className="size-5 text-[9px]" />}
        {props.offline && <span aria-hidden="true" data-testid="runs-on-offline" className="absolute -bottom-px -right-px size-2 rounded-full bg-ink-tertiary ring-2 ring-raised" />}
      </span>
      <span aria-hidden="true" className={cn("min-w-0 truncate @max-4xl/chathead:hidden", props.offline && "text-ink-tertiary")}>{badgeText(props)}</span>
    </span>
  );
}

type RunsOnHost = { name: string; kind: string; ownerName: string; ownerAvatarUrl: string | null; mine: boolean; online: boolean; plan: AgentSubscription | null };
type RunsOnAnswer = { mode: "sender" | "member" | "cloud"; host: RunsOnHost | null };

/** The badge for a shared agent: who answers the person reading this chat, and on whose subscription. */
export function SharedAgentRunsOn({ bot }: { bot: Bot }) {
  const shared = bot.shared;
  const runsOn = useCloudQuery<RunsOnAnswer>("agentHosts:runsOn", shared ? { agentId: shared.agentId } : "skip");
  const { user } = useCloudSession();
  const instanceId = (bot.tasks?.find((task) => task.threadId === bot.threadId)?.modelSelection ?? bot.modelSelection)?.instanceId;
  const host = runsOn?.host ?? null;
  const yours = useLocalSubscription(instanceId, Boolean(shared && runsOn && (!host || host.mine)));
  if (!shared || !runsOn) return null;
  if (runsOn.mode === "cloud" && host) {
    return <RunsOnBadge kind="cloud" name={host.name} subscription={subscriptionLabel(host.plan)} offline={!host.online} />;
  }
  if (host && !host.mine) {
    return <RunsOnBadge kind="member" name={host.ownerName} avatarUrl={host.ownerAvatarUrl} subscription={subscriptionLabel(host.plan)} offline={!host.online} />;
  }
  return <RunsOnBadge kind="member" you name={user?.name || user?.email || t("runsOn.badge.you")} avatarUrl={user?.avatarUrl} subscription={subscriptionLabel(yours ?? host?.plan)} />;
}
