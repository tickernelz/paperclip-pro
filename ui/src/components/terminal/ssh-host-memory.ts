import type { SshConnectionTestStatus } from "@tickernelz/wardmote-shared";

const MAX_RECENT = 5;

export interface RememberedTest {
  status: SshConnectionTestStatus;
  at: string;
}

function recentKey(companyId: string) {
  return `wardmote:terminal-ssh-recent:v1:${companyId}`;
}

function testsKey(companyId: string) {
  return `wardmote:terminal-ssh-tests:v1:${companyId}`;
}

function read(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function recentSshTargets(companyId: string): string[] {
  const raw = read(recentKey(companyId));
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT) : [];
}

export function rememberSshTarget(companyId: string, targetKey: string): string[] {
  const next = [targetKey, ...recentSshTargets(companyId).filter((entry) => entry !== targetKey)].slice(0, MAX_RECENT);
  write(recentKey(companyId), next);
  return next;
}

export function rememberedTests(companyId: string): Record<string, RememberedTest> {
  const raw = read(testsKey(companyId));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, RememberedTest] =>
        typeof (entry[1] as RememberedTest | null)?.status === "string" && typeof (entry[1] as RememberedTest | null)?.at === "string",
    ),
  );
}

export function rememberTest(companyId: string, alias: string, status: SshConnectionTestStatus, at: Date = new Date()) {
  write(testsKey(companyId), { ...rememberedTests(companyId), [alias]: { status, at: at.toISOString() } });
}

export function forgetTest(companyId: string, alias: string) {
  const { [alias]: _removed, ...rest } = rememberedTests(companyId);
  write(testsKey(companyId), rest);
}
