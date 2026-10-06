import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Locator, type Page } from "@playwright/test";

async function json(response: APIResponse) {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function swipeToLastOption(page: Page, picker: Locator, listName: string) {
  const list = picker.getByRole("listbox", { name: listName, exact: true });
  const last = list.getByRole("option").last();
  await expect.poll(() => picker.evaluate((element) => element.getAnimations({ subtree: true })
    .every((animation) => animation.playState !== "running"))).toBe(true);
  // visualViewport resize updates React state after the browser viewport changes.
  await expect.poll(async () => {
    const bounds = (await picker.boundingBox())!;
    return bounds.y + bounds.height;
  }).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect.poll(async () => {
    const bounds = (await list.boundingBox())!;
    return bounds.y + bounds.height;
  }).toBeLessThanOrEqual(page.viewportSize()!.height);
  const session = await page.context().newCDPSession(page);
  try {
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const bounds = (await list.boundingBox())!;
      const target = (await last.boundingBox())!;
      if (target.y >= bounds.y && target.y + target.height <= bounds.y + bounds.height) break;
      const before = await list.evaluate((element) => element.scrollTop);
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height - 10;
      const distance = Math.max(16, Math.min(180, bounds.height - 30));
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 12; step += 1) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{ x, y: y - distance * step / 12 }],
        });
        // Pace native finger movement across compositor frames.
        await page.waitForTimeout(20);
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
      // A drag must not choose a row or dismiss the picker.
      await expect(picker).toBeVisible();
      await expect(list).toBeVisible();
    }
    const bounds = (await list.boundingBox())!;
    const target = (await last.boundingBox())!;
    expect(target.y).toBeGreaterThanOrEqual(bounds.y);
    expect(target.y + target.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
  } finally {
    await session.detach();
  }
  return last;
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("new-task assignee and model sheets scroll by touch and retain the selected values", async ({ page, request, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Native touch drags use Chromium's input protocol.");
  test.setTimeout(120_000);
  const company = await json(await request.post("/api/companies", {
    data: { name: `Touch pickers ${randomUUID()}` },
  }));
  for (let index = 1; index <= 22; index += 1) {
    await json(await request.post(`/api/companies/${company.id}/agents`, {
      data: {
        name: `Touch Agent ${String(index).padStart(2, "0")}`, role: "engineer",
        adapterType: "codex_local", adapterConfig: { model: "gpt-6-sol" },
        runtimeConfig: { heartbeat: { enabled: false } },
      },
    }));
  }
  // Keep the provider catalog deterministic; task UI, agents, and drafts are real.
  await page.route("**/api/agents/batch/adapter-config/preview", (route) => {
    const { agentIds } = route.request().postDataJSON() as { agentIds: string[] };
    return route.fulfill({
      json: {
        fields: [
          {
            key: "model", label: "Model", hint: null, freeText: true,
            options: Array.from({ length: 24 }, (_, index) => ({
              value: `touch-model-${String(index + 1).padStart(2, "0")}`,
              label: `Touch Model ${String(index + 1).padStart(2, "0")}`,
            })),
          },
          {
            key: "thinking", label: "Thinking", hint: null, freeText: false,
            options: ["low", "medium", "high"].map((value) => ({ value, label: value })),
          },
        ],
        agents: agentIds.map((agentId) => ({
          agentId, name: agentId, adapterType: "codex_local", eligible: true, reason: null,
          current: { model: "gpt-6-sol", thinking: null },
        })),
      },
    });
  });
  await page.goto(`/${company.issuePrefix}/dashboard`);
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "New Task", exact: true }).tap();
  const draft = page.getByRole("textbox", { name: "editable markdown" });
  await draft.fill("Keep this touch selection draft");
  const trigger = page.getByRole("button", { name: "Select assignee, model and thinking", exact: true });
  const picker = page.getByTestId("composer-run-settings-panel");
  const assigneeRow = picker.getByTestId("composer-run-settings-assignee-row");
  const modelRow = picker.getByRole("button", { name: "Choose exact model", exact: true });
  await trigger.tap();
  await assigneeRow.tap();
  const lastAssignee = await swipeToLastOption(page, picker, "Assignees");
  await expect(lastAssignee).toContainText("Touch Agent 22");
  await lastAssignee.tap();
  await expect(picker.getByRole("listbox", { name: "Assignees", exact: true })).toBeHidden();
  await expect(assigneeRow).toContainText("Touch Agent 22");
  await modelRow.tap();
  // A reduced viewport exercises the space available when a phone keyboard opens.
  await page.setViewportSize({ width: 390, height: 430 });
  const lastModel = await swipeToLastOption(page, picker, "Models");
  await expect(lastModel).toContainText("Touch Model 24");
  await lastModel.tap();
  await expect(picker.getByTestId("composer-run-settings-model-value")).toHaveText("touch-model-24");
  await picker.getByRole("button", { name: "Close Run settings picker", exact: true }).tap();
  await expect(picker).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("task-chat-composer-assignee-label")).toHaveText("Touch Agent 22");
  await expect(page.getByTestId("task-chat-composer-run-summary")).toHaveText("touch-model-24");
  await expect(draft).toHaveText("Keep this touch selection draft");

  // Closing the nested picker preserves the outer composer draft and choices.
  await trigger.tap();
  await modelRow.tap();
  await picker.getByRole("searchbox", { name: "Search or paste a model ID" }).press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(draft).toHaveText("Keep this touch selection draft");
  await expect(page.getByTestId("task-chat-composer-assignee-label")).toHaveText("Touch Agent 22");
  await expect(page.getByTestId("task-chat-composer-run-summary")).toHaveText("touch-model-24");
  await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("selected-mobile-assignee-and-model.png") });

  // The desktop picker uses the same selected values and supports model search.
  await page.setViewportSize({ width: 1280, height: 900 });
  await trigger.click();
  await modelRow.click();
  await picker.getByRole("searchbox", { name: "Search or paste a model ID" }).fill("Touch Model 01");
  await picker.getByRole("option", { name: "Touch Model 01", exact: true }).click();
  await expect(picker.getByTestId("composer-run-settings-model-value")).toHaveText("touch-model-01");
  await modelRow.press("Escape");
  await expect(picker).toBeHidden();
  await expect(page.getByTestId("task-chat-composer-assignee-label")).toHaveText("Touch Agent 22");
  await expect(page.getByTestId("task-chat-composer-run-summary")).toHaveText("touch-model-01");
});
