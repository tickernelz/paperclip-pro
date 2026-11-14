// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalSshHost } from "@tickernelz/wardmote-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SshHostPicker, type SshHostPickerProps } from "./SshHostPicker";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const managed: TerminalSshHost = {
  id: "config:prod-web",
  source: "config",
  name: "prod-web",
  destination: "deploy@203.0.113.10",
  port: 2222,
  managed: true,
  settings: {
    alias: "prod-web",
    hostName: "203.0.113.10",
    user: "deploy",
    port: 2222,
    identityFile: null,
    proxyJump: null,
    serverAliveInterval: null,
    serverAliveCountMax: null,
  },
};
const handwritten: TerminalSshHost = { id: "config:db", source: "config", name: "db", destination: "db.internal", port: null, managed: false, settings: null };
const saved: TerminalSshHost = { id: "saved:1", source: "saved", name: "legacy box", destination: "root@legacy.test", port: null };

function props(overrides: Partial<SshHostPickerProps> = {}): SshHostPickerProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    localAllowed: true,
    hosts: [managed, handwritten, saved],
    hostsLoading: false,
    hostsError: null,
    configError: null,
    environments: [{ id: "env-1", name: "staging-env" }],
    environmentsLoading: false,
    recent: ["host:config:db"],
    tests: { "prod-web": { status: "ok", at: "2026-11-14T10:00:00.000Z" } },
    busy: false,
    onOpenHost: vi.fn(),
    onOpenEnvironment: vi.fn(),
    onAddHost: vi.fn(),
    onEditHost: vi.fn(),
    onMoveSaved: vi.fn(),
    onMoveAllSaved: vi.fn(),
    ...overrides,
  };
}

function headings(): string[] {
  return [...document.querySelectorAll("[cmdk-group-heading]")].map((node) => node.textContent ?? "");
}

function optionNames(): string[] {
  return [...document.querySelectorAll("[cmdk-item]")]
    .filter((node) => !(node as HTMLElement).hidden)
    .map((node) => node.querySelector(".font-medium")?.textContent ?? "");
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === label || entry.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`missing button ${label}`);
  return found as HTMLButtonElement;
}

function search(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
  if (!input) throw new Error("missing search input");
  return input;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(target: Element, keyName: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true }));
  });
}

describe("SshHostPicker", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  function render(value: SshHostPickerProps) {
    act(() => root.render(<SshHostPicker {...value} />));
    return value;
  }

  it("puts recent hosts first and groups config hosts, environments and old saved hosts", () => {
    render(props());
    expect(headings()).toEqual(["Recent", "SSH hosts", "Environments", "Saved in Wardmote only (not visible to agents)"]);
    expect(optionNames()).toEqual(["db", "prod-web", "staging-env", "legacy box"]);
    expect(document.body.textContent).toContain("Connected");
    expect(document.body.textContent).toContain("~/.ssh/config");
  });

  it("searches by name or destination and opens the highlighted host with Enter", () => {
    const value = render(props());
    type(search(), "203.0.113");
    expect(optionNames()).toEqual(["prod-web"]);
    key(search(), "Enter");
    expect(value.onOpenHost).toHaveBeenCalledWith(managed);
  });

  it("moves through hosts with the arrow keys and focuses search with /", () => {
    const value = render(props({ recent: [] }));
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    act(() => (dialog as HTMLElement).focus());
    key(dialog, "/");
    expect(document.activeElement).toBe(search());
    key(search(), "ArrowDown");
    key(search(), "Enter");
    expect(value.onOpenHost).toHaveBeenCalledWith(handwritten);
  });

  it("offers edit only for hosts Wardmote wrote, and moving for saved hosts", () => {
    const value = render(props());
    expect(() => button("Edit db")).toThrow();
    act(() => button("Edit prod-web").click());
    expect(value.onEditHost).toHaveBeenCalledWith(managed);
    expect(value.onOpenHost).not.toHaveBeenCalled();
    act(() => button("Move to ssh config").click());
    expect(value.onMoveSaved).toHaveBeenCalledWith(saved);
    act(() => button("Add host").click());
    expect(value.onAddHost).toHaveBeenCalled();
  });

  it("shows non-admins only environments and no way to add hosts", () => {
    render(props({ localAllowed: false, hosts: [], recent: [] }));
    expect(headings()).toEqual(["Environments"]);
    expect(() => button("Add host")).toThrow();
    expect(document.body.textContent).toContain("Only instance admins can add hosts.");
    expect(document.querySelector('a[href="/company/settings/instance/environments"]')).toBeNull();
  });

  it("explains the empty state", () => {
    render(props({ hosts: [], environments: [], recent: [] }));
    expect(document.body.textContent).toContain("No SSH hosts yet");
    expect(document.body.textContent).toContain("ready for this terminal and for agents on this server");
  });
});
