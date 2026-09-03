import { useLocation } from "@tanstack/react-router";
import { MessageSquareText, ScrollText, Store } from "lucide-react";

import { ModeToggle } from "@latch-protocol/ui/components/mode-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@latch-protocol/ui/components/sidebar";

const NAV = [
  { href: "/", label: "Chat", Icon: MessageSquareText },
  { href: "/store", label: "Store", Icon: Store },
  { href: "/ledger", label: "Ledger", Icon: ScrollText },
] as const;

// Placeholder until the chat loop (#24) owns the live envelope. Same shape
// the builds will fill in: root id, spent vs per-tx cap, scope line.
const ENVELOPE = {
  root: "lch_root_7f3a",
  spent: "₹505.00",
  cap: "₹550.00",
  scope: "Footwear · SneakerHead India",
};

export function AppSidebar() {
  const { pathname } = useLocation();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-1 py-0.5 font-display text-[15px] font-semibold tracking-tight">
          Latch
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    isActive={pathname === href}
                    tooltip={label}
                    render={
                      <a href={href}>
                        <Icon aria-hidden />
                        <span>{label}</span>
                      </a>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator className="mx-0" />
        <SidebarGroup>
          <SidebarGroupContent>
            <div
              data-envelope-root={ENVELOPE.root}
              data-envelope-spent={ENVELOPE.spent}
              data-envelope-cap={ENVELOPE.cap}
              className="grid gap-1 px-2 py-1"
            >
              <div className="font-mono text-[11px] text-muted-foreground">{ENVELOPE.root}</div>
              <div className="font-display text-[22px] font-semibold tracking-tight tabular-nums">
                {ENVELOPE.spent}
                <span className="text-sm font-medium text-muted-foreground">
                  {" "}
                  of {ENVELOPE.cap}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{ENVELOPE.scope}</div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex justify-end px-1">
          <ModeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
