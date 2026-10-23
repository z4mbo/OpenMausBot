import type { ComponentProps, CSSProperties } from "react";
import { PROFILE_AT_TOP } from "@/lib/origin-teams";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";
import { OriginAccountMenu } from "./OriginAccountMenu";

type IdentityProps = Pick<ComponentProps<typeof DesktopWorkspaceSwitcher>, "cloudHome" | "owner" | "howTo" | "onMenuClosed">;

// SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it as an inline style.
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

/** The empty rest of the slot stays part of the window's drag region. */
export function SidebarTitlebarSlot(props: IdentityProps) {
  return <div data-sidebar-top-slot className="@container/sidebar-top flex min-w-0 flex-1 items-center" style={PROFILE_AT_TOP ? undefined : NO_DRAG}>
    {PROFILE_AT_TOP ? <div data-sidebar-top-account className="flex min-w-0 max-w-full items-center" style={NO_DRAG}><OriginAccountMenu titlebar /></div>
      : <><div data-sidebar-top-spacer className="min-w-0 flex-1 @min-[96px]/sidebar-top:min-w-6" /><div data-sidebar-top-switcher className="flex min-w-0 max-w-[140px] items-center">
      <DesktopWorkspaceSwitcher inline {...props} />
    </div></>}
  </div>;
}

export function SidebarComputerRow({ style, ...props }: IdentityProps & { style?: CSSProperties }) {
  return <div data-sidebar-computer-row className="min-w-0" style={style}>
    <DesktopWorkspaceSwitcher {...props} />
  </div>;
}
