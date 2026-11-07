import { useLocation } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { MootMark } from "./MootMark";
import { useDialogState } from "../context/DialogContext";
import {
  promptInstall,
  setIosInstallHelpOpen,
  snoozeInstallNudge,
  useInstallAvailability,
  useInstallNudgeVisible,
} from "../lib/pwa-install-prompt";

export function InstallNudge() {
  const { pathname } = useLocation();
  const availability = useInstallAvailability();
  const visible = useInstallNudgeVisible(pathname);
  const { onboardingOpen } = useDialogState();
  if (!visible || onboardingOpen) return null;

  const install = () => {
    if (availability === "ios-manual") setIosInstallHelpOpen(true);
    else void promptInstall();
  };

  return (
    <section
      role="region"
      aria-label="Install Wardmote"
      className="flex flex-wrap items-center gap-3 rounded-(--r-lg) border border-line bg-bg-2 p-4"
    >
      <MootMark className="size-7 shrink-0 text-ink" aria-hidden="true" />
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink">Install Wardmote</span>
        <span className="text-sm text-ink-3">Opens in its own window and can notify you when an agent needs a decision.</span>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => snoozeInstallNudge()}>
          Not now
        </Button>
        <Button type="button" size="sm" onClick={install}>
          Install
        </Button>
      </div>
    </section>
  );
}
