import type * as ChildProcess from "node:child_process";
import fs from "node:fs";
import type * as Os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { guardChildProcess, serviceCommandViolations } from "./helpers/service-command-guard.js";

delete process.env.XDG_RUNTIME_DIR;
delete process.env.DBUS_SESSION_BUS_ADDRESS;

const sandbox = vi.hoisted(() => ({ realHome: "", home: "" }));

async function sandboxHomedir(importOriginal: () => Promise<typeof Os>) {
  const actual = await importOriginal();
  sandbox.realHome ||= actual.homedir();
  sandbox.home ||= fs.mkdtempSync(path.join(actual.tmpdir(), "paperclip-cli-test-home-"));
  const homedir = (): string => {
    const home = process.env.HOME;
    return home && home !== sandbox.realHome ? home : sandbox.home;
  };
  const sandboxed = { ...actual, homedir };
  return { ...sandboxed, default: sandboxed };
}

vi.mock("node:child_process", async (importOriginal) => guardChildProcess(await importOriginal<typeof ChildProcess>()));
vi.mock("child_process", async (importOriginal) => guardChildProcess(await importOriginal<typeof ChildProcess>()));
vi.mock("node:os", sandboxHomedir);
vi.mock("os", sandboxHomedir);

afterAll(() => {
  if (sandbox.home) fs.rmSync(sandbox.home, { recursive: true, force: true });
});

beforeEach(() => {
  serviceCommandViolations.length = 0;
});

afterEach(() => {
  if (serviceCommandViolations.length === 0) return;
  throw new Error(serviceCommandViolations.splice(0).join("\n"));
});
