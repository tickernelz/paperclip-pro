// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TerminalSshHost } from "@tickernelz/paperclip-pro-shared";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { SshHostDialog } from "./SshHostDialog";

const api = vi.hoisted(() => ({
  createSshHost: vi.fn(),
  removeSshHost: vi.fn(),
}));

vi.mock("@/api/terminal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/terminal")>();
  return { ...actual, terminalApi: { ...actual.terminalApi, ...api } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY_ID = "company-1";

const savedHost: TerminalSshHost = {
  id: "saved:77777777-7777-4777-8777-000000000001",
  source: "saved",
  name: "prod",
  destination: "root@prod.test",
  port: 2200,
};

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function setInput(id: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`missing input ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submitButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent === "Save and connect");
  if (!button) throw new Error("missing submit button");
  return button;
}

describe("SshHostDialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  let onConnect: Mock<(host: TerminalSshHost) => void>;
  let onOpenChange: Mock<(open: boolean) => void>;

  beforeEach(() => {
    api.createSshHost.mockReset();
    api.removeSshHost.mockReset();
    api.createSshHost.mockResolvedValue({
      id: "saved:77777777-7777-4777-8777-000000000002",
      source: "saved",
      name: "db",
      destination: "ops@db.test",
      port: 2222,
    });
    api.removeSshHost.mockResolvedValue(undefined);
    onConnect = vi.fn<(host: TerminalSshHost) => void>();
    onOpenChange = vi.fn<(open: boolean) => void>();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  async function render(savedHosts: TerminalSshHost[] = []) {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SshHostDialog
            companyId={COMPANY_ID}
            open
            savedHosts={savedHosts}
            onOpenChange={onOpenChange}
            onConnect={onConnect}
          />
        </QueryClientProvider>,
      );
    });
    await settle();
  }

  it("saves the host and then connects with it", async () => {
    await render();
    expect(submitButton().disabled).toBe(true);

    setInput("ssh-host-name", "db");
    setInput("ssh-host-destination", "ops@db.test");
    setInput("ssh-host-port", "2222");
    expect(submitButton().disabled).toBe(false);

    await act(async () => {
      submitButton().click();
    });
    await settle();

    expect(api.createSshHost).toHaveBeenCalledWith(COMPANY_ID, {
      name: "db",
      destination: "ops@db.test",
      port: 2222,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved:77777777-7777-4777-8777-000000000002", name: "db" }),
    );
  });

  it("leaves the port out when it is empty and blocks a non-numeric port", async () => {
    await render();
    setInput("ssh-host-name", "plain");
    setInput("ssh-host-destination", "plain.test");
    setInput("ssh-host-port", "not-a-port");
    expect(submitButton().disabled).toBe(true);

    setInput("ssh-host-port", "");
    expect(submitButton().disabled).toBe(false);
    await act(async () => {
      submitButton().click();
    });
    await settle();
    expect(api.createSshHost).toHaveBeenCalledWith(COMPANY_ID, { name: "plain", destination: "plain.test" });
  });

  it("connects to a saved host and removes it from the list", async () => {
    await render([savedHost]);
    const row = [...document.querySelectorAll("button")].find((entry) => entry.textContent?.includes("prod"));
    if (!row) throw new Error("missing saved host row");
    await act(async () => {
      row.click();
    });
    expect(onConnect).toHaveBeenCalledWith(savedHost);
    expect(api.createSshHost).not.toHaveBeenCalled();

    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove prod"]');
    if (!remove) throw new Error("missing remove button");
    await act(async () => {
      remove.click();
    });
    await settle();
    expect(api.removeSshHost).toHaveBeenCalledWith(COMPANY_ID, savedHost.id);
  });
});
