"use client";

import { ThemeProvider, SidebarProvider, SidebarInset } from "@kognitos/lattice";
import { ChatProvider } from "@/lib/chat/chat-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="light">
      <ChatProvider>
        <SidebarProvider>
          {/* Add <AppSidebar /> here in Phase 1 */}
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </ChatProvider>
    </ThemeProvider>
  );
}
