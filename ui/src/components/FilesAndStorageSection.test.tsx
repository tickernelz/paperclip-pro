// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_ATTACHMENT_RETENTION, type AttachmentRetentionReport } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { FilesAndStorageSection } from "./FilesAndStorageSection";

const mockInstanceSettingsApi = vi.hoisted(() => ({
  updateGeneral: vi.fn(),
  getAttachmentRetention: vi.fn(),
  previewAttachmentRetention: vi.fn(),
  runAttachmentRetention: vi.fn(),
}));

vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW_REPORT: AttachmentRetentionReport = {
  mode: "preview",
  trigger: "manual",
  startedAt: "2026-10-08T01:00:00.000Z",
  finishedAt: "2026-10-08T01:00:01.000Z",
  settings: DEFAULT_ATTACHMENT_RETENTION,
  rules: [
    { rule: "orphan_objects", count: 3, bytes: 3 * 1024 * 1024, sampleIds: [] },
    { rule: "orphan_assets", count: 1, bytes: 1536, sampleIds: [] },
    { rule: "closed_tasks", count: 0, bytes: 0, sampleIds: [] },
  ],
  totalCount: 4,
  totalBytes: 3 * 1024 * 1024 + 1536,
  failedCount: 0,
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`Button "${label}" not found`);
  return found as HTMLButtonElement;
}

describe("FilesAndStorageSection", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockInstanceSettingsApi.updateGeneral.mockResolvedValue({});
    mockInstanceSettingsApi.getAttachmentRetention.mockResolvedValue({
      settings: DEFAULT_ATTACHMENT_RETENTION,
      lastRun: null,
    });
    mockInstanceSettingsApi.previewAttachmentRetention.mockResolvedValue(PREVIEW_REPORT);
    mockInstanceSettingsApi.runAttachmentRetention.mockResolvedValue({ ...PREVIEW_REPORT, mode: "run" });
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function renderSection(attachmentMaxMegabytes: number | null = null) {
    root = createRoot(container);
    flushSync(() => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <FilesAndStorageSection
            attachmentMaxMegabytes={attachmentMaxMegabytes}
            attachmentRetention={DEFAULT_ATTACHMENT_RETENTION}
            effectiveLimit={{ maxBytes: 100 * 1024 * 1024, source: "default" }}
          />
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Cleanup has not run yet."));
  }

  function limitInput() {
    return container.querySelector<HTMLInputElement>('input[aria-label="Upload size limit in MB"]')!;
  }

  it("shows the effective limit and its source", async () => {
    await renderSection();
    expect(container.textContent).toContain("Current limit: 100 MB");
    expect(container.textContent).toContain("built-in default");
  });

  it("rejects an out-of-range limit without saving", async () => {
    await renderSection();
    flushSync(() => setInputValue(limitInput(), "501"));
    flushSync(() => button("Save upload limit").click());

    await vi.waitFor(() => expect(container.textContent).toContain("Enter a whole number from 1 to 500 MB"));
    expect(mockInstanceSettingsApi.updateGeneral).not.toHaveBeenCalled();

    flushSync(() => setInputValue(limitInput(), "2.5"));
    flushSync(() => button("Save upload limit").click());
    await vi.waitFor(() => expect(container.textContent).toContain("Enter a whole number from 1 to 500 MB"));
    expect(mockInstanceSettingsApi.updateGeneral).not.toHaveBeenCalled();
  });

  it("saves a valid limit and refreshes settings and health", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await renderSection();
    flushSync(() => setInputValue(limitInput(), "250"));
    flushSync(() => button("Save upload limit").click());

    await vi.waitFor(() =>
      expect(mockInstanceSettingsApi.updateGeneral).toHaveBeenCalledWith({ attachmentMaxMegabytes: 250 }),
    );
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.health }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.instance.generalSettings });
  });

  it("clears the limit back to the default when the field is blank", async () => {
    await renderSection(250);
    flushSync(() => setInputValue(limitInput(), ""));
    flushSync(() => button("Save upload limit").click());

    await vi.waitFor(() =>
      expect(mockInstanceSettingsApi.updateGeneral).toHaveBeenCalledWith({ attachmentMaxMegabytes: null }),
    );
  });

  it("previews the unsaved cleanup settings and renders counts per rule", async () => {
    await renderSection();
    const orphanInput = container.querySelector<HTMLInputElement>('input[aria-label="Remove unused files after days"]')!;
    flushSync(() => setInputValue(orphanInput, "14"));
    flushSync(() => button("Preview").click());

    await vi.waitFor(() => expect(container.querySelector('[data-testid="attachment-retention-preview"]')).not.toBeNull());
    expect(mockInstanceSettingsApi.previewAttachmentRetention).toHaveBeenCalledWith({
      ...DEFAULT_ATTACHMENT_RETENTION,
      orphanAfterDays: 14,
    });
    const rows = (rule: string) => container.querySelector(`[data-rule="${rule}"]`)?.textContent ?? "";
    expect(rows("orphan_objects")).toContain("Orphaned files in storage");
    expect(rows("orphan_objects")).toContain("3 files · 3 MB");
    expect(rows("orphan_assets")).toContain("Unreferenced uploads");
    expect(rows("orphan_assets")).toContain("1 file · 1.5 KB");
    expect(rows("closed_tasks")).toContain("Attachments of closed tasks");
    expect(mockInstanceSettingsApi.updateGeneral).not.toHaveBeenCalled();
    expect(mockInstanceSettingsApi.runAttachmentRetention).not.toHaveBeenCalled();
  });

  it("rejects out-of-range cleanup days", async () => {
    await renderSection();
    const orphanInput = container.querySelector<HTMLInputElement>('input[aria-label="Remove unused files after days"]')!;
    flushSync(() => setInputValue(orphanInput, "0"));
    flushSync(() => button("Save cleanup settings").click());

    await vi.waitFor(() => expect(container.textContent).toContain("Unused files must be kept for 1–365 whole days."));
    expect(mockInstanceSettingsApi.updateGeneral).not.toHaveBeenCalled();
  });

  it("saves cleanup settings", async () => {
    await renderSection();
    flushSync(() => container.querySelector<HTMLButtonElement>('[aria-label="Toggle automatic attachment cleanup"]')!.click());
    flushSync(() => button("Save cleanup settings").click());

    await vi.waitFor(() =>
      expect(mockInstanceSettingsApi.updateGeneral).toHaveBeenCalledWith({
        attachmentRetention: { ...DEFAULT_ATTACHMENT_RETENTION, enabled: true },
      }),
    );
  });

  it("runs cleanup only after confirmation and refreshes the last run", async () => {
    await renderSection();
    const lastRun = { ...PREVIEW_REPORT, mode: "run" as const, failedCount: 2 };
    mockInstanceSettingsApi.getAttachmentRetention.mockResolvedValue({
      settings: DEFAULT_ATTACHMENT_RETENTION,
      lastRun,
    });

    flushSync(() => button("Run now").click());
    await vi.waitFor(() => expect(document.body.textContent).toContain("Run attachment cleanup now?"));
    expect(mockInstanceSettingsApi.runAttachmentRetention).not.toHaveBeenCalled();

    flushSync(() => button("Cancel").click());
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Run attachment cleanup now?"));
    expect(mockInstanceSettingsApi.runAttachmentRetention).not.toHaveBeenCalled();

    flushSync(() => button("Run now").click());
    await vi.waitFor(() => expect(document.body.textContent).toContain("Run attachment cleanup now?"));
    flushSync(() => button("Delete files now").click());

    await vi.waitFor(() => expect(mockInstanceSettingsApi.runAttachmentRetention).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="attachment-retention-last-run"]')?.textContent).toContain("4 files removed"),
    );
    expect(container.textContent).toContain("2 failed");
  });
});
