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
    vi.useRealTimers();
  });

  function extendCalls() {
    return execFileMock.mock.calls.filter(([, args]) => (args as string[])[0]?.startsWith("EXTEND_TIMEOUT_USEC="));
  }

  it.each([["--ready"], ["--stopping"]])("extends the start timeout every 20 s until %s", async (finalState) => {
    vi.useFakeTimers();
    process.env.NOTIFY_SOCKET = "/run/user/1000/systemd/notify";
    execFileMock.mockImplementation((_command, _args, _options, callback: (error: Error | null) => void) => callback(null));
    const { extendStartTimeoutUntilReady, systemdNotify } = await import("./systemd-notify.js");

    extendStartTimeoutUntilReady();
    extendStartTimeoutUntilReady();
    expect(extendCalls().map(([, args]) => args)).toEqual([["EXTEND_TIMEOUT_USEC=60000000"]]);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(extendCalls()).toHaveLength(11);

    await systemdNotify([finalState]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(extendCalls()).toHaveLength(11);
  });

  it("never extends a start timeout outside systemd", async () => {
    vi.useFakeTimers();
    const { extendStartTimeoutUntilReady } = await import("./systemd-notify.js");
    extendStartTimeoutUntilReady();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(execFileMock).not.toHaveBeenCalled();
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
