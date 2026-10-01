import type * as ChildProcess from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

type AnyFunction = (...args: unknown[]) => unknown;

const GUARDED_COMMANDS: Record<string, true> = {
  systemctl: true,
  launchctl: true,
  loginctl: true,
  journalctl: true,
};

export const serviceCommandViolations: string[] = [];

function refuse(input: unknown[]): void {
  const strings = [input[0], ...(Array.isArray(input[1]) ? input[1] : [])]
    .filter((value): value is string => typeof value === "string");
  const guarded = strings.some((value) => value
    .split(/[\s;&|()<>'"`]+/)
    .some((token) => token.length > 0 && GUARDED_COMMANDS[path.basename(token)] === true));
  if (!guarded) return;
  const message =
    `Unmocked service-manager command in a cli test: ${strings.join(" ")}. ` +
    "Inject a stub service manager, detector, or CommandRunner instead of reaching the real host.";
  serviceCommandViolations.push(message);
  throw new Error(message);
}

export function guardProcessFunction<T>(original: T): T {
  const call = original as AnyFunction;
  const guarded: AnyFunction = (...input) => {
    refuse(input);
    return call(...input);
  };
  const promisified = (original as Record<symbol, unknown>)[promisify.custom];
  if (typeof promisified === "function") {
    Object.defineProperty(guarded, promisify.custom, { value: guardProcessFunction(promisified) });
  }
  return guarded as T;
}

export function guardChildProcess(actual: typeof ChildProcess) {
  const guarded = {
    ...actual,
    exec: guardProcessFunction(actual.exec),
    execSync: guardProcessFunction(actual.execSync),
    execFile: guardProcessFunction(actual.execFile),
    execFileSync: guardProcessFunction(actual.execFileSync),
    spawn: guardProcessFunction(actual.spawn),
    spawnSync: guardProcessFunction(actual.spawnSync),
  };
  return { ...guarded, default: guarded };
}
