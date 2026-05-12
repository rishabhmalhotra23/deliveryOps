"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import {
  ThemeProvider as LatticeThemeProvider,
  SidebarProvider,
  SidebarInset,
} from "@kognitos/lattice";
import { ChatProvider } from "@/lib/chat/chat-context";
import { CommandPalette } from "./_components/command-palette";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <LatticeThemeProvider defaultTheme="light">
        <ChatProvider>
          <SidebarProvider>
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </ChatProvider>
        <CommandPalette />
      </LatticeThemeProvider>
    </NextThemesProvider>
  );
}
