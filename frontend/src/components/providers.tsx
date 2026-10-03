"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nProvider } from "@/lib/i18n/context";
import { AuthProvider } from "@/lib/auth/context";
import { IdleSessionGuard } from "@/lib/auth/idle-session";
import { ThemeProvider } from "@/lib/theme/context";
import { UiStyleProvider } from "@/lib/ui-style/context";
import { CalendarProvider } from "@/lib/calendar/context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UiStyleProvider>
          <CalendarProvider>
            <I18nProvider>
              <AuthProvider>
                <IdleSessionGuard />
                {children}
              </AuthProvider>
            </I18nProvider>
          </CalendarProvider>
        </UiStyleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
