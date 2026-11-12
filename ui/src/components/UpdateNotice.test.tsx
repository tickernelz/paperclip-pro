// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus } from "@tickernelz/wardmote-shared";
import { UPDATE_NOTICE_HIDDEN_UNTIL_KEY, UpdateNotice } from "./UpdateNotice";

const getCurrentBoardAccess = vi.hoisted(() => vi.fn());
const getStatus = vi.hoisted(() => vi.fn());
const getInstall = vi.hoisted(() => vi.fn());
vi.mock("@/api/access", () => ({ accessApi: { getCurrentBoardAccess } }));
vi.mock("@/api/instanceUpdates", () => ({ instanceUpdatesApi: { getStatus, getInstall, liveRuns: vi.fn(async () => ({ draining: false, pendingWakes: 0, count: 0, runs: [] })) } }));

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
  install: { kind: "managed", command: "wardmote update --version 2026.1112.0", canInstall: false },
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
  for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
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

  it("offers Update now only on a managed service install and shows the command elsewhere", async () => {
    getCurrentBoardAccess.mockResolvedValue(access({ isInstanceAdmin: true }));
    getInstall.mockResolvedValue({ job: null });
    getStatus.mockResolvedValue({ ...STATUS, install: { kind: "managed", command: "wardmote update --version 2026.1112.0", canInstall: true } });
    let view = await renderNotice(() => T0);
    try {
      const labels = [...view.container.querySelectorAll("button")].map((button) => button.textContent);
      expect(labels).toEqual(["Update now", "Hide"]);
    } finally {
      view.cleanup();
    }
    getStatus.mockResolvedValue({ ...STATUS, install: { kind: "docker", command: "Pull the wardmote image for 2026.1112.0 and recreate the container", canInstall: false } });
    view = await renderNotice(() => T0);
    try {
      expect([...view.container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Hide"]);
      expect(view.notice()?.textContent).toContain("Pull the wardmote image for 2026.1112.0");
      expect(getInstall).toHaveBeenCalledTimes(1);
    } finally {
      view.cleanup();
    }
  });

  it("keeps showing a running update even after the notice was hidden", async () => {
    window.localStorage.setItem(UPDATE_NOTICE_HIDDEN_UNTIL_KEY, String(T0 + DAY_MS));
    getCurrentBoardAccess.mockResolvedValue(access({ isInstanceAdmin: true }));
    getStatus.mockResolvedValue({ ...STATUS, install: { ...STATUS.install, canInstall: true } });
    getInstall.mockResolvedValue({ job: { id: "job-1", phase: "waiting", toVersion: "2026.1112.0", liveRuns: 2, finishedAt: null } });
    const view = await renderNotice(() => T0);
    try {
      expect(view.notice()?.getAttribute("data-phase")).toBe("waiting");
      expect(view.notice()?.textContent).toContain("waiting for 2 runs to finish");
    } finally {
      view.cleanup();
    }
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
