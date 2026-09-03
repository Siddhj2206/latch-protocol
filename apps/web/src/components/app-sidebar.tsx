import { useLocation } from "@tanstack/react-router";
import { MessageSquareText, ScrollText, Store, Wallet } from "lucide-react";

import { ModeToggle } from "@latch-protocol/ui/components/mode-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
  scope: "footwear · mer_sneakerhead",
};

export function AppSidebar() {
  const { pathname } = useLocation();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-1 py-0.5">
          <div className="text-sm font-semibold tracking-tight">LATCH</div>
          <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {"// risk protocol"}
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Surfaces</SidebarGroupLabel>
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
        <SidebarGroup>
          <SidebarGroupLabel>Envelope</SidebarGroupLabel>
          <SidebarGroupContent>
            <div
              data-envelope-root={ENVELOPE.root}
              data-envelope-spent={ENVELOPE.spent}
              data-envelope-cap={ENVELOPE.cap}
              className="grid gap-1 px-2 py-1 text-xs"
            >
              <div className="flex items-center gap-1.5 font-medium">
                <Wallet className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-mono text-[11px]">{ENVELOPE.root}</span>
              </div>
              <div className="text-muted-foreground">
                spent <span className="font-medium text-foreground">{ENVELOPE.spent}</span> of{" "}
                {ENVELOPE.cap}
              </div>
              <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                {ENVELOPE.scope}
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between px-1">
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            theme
          </span>
          <ModeToggle />
        </div>
        <SidebarSeparator className="mx-0 my-2" />
        <div className="halftone halftone-fade h-8 opacity-60" aria-hidden />
      </SidebarFooter>
    </Sidebar>
  );
}
