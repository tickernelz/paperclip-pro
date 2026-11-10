import { expect, test } from "@playwright/test";

const AGENT_NAME = "CEO";
const TASK_TITLE = "Wardmote onboarding";

/** Wait for the saved question before checking its dismissed presentation. */
async function expectOpeningQuestionDismissed(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("task-chat-unanswered-question")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("task-chat-composer-takeover")).toHaveCount(0);
  await expect(page.getByTestId("task-chat-pending-input-indicator")).toHaveCount(0);
  await expect(page.getByTestId("task-chat-composer-mode")).toBeVisible({ timeout: 30_000 });
}

/** The opening question arrives after the interactions fetch. Dismiss it once. */
async function dismissOpeningCard(page: import("@playwright/test").Page) {
  const takeover = page.getByTestId("task-chat-composer-takeover");
  await expect(takeover).toBeVisible({ timeout: 30_000 });
  await takeover.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectOpeningQuestionDismissed(page);
}

test("captures planning mode UI for desktop and mobile", async ({ page }) => {
  const timestamp = Date.now();
  const companyName = `PAP-3413-${timestamp}`;
  const screenshotDir = "test-results/planning-mode";

  const createdCompany = await page.request.post("/api/companies", { data: { name: companyName } });
  expect(createdCompany.ok()).toBe(true);
  const company = await createdCompany.json();
  const agentRes = await page.request.post(`/api/companies/${company.id}/agents`, {
    data: {
      name: AGENT_NAME,
      role: "general",
      adapterType: "process",
      adapterConfig: { command: "true" },
      runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
      onboardingFirstAgent: true,
    },
  });
  expect(agentRes.ok()).toBe(true);
  const agent = await agentRes.json();
  const projectRes = await page.request.post(`/api/companies/${company.id}/projects`, {
    data: { name: "Onboarding", status: "in_progress" },
  });
  expect(projectRes.ok()).toBe(true);
  const project = await projectRes.json();
  const issueRes = await page.request.post(`/api/companies/${company.id}/issues`, {
    data: { title: TASK_TITLE, assigneeAgentId: agent.id, projectId: project.id, status: "todo", onboardingFirstTask: true },
  });
  expect(issueRes.ok()).toBe(true);
  const planningSeedIssue = await issueRes.json();

  const issue = planningSeedIssue;
  const issueIdentifier = issue.identifier ?? issue.id;
  const issuePath = `/${company.issuePrefix ?? company.id}/issues/${issueIdentifier}`;
  const companyPrefix = company.issuePrefix ?? company.id;
  const issueLinkSelector = `a[href$="/issues/${issueIdentifier}"]`;

  const setMode = async (mode: "standard" | "planning") => {
    const patchRes = await page.request.patch(`/api/issues/${issue.id}`, {
      data: { workMode: mode },
    });
    expect(patchRes.ok()).toBe(true);
    await expect
      .poll(async () => {
        const currentRes = await page.request.get(`/api/issues/${issue.id}`);
        expect(currentRes.ok()).toBe(true);
        const current = await currentRes.json();
        return current.workMode;
      }, { timeout: 10_000 })
      .toBe(mode);
  };

  await setMode("planning");

  await page.goto(issuePath);
  await dismissOpeningCard(page);
  await page.reload();
  await expectOpeningQuestionDismissed(page);
  await expect(page.getByText("Plan mode").first()).toBeVisible();
  const desktopPlanningToggle = page.getByTestId("task-chat-composer-mode");
  await expect(desktopPlanningToggle).toBeVisible();
  await expect(desktopPlanningToggle).toHaveAttribute("data-pending-work-mode", "planning");

  await page.screenshot({
    path: `${screenshotDir}/desktop-planning-detail-${timestamp}.png`,
    fullPage: true,
  });

  await page.goto(`/${companyPrefix}/issues`);
  await expect(page.locator(issueLinkSelector)).toBeVisible();
  await expect(page.locator(issueLinkSelector)).not.toContainText("Plan mode");
  await page.screenshot({
    path: `${screenshotDir}/desktop-planning-row-${timestamp}.png`,
    fullPage: true,
  });

  await page.goto(issuePath);
  await expectOpeningQuestionDismissed(page);
  await page.getByTestId("task-chat-composer-mode").click();
  await expect(page.getByTestId("task-chat-composer-mode")).toHaveCount(0);
  await expect(page.getByTestId("task-chat-composer-add")).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/desktop-standard-toggle-${timestamp}.png`,
    fullPage: true,
  });

  await setMode("planning");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(issuePath);
  await expectOpeningQuestionDismissed(page);
  await expect(page.getByText("Plan mode").first()).toBeVisible();
  const mobilePlanningToggle = page.getByTestId("task-chat-composer-mode");
  await expect(mobilePlanningToggle).toBeVisible();
  await expect(mobilePlanningToggle).toHaveAttribute("data-pending-work-mode", "planning");
  await page.screenshot({
    path: `${screenshotDir}/mobile-planning-detail-${timestamp}.png`,
    fullPage: true,
  });

  await page.goto(`/${companyPrefix}/issues`);
  await expect(page.locator(issueLinkSelector)).toBeVisible();
  await expect(page.locator(issueLinkSelector)).not.toContainText("Plan mode");
  await page.screenshot({
    path: `${screenshotDir}/mobile-planning-row-${timestamp}.png`,
    fullPage: true,
  });
});
