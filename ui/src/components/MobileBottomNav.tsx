import { useMemo } from "react";
import { NavLink } from "@/lib/router";
import { House, CircleCheck, MessageCircle, Inbox, Menu } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { SIDEBAR_SCROLL_RESET_STATE } from "../lib/navigation-scroll";
import { cn } from "../lib/utils";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { useCombinedInboxTasksEnabled } from "@/hooks/useCombinedInboxTasksEnabled";
import { Badge } from "@/components/ui/badge";

interface MobileBottomNavProps {
  visible: boolean;
}

interface MobileNavLinkItem {
  to: string;
  label: string;
  icon: typeof House;
  badge?: number;
}

const itemClassName =
  "relative flex min-h-(--sz-calc-11) min-w-0 flex-col items-center justify-center gap-1 rounded-md text-(length:--text-nano) font-medium transition-colors";

export function MobileBottomNav({ visible }: MobileBottomNavProps) {
  const { selectedCompanyId } = useCompany();
  const { sidebarOpen, setSidebarOpen } = useSidebar();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { enabled: agentChatEnabled } = useAgentChatEnabled();
  const { enabled: combinedInboxTasksEnabled } = useCombinedInboxTasksEnabled();

  const links = useMemo<MobileNavLinkItem[]>(
    () => [
      { to: "/dashboard", label: "Home", icon: House },
      ...(combinedInboxTasksEnabled ? [] : [{ to: "/inbox", label: "Inbox", icon: Inbox, badge: inboxBadge.inbox }]),
      { to: "/issues", label: "Tasks", icon: CircleCheck, badge: combinedInboxTasksEnabled ? inboxBadge.inbox : undefined },
      ...(agentChatEnabled ? [{ to: "/chats", label: "Chat", icon: MessageCircle }] : []),
    ],
    [inboxBadge.inbox, agentChatEnabled, combinedInboxTasksEnabled],
  );

  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 bg-bg-3 pb-(--sz-safe-bottom)"
      data-visible={visible}
      inert={!visible}
      aria-label="Mobile navigation"
    >
      <div
        className="grid h-16 px-1"
        style={{ gridTemplateColumns: `repeat(${links.length + 1}, minmax(0, 1fr))` }}
      >
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              state={SIDEBAR_SCROLL_RESET_STATE}
              className={({ isActive }) => cn(itemClassName, isActive ? "text-ink" : "text-ink-3")}
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className={cn("h-(--sz-18px) w-(--sz-18px)", isActive && "stroke-(length:--sw-2_3)")} />
                    {item.badge != null && item.badge > 0 && (
                      <Badge variant="ghost" className="absolute -end-2 -top-2 bg-accent px-1.5 text-(length:--text-nano) leading-none text-accent-ink">
                        {item.badge > 99 ? "99+" : item.badge}
                      </Badge>
                    )}
                  </span>
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
        <button
          type="button"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
          className={cn(itemClassName, sidebarOpen ? "text-ink" : "text-ink-3")}
        >
          <Menu className="h-(--sz-18px) w-(--sz-18px)" />
          <span className="truncate">More</span>
        </button>
      </div>
    </nav>
  );
}
