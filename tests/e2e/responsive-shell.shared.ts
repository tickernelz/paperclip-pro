import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { json } from "./agent-chat.shared";
import { hasOverflow, probeResponsive, RESPONSIVE_SIZES, TOUCH_TARGET_BREAKPOINT, type ResponsiveFinding } from "./helpers/responsive-probe";

type Seed = { prefix: string; issue: string; agent: string; ompAgent: string; restore: (request: APIRequestContext) => Promise<void> };

const SCREENS = [
  ["Home", "dashboard"],
  ["Inbox", "inbox/mine"],
  ["Decisions", "decisions"],
  ["Tasks", "issues"],
  ["Task detail", "issues/:issue"],
  ["Agents", "agents/all"],
  ["Agent detail", "agents/:agent"],
  ["Chat", "chats"],
  ["Projects", "projects"],
  ["Costs", "activity/costs"],
  ["Settings", "company/settings"],
  ["Features", "company/settings/instance/features"],
  ["Agent defaults", "company/settings/agent-defaults"],
  ["All settings", "company/settings/agent-defaults/all"],
  ["Models and providers", "company/settings/models"],
  ["Agent setup", "agents/:ompAgent/setup"],
] as const;

let seed: Seed;

async function seedCompany(request: APIRequestContext): Promise<Seed> {
  const original = await json(await request.get("/api/instance/settings/experimental"));
  await json(await request.patch("/api/instance/settings/experimental", {
    data: { enableAgentChat: true, enableDecisions: true },
  }));
  const company = await json(await request.post("/api/companies", { data: { name: `Responsive ${Date.now()}` } }));
  const agent = await json(await request.post(`/api/companies/${company.id}/agents`, {
    data: {
      name: "Responsive Agent",
      adapterType: "process",
      adapterConfig: { command: process.execPath, args: [path.resolve("tests/e2e/fixtures/agent-chat.mjs")], graceSec: 1 },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
    },
  }));
  const ompAgent = await json(await request.post(`/api/companies/${company.id}/agents`, {
    data: { name: "Responsive OMP Agent", adapterType: "omp_local", runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } } },
  }));
  await json(await request.post(`/api/companies/${company.id}/projects`, { data: { name: "Responsive project with a long descriptive name" } }));
  const issue = await json(await request.post(`/api/companies/${company.id}/issues`, {
    data: { title: "Check every core screen from a narrow phone to a wide desktop monitor", status: "backlog" },
  }));
  await json(await request.post(`/api/companies/${company.id}/issues`, {
    data: { title: "Sub-task row with its own status control", status: "todo", parentId: issue.id },
  }));
  await json(await request.post(`/api/issues/${issue.id}/comments`, {
    data: { body: "A long comment with a link https://example.com/a/very/long/path/that/should/wrap/instead/of/overflowing/the/viewport" },
  }));
  return {
    prefix: company.issuePrefix,
    issue: issue.identifier,
    agent: agent.id,
    ompAgent: ompAgent.id,
    restore: async (request) => {
      await json(await request.patch("/api/instance/settings/experimental", {
        data: { enableAgentChat: original.enableAgentChat, enableDecisions: original.enableDecisions },
      }));
    },
  };
}

async function settle(page: Page) {
  await page.locator("#main-content").waitFor({ state: "attached", timeout: 30_000 });
  await page
    .waitForFunction(() => document.querySelectorAll("#main-content .animate-pulse, #main-content [data-slot=skeleton]").length === 0, null, { timeout: 8_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
}

function screenUrl(route: string) {
  return `/${seed.prefix}/${route.replace(":issue", seed.issue).replace(":ompAgent", seed.ompAgent).replace(":agent", seed.agent)}`;
}

export function useResponsiveSeed() {
  test.beforeAll(async ({ request }) => {
    seed = await seedCompany(request);
  });

  test.afterAll(async ({ request }) => {
    await seed?.restore(request);
  });
}

export function coreScreenCases() {
  return RESPONSIVE_SIZES.flatMap((size) => pointersFor(size.width).map((pointer) => ({ size, pointer })));
}

export async function checkCoreScreens(
  browser: Browser,
  baseURL: string | undefined,
  size: (typeof RESPONSIVE_SIZES)[number],
  theme: "light" | "dark",
  pointer: "coarse" | "fine",
) {
  test.setTimeout(180_000);
  const touch = pointer === "coarse";
  const context = await browser.newContext({ baseURL, viewport: size, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript((value) => window.localStorage.setItem("paperclip.theme", value), theme);
  const failures: Array<{ screen: string } & ResponsiveFinding> = [];
  for (const [screen, route] of SCREENS) {
    await page.goto(screenUrl(route));
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
    const finding = await probeResponsive(page);
    if (hasOverflow(finding) || finding.smallTargets.length > 0) failures.push({ screen, ...finding });
  }
  await test.info().attach(`responsive-${size.width}-${theme}-${pointer}.json`, {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(failures, null, 2)),
  });
  await context.close();
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
}

export async function probeFlagsOverflowAndSmallTarget(page: Page) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(screenUrl("dashboard"));
  await settle(page);
  await page.addStyleTag({ content: "#main-content::after { content: ''; display: block; width: 2000px; height: 1px; }" });
  await page.evaluate(() => {
    const target = document.createElement("button");
    target.textContent = "x";
    target.setAttribute("style", "position: relative; width: 16px; height: 16px; min-block-size: 0; padding: 0; font-size: 10px; line-height: 1");
    document.getElementById("main-content")?.prepend(target);
  });
  const finding = await probeResponsive(page);
  expect(hasOverflow(finding)).toBe(true);
  expect(finding.smallTargets.some((target) => target.endsWith(":16x16"))).toBe(true);
}

function pointersFor(width: number) {
  if (width >= TOUCH_TARGET_BREAKPOINT) return ["fine"] as const;
  return width >= 768 ? (["coarse", "fine"] as const) : (["coarse"] as const);
}
