import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_MODEL, mockOnboardingOmp, ompStatus } from "./helpers/onboarding-omp";
import { hasOverflow, probeResponsive, TOUCH_TARGET_BREAKPOINT } from "./helpers/responsive-probe";

const V1 = { steps: 12, decisions: 4, clicks: 9, fields: 4 };
const V2 = { steps: 5, decisions: 1, clicks: 3, fields: 1 };
const SHOTS_DIR = path.resolve(import.meta.dirname, "test-results/onboarding-shots");
const SIZES = [
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;
const THEMES = ["light", "dark"] as const;

async function openOnboarding(page: Page) {
  await page.goto("/onboarding");
  const start = page.getByRole("button", { name: /Start Onboarding|New Organization|Add Agent/ });
  const flow = page.getByTestId("onboarding-flow");
  await expect(flow.or(start.first())).toBeVisible({ timeout: 30_000 });
  if (!(await flow.isVisible())) await start.first().click();
  await expect(flow).toBeVisible();
}

class Counter {
  clicks = 0;
  fields = 0;
  decisions = 0;
  steps: string[] = [];

  step(name: string) {
    this.steps.push(name);
  }

  async click(target: Locator, options: { decision?: boolean } = {}) {
    await target.click();
    this.clicks += 1;
    if (options.decision) this.decisions += 1;
  }

  async fill(target: Locator, value: string) {
    await target.fill(value);
    this.fields += 1;
  }

  totals() {
    return { steps: this.steps.length, decisions: this.decisions, clicks: this.clicks, fields: this.fields };
  }
}

test.describe("Onboarding", () => {
  test("a new user reaches a working first agent in 5 steps, 1 decision, 3 clicks and 1 field", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const mock = await mockOnboardingOmp(page.context(), ompStatus({ state: "missing", path: null, version: null, copies: [], models: [], recommendedModel: null }));
    const counter = new Counter();
    const flow = page.getByTestId("onboarding-flow");

    await openOnboarding(page);
    await expect(page.getByRole("heading", { name: "Install OMP" })).toBeVisible();
    await expect(page.getByText("curl -fsSL https://omp.sh/install | sh")).toBeVisible();
    await expect(flow.getByRole("button", { name: /^Continue/ })).toHaveCount(0);
    counter.step("check-omp");

    mock.status = ompStatus({ models: [], recommendedModel: null });
    await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({ timeout: 10_000 });
    const popup = page.context().waitForEvent("page");
    await counter.click(page.getByRole("radio", { name: /^OpenAI/ }), { decision: true });
    await counter.click(page.getByRole("button", { name: "Sign in with OpenAI" }));
    counter.step("connect-model");
    await (await popup).close();
    expect(mock.logins).toEqual(["openai-codex"]);

    mock.status = ompStatus();
    await expect(page.getByRole("heading", { name: "What should your first agent do?" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`${E2E_MODEL.label} (recommended)`)).toBeVisible();
    counter.step("model-picked");
    const title = `Onboarding e2e ${Date.now()}`;
    await counter.fill(page.getByLabel("First task"), `${title}\nList the three riskiest modules.`);
    counter.step("first-task");
    await counter.click(page.getByRole("button", { name: "Start" }));
    counter.step("start");

    await page.waitForURL(/\/issues\/[A-Z0-9]+-\d+/, { timeout: 30_000 });
    await expect(flow).toHaveCount(0);

    const companies = await (await page.request.get("/api/companies")).json() as Array<{ id: string }>;
    let found: { issue: Record<string, unknown>; companyId: string } | null = null;
    for (const company of companies) {
      const issues = await (await page.request.get(`/api/companies/${company.id}/issues`)).json() as Array<Record<string, unknown>>;
      const issue = issues.find((entry) => entry.title === title);
      if (issue) found = { issue, companyId: company.id };
    }
    expect(found, "the first task exists").not.toBeNull();
    const agent = await (await page.request.get(`/api/agents/${found!.issue.assigneeAgentId as string}`)).json() as Record<string, any>;
    expect(agent).toMatchObject({ name: "Atlas", role: "general", adapterType: "omp_local" });
    expect(agent.adapterConfig).toMatchObject({ model: E2E_MODEL.id, cwd: process.cwd() });

    const totals = counter.totals();
    await testInfo.attach("onboarding-flow-count.json", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ v1: V1, v2: totals, steps: counter.steps }, null, 2)),
    });
    await fs.mkdir(SHOTS_DIR, { recursive: true });
    await fs.writeFile(path.join(SHOTS_DIR, "flow-count.json"), JSON.stringify({ v1: V1, v2: totals, steps: counter.steps }, null, 2));
    expect(totals).toEqual(V2);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("skips Connect a model when OMP already has a signed-in model", async ({ page }) => {
    await mockOnboardingOmp(page.context(), ompStatus());
    await openOnboarding(page);
    await expect(page.getByRole("heading", { name: "What should your first agent do?" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Atlas, general assistant")).toBeVisible();
    await expect(page.getByRole("region", { name: "First agent" }).getByText(process.cwd(), { exact: true })).toBeVisible();
  });

  test("an outdated OMP never gets past Check OMP", async ({ page }) => {
    await mockOnboardingOmp(page.context(), ompStatus({
      state: "too_old",
      version: "18.0.2",
      path: "/usr/local/bin/omp",
      copies: [{ path: "/usr/local/bin/omp", version: "18.0.2" }, { path: "/home/ada/.bun/bin/omp", version: "18.18.0" }],
    }));
    await openOnboarding(page);
    await expect(page.getByRole("heading", { name: "Update OMP" })).toBeVisible();
    await expect(page.getByText("omp update", { exact: true })).toBeVisible();
    await expect(page.getByText(/Two copies of omp are installed/)).toBeVisible();
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("onboarding-flow")).toHaveAttribute("data-step", "0");
  });
});

type ShotState = { name: string; prepare: (page: Page) => Promise<void> };

const STATES: ShotState[] = [
  {
    name: "check",
    prepare: async (page) => {
      await mockOnboardingOmp(page.context(), ompStatus({ state: "missing", path: null, version: null, copies: [], models: [], recommendedModel: null }));
      await openOnboarding(page);
      await expect(page.getByRole("heading", { name: "Install OMP" })).toBeVisible();
    },
  },
  {
    name: "old",
    prepare: async (page) => {
      await mockOnboardingOmp(page.context(), ompStatus({
        state: "too_old",
        version: "18.0.2",
        path: "/usr/local/bin/omp",
        copies: [{ path: "/usr/local/bin/omp", version: "18.0.2" }, { path: "/home/ada/.bun/bin/omp", version: "18.18.0" }],
      }));
      await openOnboarding(page);
      await expect(page.getByRole("heading", { name: "Update OMP" })).toBeVisible();
    },
  },
  {
    name: "offline",
    prepare: async (page) => {
      await mockOnboardingOmp(page.context(), ompStatus({ state: "missing", path: null, version: null, copies: [], models: [], recommendedModel: null, network: "offline" }));
      await openOnboarding(page);
      await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    name: "remote",
    prepare: async (page) => {
      const mock = await mockOnboardingOmp(page.context(), ompStatus({ state: "missing", path: null, version: null, copies: [], models: [], recommendedModel: null }));
      mock.remote = {
        address: "", host: "build-box", port: 22, username: "ada", connected: true, latencyMs: 42,
        state: "too_old", path: "/home/ada/.local/bin/omp", version: "18.0.2", modelCount: 0, homeFolder: "/home/ada", error: null,
      };
      await openOnboarding(page);
      await page.getByRole("button", { name: "Run agents on another machine" }).click();
      await page.getByLabel("SSH address").fill("ada@build-box");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Connected")).toBeVisible();
    },
  },
  {
    name: "connect",
    prepare: async (page) => {
      await mockOnboardingOmp(page.context(), ompStatus({ models: [], recommendedModel: null }));
      await openOnboarding(page);
      await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({ timeout: 10_000 });
    },
  },
  {
    name: "task",
    prepare: async (page) => {
      await mockOnboardingOmp(page.context(), ompStatus());
      await openOnboarding(page);
      await expect(page.getByRole("heading", { name: "What should your first agent do?" })).toBeVisible({ timeout: 10_000 });
    },
  },
];

for (const theme of THEMES) {
  for (const size of SIZES) {
    test(`onboarding screens fit ${size.width}x${size.height} (${theme})`, async ({ browser, baseURL }) => {
      test.setTimeout(180_000);
      const touch = size.width < TOUCH_TARGET_BREAKPOINT;
      const failures: Array<Record<string, unknown>> = [];
      await fs.mkdir(SHOTS_DIR, { recursive: true });
      for (const state of STATES) {
        const context = await browser.newContext({ baseURL, viewport: size, hasTouch: touch, isMobile: touch });
        const page = await context.newPage();
        await page.addInitScript((value) => window.localStorage.setItem("paperclip.theme", value), theme);
        await state.prepare(page);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => document.getElementById("root")?.setAttribute("inert", ""));
        const finding = await probeResponsive(page);
        if (hasOverflow(finding) || finding.smallTargets.length > 0) failures.push({ state: state.name, ...finding });
        await page.screenshot({ path: path.join(SHOTS_DIR, `${state.name}-${size.width}-${theme}.png`), fullPage: true });
        await context.close();
      }
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
  }
}
