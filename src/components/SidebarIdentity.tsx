import type { ComponentProps, CSSProperties } from "react";
import { PROFILE_AT_TOP } from "@/lib/origin-teams";
import { DesktopWorkspaceSwitcher } from "./DesktopWorkspaceSwitcher";
import { OriginAccountMenu } from "./OriginAccountMenu";

type IdentityProps = Pick<ComponentProps<typeof DesktopWorkspaceSwitcher>, "cloudHome" | "owner" | "howTo" | "onMenuClosed">;

export function SidebarTitlebarSlot(props: IdentityProps) {
  return <div data-sidebar-top-slot className="@container/sidebar-top flex min-w-0 flex-1 items-center">
    <div data-sidebar-top-spacer className="min-w-0 flex-1 @min-[96px]/sidebar-top:min-w-6" />
    {!PROFILE_AT_TOP && <div data-sidebar-top-switcher className="flex min-w-0 max-w-[140px] items-center">
      <DesktopWorkspaceSwitcher inline {...props} />
    </div>}
  </div>;
}

export function SidebarAccountRow({ style, ...props }: IdentityProps & { style?: CSSProperties }) {
  return <div data-sidebar-identity-row className="@container/sidebar-top relative flex min-w-0 items-center gap-2 px-3 pb-2" style={style}>
    <div data-sidebar-top-account className="flex min-w-0 flex-1 items-center"><OriginAccountMenu /></div>
    <div data-sidebar-top-switcher className="flex min-w-0 max-w-[min(140px,50%)] items-center">
      <DesktopWorkspaceSwitcher inline {...props} />
    </div>
  </div>;
}
