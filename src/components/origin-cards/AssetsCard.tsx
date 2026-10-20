import { FileText, FolderOpen } from "lucide-react";
import type { OriginChatCard } from "../../../shared/origin-chat-cards";
import { CardFrame, More, useItemOpener } from "./CardFrame";
import { MediaView } from "./MediaView";

type Card = Extract<OriginChatCard, { kind: "assets" }>;

export function AssetsCard({ card }: { card: Card }) {
  const opener = useItemOpener(card.projectId);
  const single = card.assets.length === 1 ? card.assets[0]! : null;
  return (
    <CardFrame kind="assets" label={`Assets: ${card.heading}`} icon={FolderOpen} title={card.heading} meta={card.projectName}
      openLabel="Open in Assets" onOpen={() => opener.open({ kind: "asset", ...(single ? { itemId: single.id } : {}) })} openable={opener.openable}>
      <ul className={single ? "mt-2.5" : "mt-2.5 grid grid-cols-3 gap-1.5"} aria-label="Assets">
        {card.assets.map((asset) => (
          <li key={asset.id} className="min-w-0">
            <button type="button" disabled={!opener.openable} title={opener.title ?? asset.name} onClick={() => opener.open({ kind: "asset", itemId: asset.id })}
              className="group block w-full min-w-0 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <span className="block overflow-hidden rounded-xl transition-transform duration-(--motion-fast) group-active:scale-[0.98]">
                {asset.kind === "other"
                  ? <span className={`flex w-full items-center justify-center bg-raised/50 text-ink-tertiary ${single ? "h-24" : "aspect-square"}`}><FileText size={18} aria-hidden="true" /></span>
                  : <MediaView media={{ name: asset.name, kind: asset.kind, url: asset.url }} controls={Boolean(single)} className={single ? "max-h-72 w-full" : "aspect-square w-full"} />}
              </span>
              <span className="mt-1 block truncate px-0.5 text-[12px] text-ink-secondary group-hover:text-ink">{asset.name}</span>
              {single && <span className="block truncate px-0.5 text-[11.5px] capitalize text-ink-tertiary">{[asset.type, asset.folder].filter(Boolean).join(" · ")}</span>}
            </button>
          </li>
        ))}
      </ul>
      <More count={card.more} where="Assets" />
    </CardFrame>
  );
}
