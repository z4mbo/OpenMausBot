import { Bot, FileKey2, KeyRound, LockKeyhole, StickyNote } from "lucide-react";
import type { OriginChatCard } from "../../../shared/origin-chat-cards";
import { CardFrame, More, rowButton, useItemOpener } from "./CardFrame";

type Card = Extract<OriginChatCard, { kind: "vault" }>;

const KIND: Record<string, { label: string; icon: typeof KeyRound }> = {
  password: { label: "Password", icon: LockKeyhole },
  api_key: { label: "API key", icon: KeyRound },
  secret: { label: "Secret", icon: KeyRound },
  note: { label: "Secure note", icon: StickyNote },
  apk: { label: "Signing key", icon: FileKey2 },
  file: { label: "File", icon: FileKey2 },
};

/** Security: the payload holds no values, and this card never asks the vault for one. */
export function VaultCard({ card }: { card: Card }) {
  const opener = useItemOpener(card.projectId);
  const usable = card.items.filter((item) => item.agentUse).length;
  return (
    <CardFrame kind="vault" label="Vault entries" icon={LockKeyhole} title={`${card.items.length + (card.more ?? 0)} vault entr${card.items.length + (card.more ?? 0) === 1 ? "y" : "ies"}`}
      meta={[card.projectName, `${usable} usable by agents`].filter(Boolean).join(" · ")}
      openLabel="Open Vault" onOpen={() => opener.open({ kind: "vault" })} openable={opener.openable}>
      <ul className="mt-2 flex flex-col gap-0.5" aria-label="Entries">
        {card.items.map((item) => {
          const kind = KIND[item.kind] ?? KIND.secret!;
          const Icon = kind.icon;
          return (
            <li key={item.id}>
              <button type="button" className={rowButton} disabled={!opener.openable} title={opener.title} onClick={() => opener.open({ kind: "vault", itemId: item.id })}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised/60 text-ink-secondary"><Icon size={14} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-tertiary">{kind.label}</span>
                </span>
                {item.agentUse && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/12 px-1.5 py-px text-[11px] font-medium text-accent-text"><Bot size={11} aria-hidden="true" />Agents may use</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <More count={card.more} where="the Vault" />
    </CardFrame>
  );
}
