// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstanceUpdateStatus, UpdateJob } from "@tickernelz/wardmote-shared";
import { UpdateInstallDialog } from "./UpdateInstallDialog";

const api = vi.hoisted(() => ({
  liveRuns: vi.fn(),
  startInstall: vi.fn(),
  forceInstall: vi.fn(),
  cancelInstall: vi.fn(),
}));
vi.mock("@/api/instanceUpdates", () => ({ instanceUpdatesApi: api }));

const STATUS: InstanceUpdateStatus = {
  currentVersion: "2026.1111.0",
  latestVersion: "2026.1112.0",
  updateAvailable: true,
  channel: "latest",
  checkEnabled: true,
  checkedAt: null,
  releaseNotesUrl: null,
  install: { kind: "managed", command: "wardmote update --version 2026.1112.0", canInstall: true },
};

function job(overrides: Partial<UpdateJob>): UpdateJob {
  return {
    id: "job-1", phase: "waiting", mode: "wait", trigger: "manual", fromVersion: "2026.1111.0", toVersion: "2026.1112.0",
    requestedBy: null, requestedAt: "2026-11-12T07:00:00.000Z", waitDeadline: "2026-11-12T07:15:00.000Z", liveRuns: 2,
    startedAt: null, finishedAt: null, installedVersion: null, rolledBackTo: null, error: null, logHint: null, ...overrides,
  };
}

async function flush() {
  for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function renderDialog(currentJob: UpdateJob | null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <UpdateInstallDialog open onOpenChange={() => undefined} status={STATUS} job={currentJob} serverReachable />
    </QueryClientProvider>,
  ));
  await flush();
  const dialog = () => document.querySelector<HTMLElement>('[data-testid="update-install-dialog"]')!;
  const buttons = () => [...dialog().querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
  const click = async (label: string) => {
    const button = [...dialog().querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (!button) throw new Error(`no button ${label}; have ${buttons().join(", ")}`);
    await act(async () => button.click());
    await flush();
  };
  return { dialog, buttons, click, cleanup: () => { act(() => root.unmount()); client.clear(); container.remove(); } };
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("UpdateInstallDialog", () => {
  it("with active runs offers force as the focused default and wait as the alternative, and starts nothing until clicked", async () => {
    api.liveRuns.mockResolvedValue({ draining: false, pendingWakes: 1, count: 2, runs: [] });
    const view = await renderDialog(null);
    try {
      expect(view.dialog().textContent).toContain("3 runs are active now");
      expect(view.buttons()).toEqual(expect.arrayContaining(["Cancel", "Wait for runs to finish", "Update and stop 3 runs"]));
      expect(document.activeElement?.textContent?.trim()).toBe("Update and stop 3 runs");
      expect(api.startInstall).not.toHaveBeenCalled();
      api.startInstall.mockResolvedValue({ job: job({ phase: "installing", mode: "force" }) });
      await view.click("Update and stop 3 runs");
      expect(api.startInstall).toHaveBeenCalledWith("2026.1112.0", "force");
    } finally {
      view.cleanup();
    }
  });

  it("starts a wait update only from the wait button", async () => {
    api.liveRuns.mockResolvedValue({ draining: false, pendingWakes: 0, count: 1, runs: [] });
    api.startInstall.mockResolvedValue({ job: job({ liveRuns: 1 }) });
    const view = await renderDialog(null);
    try {
      expect(view.buttons()).toContain("Update and stop 1 run");
      await view.click("Wait for runs to finish");
      expect(api.startInstall).toHaveBeenCalledExactlyOnceWith("2026.1112.0", "wait");
    } finally {
      view.cleanup();
    }
  });

  it("without active runs asks for a plain confirmation and offers no run choice", async () => {
    api.liveRuns.mockResolvedValue({ draining: false, pendingWakes: 0, count: 0, runs: [] });
    api.startInstall.mockResolvedValue({ job: job({ phase: "installing", liveRuns: 0 }) });
    const view = await renderDialog(null);
    try {
      expect(view.dialog().textContent).toContain("No runs are active");
      expect(view.buttons().filter((label) => label !== "Close")).toEqual(["Cancel", "Update now"]);
      await view.click("Update now");
      expect(api.startInstall).toHaveBeenCalledWith("2026.1112.0", "wait");
    } finally {
      view.cleanup();
    }
  });

  it("while waiting shows the run count, can be cancelled, and never forces without a click", async () => {
    api.cancelInstall.mockResolvedValue({ job: job({ phase: "cancelled" }) });
    const view = await renderDialog(job({ phase: "waiting", liveRuns: 2 }));
    try {
      expect(view.dialog().textContent).toContain("Waiting for 2 runs to finish");
      expect(view.buttons()).toEqual(expect.arrayContaining(["Cancel update", "Stop 2 runs and update now"]));
      await flush();
      expect(api.forceInstall).not.toHaveBeenCalled();
      await view.click("Cancel update");
      expect(api.cancelInstall).toHaveBeenCalledTimes(1);
      expect(api.forceInstall).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  it("switches a waiting update to force only from its own button", async () => {
    api.forceInstall.mockResolvedValue({ job: job({ phase: "installing", mode: "force" }) });
    const view = await renderDialog(job({ phase: "waiting", liveRuns: 1 }));
    try {
      await view.click("Stop 1 run and update now");
      expect(api.forceInstall).toHaveBeenCalledTimes(1);
    } finally {
      view.cleanup();
    }
  });

  it("reports a rolled-back failure with the log command", async () => {
    const view = await renderDialog(job({ phase: "failed", rolledBackTo: "2026.1111.0", error: "health timeout", logHint: "journalctl --user -u wardmote-update-default-abcd1234" }));
    try {
      expect(view.dialog().textContent).toContain("failed and Wardmote was rolled back to 2026.1111.0");
      expect(view.dialog().textContent).toContain("journalctl --user -u wardmote-update-default-abcd1234");
    } finally {
      view.cleanup();
    }
  });
});
