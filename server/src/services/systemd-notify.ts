import { execFile } from "node:child_process";

const SERVICE_MANAGER_ENV_KEYS = ["NOTIFY_SOCKET", "WATCHDOG_USEC", "WATCHDOG_PID"] as const;

const notifySocket = process.env.NOTIFY_SOCKET?.trim() || null;
for (const key of SERVICE_MANAGER_ENV_KEYS) delete process.env[key];

const START_TIMEOUT_EXTENSION_USEC = 60_000_000;
const START_TIMEOUT_EXTENSION_INTERVAL_MS = 20_000;
let startTimeoutExtender: NodeJS.Timeout | null = null;

export function extendStartTimeoutUntilReady(): void {
  if (!notifySocket || startTimeoutExtender) return;
  const extend = () => void systemdNotify([`EXTEND_TIMEOUT_USEC=${START_TIMEOUT_EXTENSION_USEC}`]);
  startTimeoutExtender = setInterval(extend, START_TIMEOUT_EXTENSION_INTERVAL_MS);
  startTimeoutExtender.unref();
  extend();
}

export async function systemdNotify(args: string[]): Promise<boolean> {
  if (!notifySocket) return false;
  if (startTimeoutExtender && (args.includes("--ready") || args.includes("--stopping"))) {
    clearInterval(startTimeoutExtender);
    startTimeoutExtender = null;
  }
  return await new Promise<boolean>((resolve) => {
    execFile(
      "systemd-notify",
      args,
      { windowsHide: true, env: { ...process.env, NOTIFY_SOCKET: notifySocket } },
      (error) => resolve(!error),
    );
  });
}
