import { Toaster } from "@latch-protocol/ui/components/sonner";
import { ThemeProvider } from "@latch-protocol/ui/components/theme-provider";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@latch-protocol/ui/components/sidebar";
import { TooltipProvider } from "@latch-protocol/ui/components/tooltip";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { AppSidebar } from "../components/app-sidebar";

import appCss from "../index.css?url";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Latch Protocol",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="latch-theme">
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <header className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
                  <SidebarTrigger />
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <Outlet />
                </div>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
          <Toaster richColors />
        </ThemeProvider>
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
