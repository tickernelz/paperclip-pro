// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TerminalSshHost } from "@tickernelz/wardmote-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalStartScreen, type TerminalStartScreenProps } from "./TerminalStartScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recentHost: TerminalSshHost = { id: "config:prod", source: "config", name: "prod", destination: "prod.test", port: null };

describe("TerminalStartScreen", () => {
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
  });

  function render(overrides: Partial<TerminalStartScreenProps> = {}) {
    const props: TerminalStartScreenProps = {
      localAllowed: true,
      creating: false,
      onLocal: vi.fn(),
      onSsh: vi.fn(),
      recentHosts: [],
      onOpenHost: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<TerminalStartScreen {...props} />));
    return props;
  }

  const option = (testId: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

  it("lets an instance admin choose a local or an SSH terminal and reopen a recent host", () => {
    const props = render({ recentHosts: [recentHost] });
    act(() => option("terminal-start-local").click());
    act(() => option("terminal-start-ssh").click());
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "prod")!.click());
    expect(props.onLocal).toHaveBeenCalledTimes(1);
    expect(props.onSsh).toHaveBeenCalledTimes(1);
    expect(props.onOpenHost).toHaveBeenCalledWith(recentHost);
  });

  it("disables the local terminal for other members and says why", () => {
    const props = render({ localAllowed: false });
    const local = option("terminal-start-local");
    expect(local.disabled).toBe(true);
    expect(container.querySelector(`#${local.getAttribute("aria-describedby")}`)?.textContent).toBe("Needs instance admin access.");
    act(() => option("terminal-start-ssh").click());
    expect(props.onSsh).toHaveBeenCalledTimes(1);
    expect(option("terminal-start-ssh").textContent).toContain("SSH environment registered for this company");
  });
});
