"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { I18nProvider } from "@/lib/i18n/context";
import { AuthProvider } from "@/lib/auth/context";
import { IdleSessionGuard } from "@/lib/auth/idle-session";
import { OnlinePresence } from "@/components/domain/online-users";
import { ThemeProvider } from "@/lib/theme/context";
import { UiStyleProvider } from "@/lib/ui-style/context";
import { CalendarProvider } from "@/lib/calendar/context";
import { DialogProvider } from "@/lib/dialog";
import { FormulaRuntime } from "@/lib/formulas";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const qc: QueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      });
    return qc;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UiStyleProvider>
          <CalendarProvider>
            <I18nProvider>
              <DialogProvider>
                <AuthProvider>
                  <FormulaRuntime>
                    <IdleSessionGuard />
                    <OnlinePresence />
                    {children}
                  </FormulaRuntime>
                </AuthProvider>
              </DialogProvider>
            </I18nProvider>
          </CalendarProvider>
        </UiStyleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
