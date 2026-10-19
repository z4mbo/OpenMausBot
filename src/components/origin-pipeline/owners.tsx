import type { ReactNode } from "react";
import { Bot as BotIcon } from "lucide-react";
import { PersonAvatar } from "../origin-pages/PersonAvatar";
import type { PipelineActor } from "../../../shared/origin-pipeline";
import { ownerKey } from "./pipeline-model";

export type OwnerOption = PipelineActor & { avatar: ReactNode };

export function OwnerAvatar({ owner, owners, size = 20 }: { owner?: PipelineActor; owners: readonly OwnerOption[]; size?: number }) {
  if (!owner) return null;
  const known = owners.find((option) => ownerKey(option) === ownerKey(owner));
  if (known) return <span title={`${owner.name}${owner.kind === "agent" ? " (agent)" : ""}`} className="flex shrink-0">{known.avatar}</span>;
  return owner.kind === "agent"
    ? <span title={`${owner.name} (agent)`} className="flex size-5 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary"><BotIcon size={12} /></span>
    : <span title={owner.name}><PersonAvatar person={{ name: owner.name, email: owner.name }} size={size} /></span>;
}
