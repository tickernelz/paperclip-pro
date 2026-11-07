import type { ReactNode } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  promptInstall,
  setIosInstallHelpOpen,
  useInstallAvailability,
  useIosInstallHelpOpen,
} from "../lib/pwa-install-prompt";

interface InstallAppMenuActionProps {
  variant: "menu-action" | "compact-menu-action";
  onAfterAction?: () => void;
}

const LABEL = "Install app";
const DESCRIPTION = "Add Wardmote to your home screen or dock.";

export function InstallAppMenuAction({ variant, onAfterAction }: InstallAppMenuActionProps) {
  const availability = useInstallAvailability();

  if (availability === "installed" || availability === "unavailable") return null;

  const handleClick = () => {
    if (availability === "ios-manual") setIosInstallHelpOpen(true);
    else void promptInstall();
    onAfterAction?.();
  };

  if (variant === "compact-menu-action") {
    return (
      <button
        type="button"
        className="flex h-(--profile-popover-row-height) w-full items-center gap-(--profile-popover-row-gap) rounded-lg px-2.5 text-left text-(length:--text-compact) font-medium leading-(--profile-popover-label-line-height) text-ink transition-colors hover:bg-bg-3"
        onClick={handleClick}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-ink-3">
          <Download className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{LABEL}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-bg-3/60"
      onClick={handleClick}
    >
      <span className="mt-0.5 rounded-lg border border-line bg-bg/70 p-2 text-ink-3">
        <Download className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{LABEL}</span>
        <span className="block text-xs text-ink-3">{DESCRIPTION}</span>
      </span>
    </button>
  );
}

export function IosInstallHelpDialog() {
  const open = useIosInstallHelpOpen();
  return (
    <Dialog open={open} onOpenChange={setIosInstallHelpOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install Wardmote</DialogTitle>
          <DialogDescription>Add Wardmote to your Home Screen from Safari.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm text-ink">
          <InstallStep index={1} icon={<Share className="size-4" />}>
            Tap <strong>Share</strong> in the Safari toolbar.
          </InstallStep>
          <InstallStep index={2} icon={<SquarePlus className="size-4" />}>
            Choose <strong>Add to Home Screen</strong>.
          </InstallStep>
          <InstallStep index={3}>
            Keep <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.
          </InstallStep>
        </ol>
        <DialogFooter>
          <Button type="button" onClick={() => setIosInstallHelpOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstallStep({ index, icon, children }: { index: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-ink-3">
        {index}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon ? <span className="text-ink-3">{icon}</span> : null}
        <span>{children}</span>
      </span>
    </li>
  );
}
