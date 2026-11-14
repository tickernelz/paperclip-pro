// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SshConfigHostSettings, SshConnectionTestResult, SshKeyInfo, TerminalSshHost } from "@tickernelz/wardmote-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SshHostForm, settingsFromSavedHost, type SshHostFormMode } from "./SshHostForm";

const api = vi.hoisted(() => ({
  listKeys: vi.fn(),
  createKey: vi.fn(),
  testConnection: vi.fn(),
  trustHostKey: vi.fn(),
  addConfigHost: vi.fn(),
  updateConfigHost: vi.fn(),
  removeConfigHost: vi.fn(),
  moveSshHostToConfig: vi.fn(),
}));

vi.mock("@/api/terminal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/terminal")>();
  return { ...actual, terminalApi: { ...actual.terminalApi, ...api } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY_ID = "company-1";
const existingKey: SshKeyInfo = {
  name: "id_ed25519",
  path: "~/.ssh/id_ed25519",
  type: "ssh-ed25519",
  fingerprint: "SHA256:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
  comment: "me",
  encrypted: false,
  publicKey: "ssh-ed25519 AAAAexisting me",
};
const jumpHost: TerminalSshHost = { id: "config:bastion", source: "config", name: "bastion", destination: "bastion.test", port: null };

function result(status: SshConnectionTestResult["status"], extra: Partial<SshConnectionTestResult> = {}): SshConnectionTestResult {
  return { status, message: `message for ${status}`, detail: status === "ok" ? null : `ssh said ${status}`, hostKeys: [], durationMs: 12, ...extra };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const node = [...document.querySelectorAll("label")].find((entry) => entry.textContent === label);
  const control = node ? document.getElementById(node.htmlFor) : null;
  if (!control) throw new Error(`missing field ${label}`);
  return control as HTMLInputElement;
}

function setValue(label: string, value: string) {
  const control = field(label);
  const proto = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
  if (!found) throw new Error(`missing button ${label}`);
  return found as HTMLButtonElement;
}

async function click(label: string) {
  act(() => button(label).click());
  await settle();
}

describe("SshHostForm", () => {
  let root: Root;
  let container: HTMLDivElement;
  let onSaved: ReturnType<typeof vi.fn>;
  let onRemoved: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    api.listKeys.mockResolvedValue({ keys: [existingKey], sshDir: "/home/u/.ssh" });
    api.addConfigHost.mockImplementation(async (_companyId: string, body: SshConfigHostSettings) => body);
    api.updateConfigHost.mockImplementation(async (_companyId: string, _alias: string, body: SshConfigHostSettings) => body);
    api.moveSshHostToConfig.mockImplementation(async (_companyId: string, _id: string, body: SshConfigHostSettings) => body);
    api.removeConfigHost.mockResolvedValue(undefined);
    onSaved = vi.fn();
    onRemoved = vi.fn();
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  function createdKey(key: SshKeyInfo) {
    api.createKey.mockImplementation(async () => {
      api.listKeys.mockResolvedValue({ keys: [existingKey, key], sshDir: "/home/u/.ssh" });
      return key;
    });
  }

  async function render(mode: SshHostFormMode = { kind: "add" }, configHosts: TerminalSshHost[] = [jumpHost]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <SshHostForm
            companyId={COMPANY_ID}
            open
            onOpenChange={vi.fn()}
            mode={mode}
            configHosts={configHosts}
            onSaved={onSaved}
            onRemoved={onRemoved}
          />
        </QueryClientProvider>,
      ),
    );
    await settle();
  }

  function fillBasics(alias = "prod-web") {
    setValue("Name", alias);
    setValue("Host or IP address", "203.0.113.10");
    setValue("User", "deploy");
    setValue("Port", "2222");
  }

  it("validates before saving and explains each field", async () => {
    await render();
    await click("Save and connect");
    expect(document.body.textContent).toContain("Enter a name, for example prod-web.");
    expect(document.body.textContent).toContain("Enter the server's host name or IP address.");
    setValue("Name", "web*");
    setValue("Port", "70000");
    expect(document.body.textContent).toContain("Use letters, digits, dots, dashes or underscores.");
    expect(document.body.textContent).toContain("Port must be a number from 1 to 65535.");
    setValue("Name", "Bastion");
    expect(document.body.textContent).toContain("A host with this name already exists.");
    expect(api.addConfigHost).not.toHaveBeenCalled();
  });

  it("saves a host with an existing key, a jump host and keep-alive, then asks to connect", async () => {
    await render();
    fillBasics();
    setValue("Key file", "~/.ssh/id_ed25519");
    expect(document.body.textContent).toContain(existingKey.fingerprint!);
    await click("More options");
    setValue("Connect via", "bastion");
    setValue("Keep-alive (seconds)", "30");
    await click("Save and connect");
    const expected: SshConfigHostSettings = {
      alias: "prod-web",
      hostName: "203.0.113.10",
      user: "deploy",
      port: 2222,
      identityFile: "~/.ssh/id_ed25519",
      proxyJump: "bastion",
      serverAliveInterval: 30,
      serverAliveCountMax: null,
    };
    expect(api.addConfigHost).toHaveBeenCalledWith(COMPANY_ID, expected);
    expect(onSaved).toHaveBeenCalledWith(expected, true);
  });

  it("creates an ed25519 key and shows its public key with a copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    createdKey({ ...existingKey, name: "wardmote_prod-web", path: "~/.ssh/wardmote_prod-web", publicKey: "ssh-ed25519 AAAAnew prod-web@wardmote" });
    await render();
    fillBasics();
    await click("Create new key");
    expect((field("New key file name") as HTMLInputElement).value).toBe("wardmote_prod-web");
    await click("Create ed25519 key");
    expect(api.createKey).toHaveBeenCalledWith(COMPANY_ID, { mode: "generate", name: "wardmote_prod-web", comment: "prod-web@wardmote" });
    expect(document.body.textContent).toContain("Add this public key to ~/.ssh/authorized_keys on the server");
    await click("Copy public key");
    expect(writeText).toHaveBeenCalledWith("ssh-ed25519 AAAAnew prod-web@wardmote");
    expect(document.body.textContent).toContain("Copied");
    await click("Save");
    expect(api.addConfigHost).toHaveBeenCalledWith(COMPANY_ID, expect.objectContaining({ identityFile: "~/.ssh/wardmote_prod-web" }));
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("stores a pasted key, forgets the pasted text and warns about passphrases", async () => {
    createdKey({ ...existingKey, name: "pasted", path: "~/.ssh/pasted", encrypted: true });
    await render();
    fillBasics();
    await click("Paste a key");
    setValue("Save as", "pasted");
    setValue("Private key", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----");
    await click("Save key");
    expect(api.createKey).toHaveBeenCalledWith(COMPANY_ID, {
      mode: "import",
      name: "pasted",
      privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
    });
    expect(document.body.textContent).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(document.body.textContent).toContain("This key has a passphrase.");
  });

  it.each([
    ["ok"],
    ["auth_failed"],
    ["dns_failed"],
    ["unreachable"],
    ["timeout"],
    ["key_unusable"],
    ["host_key_changed"],
  ] as const)("shows the %s connection test result", async (status) => {
    api.testConnection.mockResolvedValue(result(status));
    await render();
    fillBasics();
    await click("ssh defaults");
    await click("Test connection");
    expect(api.testConnection).toHaveBeenCalledWith(COMPANY_ID, { host: expect.objectContaining({ alias: "prod-web", identityFile: null }) });
    const panel = document.querySelector('[data-testid="ssh-test-result"]');
    expect(panel?.textContent).toContain(`message for ${status}`);
    if (status !== "ok") expect(panel?.textContent).toContain("ssh output");
    expect(() => button("Trust this host and test again")).toThrow();
    expect(JSON.parse(window.localStorage.getItem(`wardmote:terminal-ssh-tests:v1:${COMPANY_ID}`) ?? "{}")["prod-web"].status).toBe(status);
  });

  it("asks before trusting an unknown host key, then tests again", async () => {
    const hostKeys = [{ type: "ssh-ed25519", fingerprint: "SHA256:hostkeyhostkeyhostkeyhostkeyhostkeyhostkey123" }];
    api.testConnection.mockResolvedValueOnce(result("host_key_unknown", { hostKeys })).mockResolvedValueOnce(result("ok"));
    api.trustHostKey.mockResolvedValue({ added: hostKeys, knownHostsPath: "/home/u/.ssh/known_hosts" });
    await render();
    fillBasics();
    await click("ssh defaults");
    await click("Test connection");
    expect(document.body.textContent).toContain(hostKeys[0]!.fingerprint);
    expect(api.trustHostKey).not.toHaveBeenCalled();
    await click("Trust this host and test again");
    expect(api.trustHostKey).toHaveBeenCalledWith(COMPANY_ID, {
      target: { host: expect.objectContaining({ alias: "prod-web" }) },
      fingerprints: [hostKeys[0]!.fingerprint],
    });
    expect(api.testConnection).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="ssh-test-result"]')?.textContent).toContain("message for ok");
  });

  it("moves an old saved host into the ssh config", async () => {
    const saved: TerminalSshHost = { id: "saved:1", source: "saved", name: "legacy box", destination: "root@legacy.test", port: 2200 };
    const settings = settingsFromSavedHost(saved);
    expect(settings).toMatchObject({ alias: "legacy-box", hostName: "legacy.test", user: "root", port: 2200 });
    await render({ kind: "move", saved, settings });
    await click("Save and connect");
    expect(api.moveSshHostToConfig).toHaveBeenCalledWith(COMPANY_ID, "saved:1", settings);
  });

  it("edits a managed host and removes it after a second click", async () => {
    const settings: SshConfigHostSettings = {
      alias: "prod-web",
      hostName: "203.0.113.10",
      user: null,
      port: null,
      identityFile: null,
      proxyJump: null,
      serverAliveInterval: null,
      serverAliveCountMax: null,
    };
    await render({ kind: "edit", settings }, [jumpHost, { id: "config:prod-web", source: "config", name: "prod-web", destination: "203.0.113.10", port: null }]);
    setValue("User", "ops");
    await click("Save changes");
    expect(api.updateConfigHost).toHaveBeenCalledWith(COMPANY_ID, "prod-web", { ...settings, user: "ops" });
    await click("Remove host");
    expect(api.removeConfigHost).not.toHaveBeenCalled();
    await click("Click again to remove");
    expect(api.removeConfigHost).toHaveBeenCalledWith(COMPANY_ID, "prod-web");
    expect(onRemoved).toHaveBeenCalledWith("prod-web");
  });
});
