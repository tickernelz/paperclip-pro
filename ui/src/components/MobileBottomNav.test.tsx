// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav";

const flags = vi.hoisted(() => ({ agentChat: true, combined: false }));
const sidebar = vi.hoisted(() => ({ sidebarOpen: false, setSidebarOpen: vi.fn() }));

vi.mock("@/lib/router", () => ({
  NavLink: ({ to, className, children }: {
    to: string;
    className: (state: { isActive: boolean }) => string;
    children: (state: { isActive: boolean }) => ReactNode;
  }) => <a href={to} className={className({ isActive: false })}>{children({ isActive: false })}</a>,
}));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => sidebar }));
vi.mock("../hooks/useInboxBadge", () => ({ useInboxBadge: () => ({ inbox: 3, failedRuns: 0 }) }));
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: flags.agentChat }) }));
vi.mock("@/hooks/useCombinedInboxTasksEnabled", () => ({ useCombinedInboxTasksEnabled: () => ({ enabled: flags.combined }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MobileBottomNav", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    flags.agentChat = true;
    flags.combined = false;
    sidebar.setSidebarOpen.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () => act(() => root.render(<MobileBottomNav visible />));
  const labels = () => [...container.querySelectorAll("a, button")].map((item) => item.textContent);

  it("shows Home, Inbox, Tasks, Chat and More with the unread badge on Inbox", () => {
    render();
    expect(labels()).toEqual(["Home", "3Inbox", "Tasks", "Chat", "More"]);
    act(() => container.querySelector("button")!.click());
    expect(sidebar.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  it("drops Inbox and moves its badge to Tasks when Inbox lives inside Tasks", () => {
    flags.combined = true;
    render();
    expect(labels()).toEqual(["Home", "3Tasks", "Chat", "More"]);
    expect(container.querySelector('a[href="/inbox"]')).toBeNull();
  });
});
