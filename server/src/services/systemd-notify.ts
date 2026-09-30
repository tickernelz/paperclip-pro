import { execFile } from "node:child_process";

const SERVICE_MANAGER_ENV_KEYS = ["NOTIFY_SOCKET", "WATCHDOG_USEC", "WATCHDOG_PID"] as const;

const notifySocket = process.env.NOTIFY_SOCKET?.trim() || null;
for (const key of SERVICE_MANAGER_ENV_KEYS) delete process.env[key];

export async function systemdNotify(args: string[]): Promise<boolean> {
  if (!notifySocket) return false;
  return await new Promise<boolean>((resolve) => {
    execFile(
      "systemd-notify",
      args,
      { windowsHide: true, env: { ...process.env, NOTIFY_SOCKET: notifySocket } },
      (error) => resolve(!error),
    );
  });
}
