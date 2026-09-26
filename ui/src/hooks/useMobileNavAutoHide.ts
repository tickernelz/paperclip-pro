import { useCallback, useEffect, useRef, useState } from "react";
import { classifyShellRoute } from "@/lib/shell-navigation";

const TOP_ZONE_PX = 24;
const DELTA_PX = 8;

/** Bottom-nav visibility; the nav never auto-hides on the task thread, where it docks the composer. */
export function useMobileNavAutoHide(
  pathname: string,
  companyPrefix: string | undefined,
  isMobile: boolean,
): boolean {
  const autoHides =
    isMobile && !classifyShellRoute(pathname, companyPrefix).isTaskDetail;
  const lastScrollTop = useRef(0);
  const [visible, setVisible] = useState(true);

  const update = useCallback((currentTop: number) => {
    const delta = currentTop - lastScrollTop.current;
    lastScrollTop.current = currentTop;
    if (currentTop <= TOP_ZONE_PX) setVisible(true);
    else if (delta > DELTA_PX) setVisible(false);
    else if (delta < -DELTA_PX) setVisible(true);
  }, []);

  useEffect(() => {
    lastScrollTop.current = 0;
    if (!autoHides) {
      setVisible(true);
      return;
    }
    const onScroll = () => {
      update(window.scrollY || document.documentElement.scrollTop || 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [autoHides, pathname, update]);

  return visible;
}
