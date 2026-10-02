// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.hoisted(() => {
  const sheetProto = window.CSSStyleSheet.prototype as unknown as {
    insertRule: (rule: string, index?: number) => number;
    __pap13002Patched?: boolean;
  };
  if (!sheetProto.__pap13002Patched) {
    const original = sheetProto.insertRule;
    sheetProto.insertRule = function patched(this: CSSStyleSheet, rule: string, index?: number) {
      try {
        return original.call(this, rule, index);
      } catch {
        try {
          return original.call(this, ".pap13002-noop{}", index);
        } catch {
          return this.cssRules?.length ?? 0;
        }
      }
    };
    sheetProto.__pap13002Patched = true;
  }
});

vi.mock("./components/Layout", async () => {
  const { Outlet, useParams } = await import("react-router-dom");
  return {
    Layout: () => {
      const { companyPrefix } = useParams();
      return companyPrefix === "PAP" ? <Outlet /> : <div>No organization matches prefix</div>;
    },
  };
});

vi.mock("./components/OnboardingWizardVariant", () => ({
  OnboardingWizardVariant: () => null,
}));

vi.mock("./pages/Dashboard", () => ({ Dashboard: () => <div>DASHBOARD_PAGE</div> }));
vi.mock("./pages/Inbox", () => ({ Inbox: () => <div>INBOX_PAGE</div> }));
vi.mock("./pages/Issues", () => ({ Issues: () => <div>ISSUES_PAGE</div> }));

vi.mock("./components/CloudAccessGate", async () => {
  const { Outlet } = await import("react-router-dom");
  return { CloudAccessGate: () => <Outlet /> };
});

const PAP_COMPANY = {
  id: "company-1",
  name: "Paperclip",
  issuePrefix: "PAP",
  status: "active",
};
vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [PAP_COMPANY],
    selectedCompanyId: PAP_COMPANY.id,
    selectedCompany: PAP_COMPANY,
    loading: false,
  }),
  CompanyProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderAppAt(container: HTMLElement, path: string) {
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  return root;
}

describe("App routing for installed-app shortcuts", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it.each([
    ["/inbox/mine?source=pwa-shortcut", "INBOX_PAGE"],
    ["/issues?source=pwa-shortcut", "ISSUES_PAGE"],
    ["/dashboard?source=pwa-shortcut", "DASHBOARD_PAGE"],
  ])("opens %s inside the selected company", async (path, page) => {
    const root = renderAppAt(container, path);
    await vi.waitFor(() => expect(container.textContent).toContain(page));
    expect(container.textContent).not.toContain("No organization matches prefix");
    flushSync(() => root.unmount());
  });
});
