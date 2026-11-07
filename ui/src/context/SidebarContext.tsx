import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface SidebarContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  isMobile: boolean;
  isTablet: boolean;
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggleCollapsed: () => void;
  collapseLocked: boolean;
  peeking: boolean;
  setPeeking: (next: boolean) => void;
  // Legacy requests remain observable without affecting the global nav.
  forceCollapsed: boolean;
  setForceCollapsed: (next: boolean) => void;
  // Route-requested collapse retained for integration compatibility.
  routeRequestsCollapsed: boolean;
  setRouteRequestsCollapsed: (next: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export const PHONE_MEDIA_QUERY = "(max-width: 767px), (max-height: 430px) and (max-width: 1023px)";
export const TABLET_MEDIA_QUERY = "(min-width: 768px) and (max-width: 1023px) and (min-height: 431px)";

function matchesMedia(query: string) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() => matchesMedia(PHONE_MEDIA_QUERY));
  const isTablet = useMediaQuery(TABLET_MEDIA_QUERY);
  const [sidebarOpen, setSidebarOpen] = useState(() => !matchesMedia(PHONE_MEDIA_QUERY));

  const [routeRequestsCollapsed, setRouteRequestsCollapsed] = useState(false);
  const [forceCollapsed, setForceCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const phone = window.matchMedia(PHONE_MEDIA_QUERY);
    const onPhoneChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setSidebarOpen(!e.matches);
    };
    phone.addEventListener("change", onPhoneChange);
    return () => phone.removeEventListener("change", onPhoneChange);
  }, []);

  const collapsed = isTablet;
  const collapseLocked = isTablet;
  const peeking = false;
  const setCollapsed = useCallback((_next: boolean) => {}, []);
  const toggleCollapsed = useCallback(() => {}, []);
  const setPeeking = useCallback((_next: boolean) => {}, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      sidebarOpen,
      setSidebarOpen,
      toggleSidebar,
      isMobile,
      isTablet,
      collapsed,
      setCollapsed,
      toggleCollapsed,
      collapseLocked,
      peeking,
      setPeeking,
      forceCollapsed,
      setForceCollapsed,
      routeRequestsCollapsed,
      setRouteRequestsCollapsed,
    }),
    [
      sidebarOpen,
      toggleSidebar,
      isMobile,
      isTablet,
      collapsed,
      setCollapsed,
      toggleCollapsed,
      collapseLocked,
      peeking,
      setPeeking,
      forceCollapsed,
      routeRequestsCollapsed,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return ctx;
}
