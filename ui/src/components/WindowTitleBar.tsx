import { useSyncExternalStore, type CSSProperties } from "react";
import { Link } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { MootMark } from "./MootMark";

type WindowControlsOverlay = EventTarget & { visible: boolean };

function overlay(): WindowControlsOverlay | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay ?? null;
}

function subscribe(listener: () => void) {
  const target = overlay();
  target?.addEventListener("geometrychange", listener);
  return () => target?.removeEventListener("geometrychange", listener);
}

export function useWindowControlsOverlayVisible(): boolean {
  return useSyncExternalStore(subscribe, () => overlay()?.visible === true, () => false);
}

const DRAG = { WebkitAppRegion: "drag", appRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag", appRegion: "no-drag" } as CSSProperties;

function TitleBarContent() {
  const { selectedCompanyId } = useCompany();
  const { inbox } = useInboxBadge(selectedCompanyId);
  return (
    <div
      data-slot="window-titlebar"
      className="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-3 text-xs text-ink-2"
      style={{
        ...DRAG,
        marginLeft: "env(titlebar-area-x, 0px)",
        width: "env(titlebar-area-width, 100%)",
        height: "env(titlebar-area-height, 33px)",
      }}
    >
      <MootMark className="size-4 shrink-0 text-ink" aria-hidden="true" />
      <span className="font-semibold text-ink">Wardmote</span>
      <Link
        to="/inbox"
        style={NO_DRAG}
        className="ml-1 inline-flex items-center gap-1 rounded-(--r-sm) px-1.5 py-0.5 hover:bg-bg-3 hover:text-ink"
        aria-label={inbox > 0 ? `Inbox, ${inbox} waiting` : "Inbox"}
      >
        Inbox
        {inbox > 0 ? (
          <span className="rounded-(--r-pill) bg-accent px-1.5 text-(length:--text-micro) font-semibold text-accent-ink tabular-nums">{inbox}</span>
        ) : null}
      </Link>
    </div>
  );
}

export function WindowTitleBar() {
  return useWindowControlsOverlayVisible() ? <TitleBarContent /> : null;
}
