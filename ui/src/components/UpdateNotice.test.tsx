// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus } from "@tickernelz/wardmote-shared";
import { UPDATE_NOTICE_HIDDEN_UNTIL_KEY, UpdateNotice } from "./UpdateNotice";

const getCurrentBoardAccess = vi.hoisted(() => vi.fn());
const getStatus = vi.hoisted(() => vi.fn());
vi.mock("@/api/access", () => ({ accessApi: { getCurrentBoardAccess } }));
vi.mock("@/api/instanceUpdates", () => ({ instanceUpdatesApi: { getStatus } }));

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 12, 7, 0, 0);
const STATUS: InstanceUpdateStatus = {
  currentVersion: "2026.1111.0",
  latestVersion: "2026.1112.0",
  updateAvailable: true,
  channel: "latest",
  checkEnabled: true,
  checkedAt: "2026-11-12T07:00:00.000Z",
  releaseNotesUrl: "https://github.com/tickernelz/wardmote/releases/tag/v2026.1112.0",
  install: { kind: "managed", command: "wardmote update --version 2026.1112.0" },
};

function access(overrides: Record<string, unknown>) {
  return { user: null, userId: "u1", isInstanceAdmin: false, companyIds: [], source: "session", ...overrides };
}

async function renderNotice(now: () => number) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><UpdateNotice now={now} /></QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return {
    container,
    notice: () => container.querySelector('[data-testid="update-notice"]'),
    rerender: async () => {
      await act(async () => root.render(<QueryClientProvider client={client}><UpdateNotice now={now} /></QueryClientProvider>));
    },
    cleanup: () => { act(() => root.unmount()); client.clear(); container.remove(); },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("UpdateNotice", () => {
  it("shows an instance admin the new version, installed version, and release notes", async () => {
    getCurrentBoardAccess.mockResolvedValue(access({ isInstanceAdmin: true }));
    getStatus.mockResolvedValue(STATUS);
    const view = await renderNotice(() => T0);
    try {
      expect(view.notice()?.textContent).toContain("Wardmote 2026.1112.0 is available");
      expect(view.notice()?.textContent).toContain("installed 2026.1111.0");
      expect(view.container.querySelector("a")?.getAttribute("href")).toBe(STATUS.releaseNotesUrl);
    } finally {
      view.cleanup();
    }
  });

  it("never asks for update status for members who cannot install updates", async () => {
    for (const board of [access({ isInstanceAdmin: false }), access({ isInstanceAdmin: true, source: "board_key" })]) {
      getCurrentBoardAccess.mockResolvedValue(board);
      const view = await renderNotice(() => T0);
      try {
        expect(view.notice()).toBeNull();
      } finally {
        view.cleanup();
      }
    }
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("renders nothing when the installed version is current", async () => {
    getCurrentBoardAccess.mockResolvedValue(access({ source: "local_implicit" }));
    getStatus.mockResolvedValue({ ...STATUS, latestVersion: "2026.1111.0", updateAvailable: false });
    const view = await renderNotice(() => T0);
    try {
      expect(view.notice()).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("hides for three days, ignores newer releases meanwhile, then shows again", async () => {
    getCurrentBoardAccess.mockResolvedValue(access({ isInstanceAdmin: true }));
    getStatus.mockResolvedValue(STATUS);
    let clock = T0;
    const view = await renderNotice(() => clock);
    try {
      const hide = view.container.querySelector<HTMLButtonElement>("button")!;
      expect(hide.textContent).toBe("Hide");
      await act(async () => hide.click());
      expect(view.notice()).toBeNull();
      expect(Number(window.localStorage.getItem(UPDATE_NOTICE_HIDDEN_UNTIL_KEY))).toBe(T0 + 3 * DAY_MS);

      clock = T0 + 3 * DAY_MS - 60_000;
      getStatus.mockResolvedValue({ ...STATUS, latestVersion: "2026.1114.0" });
      await view.rerender();
      expect(view.notice()).toBeNull();

      clock = T0 + 3 * DAY_MS;
      await view.rerender();
      expect(view.notice()).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });
});
