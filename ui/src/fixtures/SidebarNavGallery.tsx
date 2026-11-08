import { createRoot } from "react-dom/client";
import { Bot, Gavel, Inbox, LayoutDashboard } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CompanyProvider } from "@/context/CompanyContext";
import { SidebarProvider } from "@/context/SidebarContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarNavItem } from "@/components/SidebarNavItem";
import { primarySidebarStyles } from "@/components/primary-sidebar-styles";
import { cn } from "@/lib/utils";
import "@/index.css";

const GALLERY_THEMES = ["light", "dark"] as const;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function SidebarSample({ theme }: { theme: string }) {
  const id = (name: string) => `${theme}/${name}`;
  return (
    <section data-nav-theme={theme} className={cn(theme === "dark" && "dark", "bg-bg p-6 text-ink")}>
      <aside className={cn("w-60", primarySidebarStyles.surface)}>
        <nav className={primarySidebarStyles.nav} aria-label={id("nav")}>
          <div className={primarySidebarStyles.group}>
            <div data-nav-item={id("dashboard")} data-nav-expect="rest">
              <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} />
            </div>
            <div data-nav-item={id("inbox")} data-nav-expect="rest">
              <SidebarNavItem to="/inbox" label="Inbox" icon={Inbox} badge={12} />
            </div>
            <div data-nav-item={id("decisions")} data-nav-expect="active">
              <SidebarNavItem to="/decisions" label="Decisions" icon={Gavel} />
            </div>
            <div data-nav-item={id("agent.override-on")} data-nav-expect="active">
              <SidebarNavItem to="/agents/ada" label="Ada" icon={Bot} active />
            </div>
            <div data-nav-item={id("agent.override-off")} data-nav-expect="rest">
              <SidebarNavItem to="/decisions" label="Bob" icon={Bot} active={false} />
            </div>
          </div>
        </nav>
      </aside>
    </section>
  );
}

function Gallery() {
  return (
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <MemoryRouter initialEntries={["/decisions"]}>
      <CompanyProvider>
      <TooltipProvider>
        <SidebarProvider>
          <main data-nav-gallery-ready className="flex flex-col">
            {GALLERY_THEMES.map((theme) => <SidebarSample key={theme} theme={theme} />)}
          </main>
        </SidebarProvider>
      </TooltipProvider>
      </CompanyProvider>
    </MemoryRouter>
    </ThemeProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
