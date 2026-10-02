import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOptionalToastActions } from "../context/ToastContext";
import { CHROMELESS_DISPLAY_MODES, isChromelessDisplayMode } from "../lib/pwa-display-mode";
import { copyTextToClipboard } from "../lib/clipboard";

function ControlButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void | Promise<void>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={label}
          onClick={() => void onClick()}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function hasInAppHistory(state: unknown = typeof window === "undefined" ? null : window.history.state): boolean {
  const index = (state as { idx?: unknown } | null)?.idx;
  return typeof index === "number" && index > 0;
}

function useChromeless(): boolean {
  const [chromeless, setChromeless] = useState(() =>
    typeof window !== "undefined" ? isChromelessDisplayMode() : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => setChromeless(isChromelessDisplayMode());

    update();
    if (typeof window.matchMedia !== "function") return;

    const mediaQueries = CHROMELESS_DISPLAY_MODES.map((mode) => window.matchMedia(`(display-mode: ${mode})`));
    if (mediaQueries.every((media) => typeof media.addEventListener === "function")) {
      mediaQueries.forEach((media) => media.addEventListener("change", update));
      return () => mediaQueries.forEach((media) => media.removeEventListener("change", update));
    }

    mediaQueries.forEach((media) => media.addListener(update));
    return () => mediaQueries.forEach((media) => media.removeListener(update));
  }, []);

  return chromeless;
}

export function StandaloneBrowserControls({
  mobile,
  onNavigateHome,
}: {
  mobile: boolean;
  onNavigateHome?: () => void;
}) {
  const chromeless = useChromeless();
  const toastActions = useOptionalToastActions();

  const back = useCallback(() => {
    if (hasInAppHistory()) {
      window.history.back();
      return;
    }
    if (onNavigateHome) onNavigateHome();
    else window.location.assign("/dashboard");
  }, [onNavigateHome]);

  const refresh = useCallback(() => {
    window.location.reload();
  }, []);

  const share = useCallback(async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title || "Paperclip", url });
        return;
      }
      await copyTextToClipboard(url);
      toastActions?.pushToast({ title: "Link copied", tone: "success" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toastActions?.pushToast({ title: "Share failed", body: "Try opening the page in your browser.", tone: "error" });
    }
  }, [toastActions]);

  const openInBrowser = useCallback(() => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  }, []);

  if (!chromeless) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        mobile
          ? "h-10 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/85"
          : "h-9 border-b border-border px-2",
      )}
    >
      <ControlButton label="Back" onClick={back}>
        <ArrowLeft className="h-4 w-4" />
      </ControlButton>
      <div className="flex-1" />
      <ControlButton label="Refresh" onClick={refresh}>
        <RefreshCw className="h-4 w-4" />
      </ControlButton>
      <ControlButton label="Share" onClick={share}>
        <Share2 className="h-4 w-4" />
      </ControlButton>
      <ControlButton label="Open in Browser" onClick={openInBrowser}>
        <ExternalLink className="h-4 w-4" />
      </ControlButton>
    </div>
  );
}
