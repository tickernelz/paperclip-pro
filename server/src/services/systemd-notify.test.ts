import { spawnSync } from "node:child_process";
import type * as ChildProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return { ...actual, execFile: execFileMock };
});

describe("systemdNotify", () => {
  afterEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    delete process.env.NOTIFY_SOCKET;
    delete process.env.WATCHDOG_USEC;
  });

  it("hides the notify socket from every later child process but still notifies systemd", async () => {
    process.env.NOTIFY_SOCKET = "/run/user/1000/systemd/notify";
    process.env.WATCHDOG_USEC = "30000000";
    execFileMock.mockImplementation((_command, _args, _options, callback: (error: Error | null) => void) => callback(null));

    const { systemdNotify } = await import("./systemd-notify.js");

    expect(process.env.NOTIFY_SOCKET).toBeUndefined();
    expect(process.env.WATCHDOG_USEC).toBeUndefined();
    const inherited = spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.NOTIFY_SOCKET ?? 'unset')"], {
      encoding: "utf8",
    });
    expect(inherited.stdout).toBe("unset");

    await expect(systemdNotify(["--ready"])).resolves.toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-notify",
      ["--ready"],
      expect.objectContaining({ env: expect.objectContaining({ NOTIFY_SOCKET: "/run/user/1000/systemd/notify" }) }),
      expect.any(Function),
    );
  });

  it("does nothing outside systemd", async () => {
    const { systemdNotify } = await import("./systemd-notify.js");
    await expect(systemdNotify(["--ready"])).resolves.toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
