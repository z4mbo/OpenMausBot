import { useEffect, useState } from "react";
import { api } from "@/state/store";
import { BROADCAST_CHANNELS, type BroadcastAccount, type BroadcastChannel } from "../../../shared/broadcast";

export type ChannelAccounts = Record<BroadcastChannel, BroadcastAccount[]>;

export function accountsByChannel(accounts: readonly BroadcastAccount[]): ChannelAccounts {
  return Object.fromEntries(BROADCAST_CHANNELS.map((channel) => [channel, accounts.filter((account) => account.channels.includes(channel))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label))])) as ChannelAccounts;
}

/** The accounts this computer can publish with in `projectId`, reloaded when the window regains focus; null while loading. */
export function useBroadcastAccounts(projectId: string): ChannelAccounts | null {
  const [accounts, setAccounts] = useState<ChannelAccounts | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api<{ accounts: BroadcastAccount[] }>(`/api/origin/broadcast/accounts?projectId=${encodeURIComponent(projectId)}`)
      .then((body) => { if (live) setAccounts(accountsByChannel(body.accounts)); }, () => undefined);
    load();
    window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [projectId]);
  return accounts;
}
