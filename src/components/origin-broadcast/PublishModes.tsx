import { Megaphone, Send, Target } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import type { PublishMode } from "@/lib/origin-publish-mode";
import type { PipelineBoard } from "../../../shared/origin-pipeline";
import { Segmented } from "../origin-pages/ui";

export function PublishModes({ projectId, value, onChange }: { projectId: string; value: PublishMode; onChange(mode: PublishMode): void }) {
  const board = useCloudQuery<PipelineBoard>("pipeline:board", { projectId });
  const unread = board?.leads.filter((lead) => lead.unreadReplies).length ?? 0;
  return (
    <Segmented label="Publish section" value={value} onChange={onChange} options={[
      { value: "posts", label: <><Send size={13} />Posts</> },
      { value: "campaigns", label: <><Megaphone size={13} />Campaigns</> },
      { value: "sales", title: "Contacts, conversations and deals", label: <><Target size={13} />Sales
        {unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold tabular-nums text-accent-ink" aria-label={`${unread} unread`}>{unread}</span>}</> },
    ]} />
  );
}
