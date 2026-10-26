import {
  localBrowserViewerEventSchema,
  type LocalBrowserInput,
  type LocalBrowserViewerEvent,
} from "@tickernelz/paperclip-pro-shared";

export type { LocalBrowserInput, LocalBrowserViewerEvent };

export type LocalBrowserViewerFrame = Extract<LocalBrowserViewerEvent, { type: "frame" }>;
export type LocalBrowserViewerState = Extract<LocalBrowserViewerEvent, { type: "state" }>;
export type LocalBrowserViewerStateName = LocalBrowserViewerState["state"];
export type LocalBrowserMouseButton = "left" | "middle" | "right";
type LocalBrowserKeyInput = Extract<LocalBrowserInput, { kind: "key" }>;
export type LocalBrowserMouseAction = "move" | "down" | "up";

export interface LocalBrowserKeyDescriptor {
  key: string;
  code?: string;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export const LOCAL_BROWSER_VIEWER_RECONNECT_BASE_MS = 500;
export const LOCAL_BROWSER_VIEWER_RECONNECT_MAX_MS = 15_000;
export const LOCAL_BROWSER_VIEWER_MAX_RETRIES = 5;

function scoped(path: string, companyId?: string): string {
  if (!companyId) return path;
  return `${path}?${new URLSearchParams({ companyId }).toString()}`;
}

export function localBrowserViewerUrl(sessionId: string, companyId?: string, tabId?: number): string {
  const path = `/api/local-browser/sessions/${encodeURIComponent(sessionId)}/viewer`;
  const params = new URLSearchParams();
  if (companyId) params.set("companyId", companyId);
  if (typeof tabId === "number") params.set("tabId", String(tabId));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function localBrowserInputUrl(sessionId: string, companyId?: string): string {
  return scoped(`/api/local-browser/sessions/${encodeURIComponent(sessionId)}/input`, companyId);
}

export async function postLocalBrowserInput(
  sessionId: string,
  input: LocalBrowserInput,
  companyId?: string,
): Promise<void> {
  const response = await fetch(localBrowserInputUrl(sessionId, companyId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Browser input was rejected (${response.status}).`);
  }
}

export function mouseButtonOf(button: number): LocalBrowserMouseButton {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

export function mouseInput(
  action: LocalBrowserMouseAction,
  x: number,
  y: number,
  button: LocalBrowserMouseButton,
  clickCount?: number,
): LocalBrowserInput {
  if (action === "move" || !clickCount) return { kind: "mouse", action, x, y, button };
  return { kind: "mouse", action, x, y, button, clickCount: Math.min(Math.max(clickCount, 1), 3) };
}

export function wheelInput(deltaX: number, deltaY: number, x: number, y: number): LocalBrowserInput {
  return { kind: "wheel", deltaX, deltaY, x, y };
}

export function keyInput(action: "down" | "up", descriptor: LocalBrowserKeyDescriptor): LocalBrowserInput | null {
  const key = descriptor.key.slice(0, 64);
  if (!key) return null;
  const input: LocalBrowserKeyInput = { kind: "key", action, key };
  const code = descriptor.code?.slice(0, 64);
  if (code) input.code = code;
  if (descriptor.alt) input.alt = true;
  if (descriptor.ctrl) input.ctrl = true;
  if (descriptor.meta) input.meta = true;
  if (descriptor.shift) input.shift = true;
  if (action === "down" && key.length === 1 && !descriptor.ctrl && !descriptor.meta && !descriptor.alt) {
    input.text = key;
  }
  return input;
}

export function parseLocalBrowserViewerEvent(raw: string): LocalBrowserViewerEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = localBrowserViewerEventSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
