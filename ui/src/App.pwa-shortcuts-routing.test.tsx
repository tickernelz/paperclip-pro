// @vitest-environment jsdom

import type { ReactNode } from "react";
import manifestSource from "../public/site.webmanifest?raw";
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
vi.mock("./pages/WhatNeedsMe", () => ({ WhatNeedsMe: () => <div>DECISIONS_PAGE</div> }));

const openNewIssue = vi.hoisted(() => vi.fn());
vi.mock("./context/DialogContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context/DialogContext")>()),
  useDialogActions: () => ({ openNewIssue, openOnboarding: vi.fn(), openNewAgent: vi.fn() }),
}));

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

  const manifest = JSON.parse(manifestSource) as {
    shortcuts: Array<{ name: string; url: string }>;
  };
  const pageFor: Record<string, string> = {
    Inbox: "INBOX_PAGE",
    Decisions: "DECISIONS_PAGE",
    Tasks: "ISSUES_PAGE",
    "New task": "ISSUES_PAGE",
  };

  it.each(manifest.shortcuts.map((shortcut) => [shortcut.name, shortcut.url] as const))(
    "opens the %s shortcut (%s) inside the selected company",
    async (name, url) => {
      const root = renderAppAt(container, url);
      await vi.waitFor(() => expect(container.textContent).toContain(pageFor[name]));
      expect(container.textContent).not.toContain("No organization matches prefix");
      if (name === "New task") expect(openNewIssue).toHaveBeenCalled();
      else expect(openNewIssue).not.toHaveBeenCalled();
      flushSync(() => root.unmount());
    },
  );
});
