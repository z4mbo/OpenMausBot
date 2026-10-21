import { useState, type ReactNode } from "react";
import { useStore } from "@/state/store";
import { NEW_PROJECT_DIALOG } from "@/lib/origin-teams";
import { useActiveOriginWorkspace, useCanCreateProject } from "@/lib/use-origin-workspace";
import { LaunchpadDialog } from "./LaunchpadDialog";

/** The new-project flow of a shared workspace opens on Launchpad; "Set up manually" falls through to `children`, the full dialog. */
export function LaunchpadFirst({ enabled, onClose, children }: { enabled: boolean; onClose?(): void; children: ReactNode }) {
  const { dispatch } = useStore();
  const { teamId } = useActiveOriginWorkspace();
  const canCreate = useCanCreateProject(teamId);
  const [manual, setManual] = useState(false);
  if (!NEW_PROJECT_DIALOG || !enabled || !teamId || canCreate === false || manual) return children;
  return <LaunchpadDialog target={{ kind: "new", onManual: () => setManual(true) }} onClose={onClose ?? (() => dispatch({ type: "toggleNewBot", open: false }))} />;
}
