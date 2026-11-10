import * as React from "react";
import { StrictMode } from "react";
import * as ReactDOM from "react-dom";
import { BrowserRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SentryGate } from "./components/SentryGate";
import { CompanyProvider, useCompany } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { NotificationRuntime } from "./components/NotificationRuntime";
import { PwaRuntime } from "./components/PwaRuntime";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { PanelProvider } from "./context/PanelContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { EditorAutocompleteProvider } from "./context/EditorAutocompleteContext";
import { PrimaryAgentProvider } from "./context/PrimaryAgentProvider";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initPluginBridge } from "./plugins/bridge-init";
import { PluginLauncherProvider } from "./plugins/launchers";
import { startPerfMeasureReaper } from "./lib/perf-measure-reaper";
import { getOrCreateWardmoteReactRoot } from "./lib/react-root";
import { startServiceWorkerUpdates } from "./lib/service-worker-updates";
import { serviceWorkerBuildIdFromFileName } from "./lib/service-worker-build-id";
import { captureInstallPrompt, recordAppVisit } from "./lib/pwa-install-prompt";
import "./index.css";

initPluginBridge(React, ReactDOM);

// React 19.2 emits an unbounded stream of performance.measure() entries for its
// DevTools performance tracks and never clears them; on a long-lived tab they
// accumulate into millions of native objects (GBs). Reap them periodically.
startPerfMeasureReaper();

captureInstallPrompt();
recordAppVisit();
window.addEventListener("load", () => {
  startServiceWorkerUpdates({ pageBuildId: serviceWorkerBuildIdFromFileName(new URL(import.meta.url).pathname) });
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Explicit so cross-tab-published cache entries for resources this tab
      // isn't observing get collected promptly rather than lingering. Single
      // tuning point if we need to trim the cache footprint further.
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst",
    },
    mutations: {
      networkMode: "always",
    },
  },
});

function CompanyAwareBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const { selectedCompany } = useCompany();
  return <BreadcrumbProvider companyName={selectedCompany?.name ?? null}>{children}</BreadcrumbProvider>;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Wardmote root element is missing");

getOrCreateWardmoteReactRoot(window, rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SentryGate />
        <ThemeProvider>
          <BrowserRouter>
            <CompanyProvider>
              <EditorAutocompleteProvider>
                <ToastProvider>
                  <PrimaryAgentProvider>
                  <LiveUpdatesProvider>
                    <NotificationRuntime />
                    <PwaRuntime />
                    <TooltipProvider>
                      <CompanyAwareBreadcrumbProvider>
                        <SidebarProvider>
                          <PanelProvider>
                            <PluginLauncherProvider>
                              <DialogProvider>
                                <App />
                              </DialogProvider>
                            </PluginLauncherProvider>
                          </PanelProvider>
                        </SidebarProvider>
                      </CompanyAwareBreadcrumbProvider>
                    </TooltipProvider>
                  </LiveUpdatesProvider>
                  </PrimaryAgentProvider>
                </ToastProvider>
              </EditorAutocompleteProvider>
            </CompanyProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
);
