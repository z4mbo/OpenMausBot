import type { ReactNode } from "react";
import { Brush } from "lucide-react";
import { useCloudSession } from "@/lib/origin-cloud";
import type { Bot } from "@/state/store";
import { ProjectCanvases } from "../OriginDraw";
import { EmptyState } from "../origin-pages/ui";

export function StudioDesign({ projectId, teamId, canEdit, agent, switcher }: { projectId: string; teamId: string | undefined; canEdit: boolean; agent: Bot; switcher: ReactNode }) {
  const session = useCloudSession();
  return (
    <section aria-label="Design" data-studio-design className="flex min-h-0 min-w-0 flex-1 flex-col bg-app">
      {session.user && teamId
        ? <ProjectCanvases key={projectId} projectId={projectId} teamId={teamId} userId={session.user._id} canEdit={canEdit} agent={agent} switcher={switcher} />
        : (
          <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]">
            <div className="flex h-12 shrink-0 items-center px-3 md:px-4">{switcher}</div>
            <EmptyState icon={<Brush size={22} />} title="Share this project to design together" />
          </div>
        )}
    </section>
  );
}
