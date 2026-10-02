// @vitest-environment jsdom

import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetInstallPromptForTests } from "../lib/pwa-install-prompt";
import { InstallAppMenuAction, IosInstallHelpDialog } from "./InstallAppMenuAction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function MenuHost() {
  const [menuOpen, setMenuOpen] = useState(true);
  return (
    <>
      {menuOpen ? (
        <div data-testid="menu">
          <InstallAppMenuAction variant="compact-menu-action" onAfterAction={() => setMenuOpen(false)} />
        </div>
      ) : null}
      <IosInstallHelpDialog />
    </>
  );
}

describe("InstallAppMenuAction on iOS", () => {
  const originalUserAgent = navigator.userAgent;
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
    resetInstallPromptForTests();
    container.remove();
    document.body.innerHTML = "";
  });

  it("keeps the Add to Home Screen steps open after the menu closes", async () => {
    const root = createRoot(container);
    flushSync(() => root.render(<MenuHost />));

    const action = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Install app");
    expect(action).toBeDefined();
    flushSync(() => action!.click());

    expect(container.querySelector('[data-testid="menu"]')).toBeNull();
    await expect.poll(() => document.body.textContent).toContain("Add to Home Screen");

    flushSync(() => root.unmount());
  });
});
