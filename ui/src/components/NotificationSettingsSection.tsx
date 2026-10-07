import { useCallback, useEffect, useId, useState } from "react";
import { Bell, LoaderCircle, Play, Send, Trash2, Upload } from "lucide-react";
import { NOTIFICATION_KINDS, type NotificationKind } from "@tickernelz/paperclip-pro-shared";
import { notificationsApi } from "@/api/notifications";
import {
  isIosWithoutHomeScreenInstall,
  notificationPermission,
  pushSupported,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/lib/notifications/browser";
import {
  loadCustomSound,
  removeCustomSound,
  saveCustomSound,
  subscribeCustomSounds,
  validateCustomSoundFile,
} from "@/lib/notifications/custom-sounds";
import { playSound } from "@/lib/notifications/player";
import { syncPushSubscription, usePushState, type PushStatus } from "@/lib/notifications/push";
import {
  getNotificationSettings,
  setNotificationSettings,
  updateKindSettings,
  useNotificationSettings,
} from "@/lib/notifications/settings";
import {
  CUSTOM_SOUND_ID,
  DEFAULT_KIND_SOUNDS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_SOUNDS,
  SILENT_SOUND_ID,
} from "@/lib/notifications/sounds";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

const PERMISSION_LABELS: Record<NotificationPermissionState, string> = {
  granted: "Allowed",
  denied: "Blocked in browser settings",
  default: "Not requested yet",
  unsupported: "Not supported in this browser",
};

const PUSH_STATUS_LABELS: Record<PushStatus, string> = {
  unknown: "Checking…",
  active: "Active on this device",
  off: "Off",
  unsupported: "Not supported in this browser",
  permission: "Waiting for notification permission",
  "server-disabled": "Not available on this server",
  error: "Subscription failed",
};

type CustomSoundNames = Partial<Record<NotificationKind, string>>;

function useCustomSoundNames(): CustomSoundNames {
  const [names, setNames] = useState<CustomSoundNames>({});
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void Promise.all(NOTIFICATION_KINDS.map(async (kind) => [kind, (await loadCustomSound(kind))?.name] as const)).then(
        (entries) => {
          if (cancelled) return;
          const next: CustomSoundNames = {};
          for (const [kind, name] of entries) if (name) next[kind] = name;
          setNames(next);
        },
      );
    };
    refresh();
    const unsubscribe = subscribeCustomSounds(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return names;
}

function KindRow({
  kind,
  customName,
  disabled,
  onError,
}: {
  kind: NotificationKind;
  customName: string | undefined;
  disabled: boolean;
  onError: (message: string | null) => void;
}) {
  const settings = useNotificationSettings();
  const kindSettings = settings.kinds[kind];
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const label = NOTIFICATION_KIND_LABELS[kind];

  async function upload(file: File) {
    const validation = validateCustomSoundFile(file);
    if (!validation.ok) {
      onError(`${label}: ${validation.error}`);
      return;
    }
    setBusy(true);
    try {
      await saveCustomSound(kind, file);
      updateKindSettings(kind, { soundId: CUSTOM_SOUND_ID });
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the custom sound.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeCustomSound(kind);
      if (getNotificationSettings().kinds[kind].soundId === CUSTOM_SOUND_ID) {
        updateKindSettings(kind, { soundId: DEFAULT_KIND_SOUNDS[kind] });
      }
    } finally {
      setBusy(false);
    }
  }

  const rowDisabled = disabled || !kindSettings.enabled;

  return (
    <div className="flex flex-col gap-2 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 items-center gap-3 sm:w-48 sm:shrink-0">
        <ToggleSwitch
          checked={kindSettings.enabled}
          onCheckedChange={(enabled) => updateKindSettings(kind, { enabled })}
          disabled={disabled}
          aria-label={`${label} notifications`}
        />
        <div className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
          {label}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-1 sm:flex-nowrap">
        <Select
          value={kindSettings.soundId}
          onValueChange={(soundId) => updateKindSettings(kind, { soundId })}
          disabled={rowDisabled}
        >
          <SelectTrigger className="min-w-0 flex-1 sm:w-(--sz-170px) sm:flex-none" aria-label={`${label} sound`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NOTIFICATION_SOUNDS.map((sound) => (
              <SelectItem key={sound.id} value={sound.id}>
                {sound.label}
              </SelectItem>
            ))}
            {customName ? <SelectItem value={CUSTOM_SOUND_ID}>Custom: {customName}</SelectItem> : null}
            <SelectItem value={SILENT_SOUND_ID}>No sound</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Preview ${label} sound`}
          disabled={rowDisabled || kindSettings.soundId === SILENT_SOUND_ID}
          onClick={() => void playSound(kind, kindSettings.soundId, settings.volume)}
        >
          <Play />
        </Button>
        <input
          id={inputId}
          type="file"
          accept="audio/*"
          className="sr-only"
          disabled={rowDisabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rowDisabled || busy}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
          {customName ? "Replace" : "Custom"}
        </Button>
        {customName ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove custom ${label} sound`}
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function NotificationSettingsSection({ userId }: { userId: string | null }) {
  const settings = useNotificationSettings();
  const pushState = usePushState();
  const customNames = useCustomSoundNames();
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationPermission());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const canPush = pushSupported();
  const pushActive = pushState.status === "active";

  const syncPush = useCallback(() => {
    if (userId) void syncPushSubscription(getNotificationSettings(), userId);
  }, [userId]);

  async function askPermission() {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === "granted") syncPush();
    return next;
  }

  async function setEnabled(enabled: boolean) {
    setNotificationSettings((current) => ({ ...current, enabled }));
    if (enabled && notificationPermission() === "default") await askPermission();
  }

  async function setPushEnabled(pushEnabled: boolean) {
    setNotificationSettings((current) => ({ ...current, pushEnabled }));
    if (pushEnabled && notificationPermission() === "default") await askPermission();
  }

  async function sendTest() {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await notificationsApi.sendWebPushTest();
      setMessage(
        result.sent > 0
          ? `Test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`
          : "No device has push turned on for your account yet.",
      );
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Could not send the test notification.");
    } finally {
      setTesting(false);
    }
  }

  const masterDisabled = !settings.enabled;

  return (
    <section className="space-y-4" aria-label="Notifications">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Notifications</h2>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sounds and alerts for approvals, agent questions, comments, assignments, reviews, failed runs and join
          requests. These settings apply to this browser only.
        </p>
      </div>

      <div className="max-w-3xl space-y-4 rounded-md border border-border/70 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Notifications on this device</div>
            <div className="text-xs text-muted-foreground">Play sounds and show alerts for new inbox items.</div>
          </div>
          <ToggleSwitch checked={settings.enabled} onCheckedChange={(enabled) => void setEnabled(enabled)} aria-label="Notifications on this device" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Browser permission</div>
            <div className="text-xs text-muted-foreground">{PERMISSION_LABELS[permission]}</div>
          </div>
          {permission === "default" ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void askPermission()}>
              Allow notifications
            </Button>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Push when Paperclip is closed</div>
            <div className="text-xs text-muted-foreground">
              {canPush ? PUSH_STATUS_LABELS[pushState.status] : PUSH_STATUS_LABELS.unsupported}
              {pushState.error ? `: ${pushState.error}` : ""}
            </div>
          </div>
          <ToggleSwitch
            checked={settings.pushEnabled}
            onCheckedChange={(pushEnabled) => void setPushEnabled(pushEnabled)}
            disabled={masterDisabled || !canPush}
            aria-label="Push when Paperclip is closed"
          />
        </div>

        {settings.enabled && !pushActive ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Push is off on this device, so background alerts only work while a Paperclip tab is visible.
          </p>
        ) : null}

        {isIosWithoutHomeScreenInstall() ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            On iPhone and iPad, push notifications need Paperclip added to the Home Screen (Share, then Add to Home
            Screen) and opened from there.
          </p>
        ) : null}

        <div className="flex items-center gap-4">
          <label htmlFor="notification-volume" className="text-sm font-medium">
            Volume
          </label>
          <input
            id="notification-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.volume * 100)}
            disabled={masterDisabled}
            onChange={(event) =>
              setNotificationSettings((current) => ({ ...current, volume: Number(event.target.value) / 100 }))
            }
            className="h-1.5 w-full max-w-xs"
          />
          <span className="w-10 text-right text-xs text-muted-foreground">{Math.round(settings.volume * 100)}%</span>
        </div>

        <div>
          {NOTIFICATION_KINDS.map((kind) => (
            <KindRow key={kind} kind={kind} customName={customNames[kind]} disabled={masterDisabled} onError={setError} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Custom sounds must be audio files of 512 KB or less. They play only while Paperclip is open; push
          notifications use your system sound.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => void sendTest()} disabled={testing || masterDisabled}>
            {testing ? <LoaderCircle className="animate-spin" /> : <Send />}
            Send test notification
          </Button>
          {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
        </div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
      </div>
    </section>
  );
}
