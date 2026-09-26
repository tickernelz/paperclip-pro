import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const HARNESS = "/tests/mobile-chat-shell.html";
const EVIDENCE_DIR =
  process.env.MOBILE_SHELL_EVIDENCE_DIR ??
  `${process.env.HOME}/Projects/paperclip-pro-migration/evidence/mobile-composer`;
const KEYBOARD_PX = 336;

async function installHeightProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = {
      heights: [] as number[],
      dockOffsets: [] as number[],
      scrollTops: [] as number[],
    };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    const record = () => {
      const height = document.documentElement.scrollHeight;
      if (probe.heights[probe.heights.length - 1] !== height) probe.heights.push(height);
      const dock = document.querySelector('[data-testid="task-chat-composer-dock"]');
      if (dock) {
        const offset = Math.round(window.innerHeight - dock.getBoundingClientRect().bottom);
        if (probe.dockOffsets[probe.dockOffsets.length - 1] !== offset) probe.dockOffsets.push(offset);
      }
      probe.scrollTops.push(Math.round(window.scrollY));
    };
    record();
    window.addEventListener("scroll", record, { passive: true });
  });
}

async function flickToBottom(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const step = () => {
          const max =
            document.documentElement.scrollHeight - window.innerHeight;
          if (window.scrollY >= max - 1) {
            window.requestAnimationFrame(() => resolve());
            return;
          }
          window.scrollBy(0, 140);
          window.requestAnimationFrame(step);
        };
        window.scrollTo(0, 0);
        window.requestAnimationFrame(step);
      }),
  );
  await page.waitForTimeout(600);
}

async function readProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __probe: { heights: number[]; dockOffsets: number[]; scrollTops: number[] };
        }
      ).__probe,
  );
}

async function openKeyboard(page: Page): Promise<void> {
  await page.evaluate((inset) => {
    const viewport = window.visualViewport!;
    const height = window.innerHeight - inset;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => height });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 0 });
    viewport.dispatchEvent(new Event("resize"));
  }, KEYBOARD_PX);
  await page.waitForTimeout(200);
}

test.describe("mobile task chat shell", () => {
  test.beforeAll(() => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("one scroll-to-bottom gesture does not oscillate the document height", async ({
    page,
  }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await installHeightProbe(page);
    await flickToBottom(page);
    const probe = await readProbe(page);
    const transitions = probe.heights.length - 1;

    expect(transitions, `document height values: ${probe.heights.join(",")}`).toBeLessThanOrEqual(1);
    expect(
      probe.dockOffsets.length,
      `dock offsets: ${probe.dockOffsets.join(",")}`,
    ).toBe(1);

    const restSamples: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      restSamples.push(await page.evaluate(() => Math.round(window.scrollY)));
      await page.waitForTimeout(250);
    }
    expect(new Set(restSamples).size, `scrollY at rest: ${restSamples.join(",")}`).toBe(1);

    test.info().annotations.push({
      type: "fixed-metrics",
      description: `dockOffsets=${probe.dockOffsets.join(",")} heights=${probe.heights.join(",")} rest=${restSamples.join(",")}`,
    });
  });

  test("the legacy auto-hiding nav moves the dock and the document height", async ({ page }) => {
    await page.goto(`${HARNESS}?legacyNav=1`);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await installHeightProbe(page);
    await flickToBottom(page);

    const probe = await readProbe(page);
    expect(
      probe.dockOffsets.length,
      `dock offsets: ${probe.dockOffsets.join(",")}`,
    ).toBeGreaterThan(1);
    expect(probe.heights.length).toBeGreaterThan(1);

    test.info().annotations.push({
      type: "legacy-metrics",
      description: `dockOffsets=${probe.dockOffsets.join(",")} heights=${probe.heights.join(",")}`,
    });
    await page.screenshot({ path: `${EVIDENCE_DIR}/before-webkit-iphone13-thread-bottom.png` });
  });

  test("the composer never covers the last message or the progress row", async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);

    const dock = (await page.locator('[data-testid="task-chat-composer-dock"]').boundingBox())!;
    const progress = (await page.locator('[data-testid="thread-progress-row"]').boundingBox())!;
    const last = (await page.locator('[data-testid="thread-last-row"]').boundingBox())!;

    expect(progress.y + progress.height).toBeLessThanOrEqual(dock.y + 1);
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y + 1);

    const reserve = Number(
      await page.locator('[data-testid="task-chat-composer-dock"]').getAttribute("data-composer-reserve"),
    );
    expect(reserve).toBe(Math.round(dock.height));

    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-thread-bottom.png` });
  });

  test("a multi-line composer keeps the last rows visible", async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);

    const before = Number(
      await page.locator('[data-testid="task-chat-composer-dock"]').getAttribute("data-composer-reserve"),
    );
    await page.locator('[data-testid="composer-input"]').fill("one\ntwo\nthree\nfour");
    await page.waitForTimeout(500);

    const after = Number(
      await page.locator('[data-testid="task-chat-composer-dock"]').getAttribute("data-composer-reserve"),
    );
    expect(after).toBeGreaterThan(before);

    const dock = (await page.locator('[data-testid="task-chat-composer-dock"]').boundingBox())!;
    const last = (await page.locator('[data-testid="thread-last-row"]').boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y + 1);
  });

  test("the dock clears the software keyboard on iOS", async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await openKeyboard(page);
    await page.waitForTimeout(400);

    const inset = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--mobile-viewport-inset-bottom").trim(),
    );
    expect(inset).toBe(`${KEYBOARD_PX}px`);

    const spacer = (await page.locator('[data-testid="task-chat-keyboard-spacer"]').boundingBox())!;
    expect(Math.round(spacer.height)).toBe(KEYBOARD_PX);

    const dock = (await page.locator('[data-testid="task-chat-composer-dock"]').boundingBox())!;
    const last = (await page.locator('[data-testid="thread-last-row"]').boundingBox())!;
    const progress = (await page.locator('[data-testid="thread-progress-row"]').boundingBox())!;
    const visibleBottom = await page.evaluate(() => window.visualViewport!.height);

    expect(dock.y + dock.height).toBeLessThanOrEqual(visibleBottom + 1);
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y + 1);
    expect(progress.y + progress.height).toBeLessThanOrEqual(dock.y + 1);
    expect(last.y).toBeGreaterThanOrEqual(0);

    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-keyboard-open.png` });
  });

  test("the model sheet is compact and shows one section at a time", async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await page.locator('[data-testid="task-chat-composer-model-override"]').tap();

    const panel = page.locator('[data-testid="task-model-override-panel"]');
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const viewportHeight = await page.evaluate(() => window.visualViewport!.height);

    expect(box.height).toBeLessThanOrEqual(viewportHeight * 0.55);
    expect(box.y).toBeGreaterThan(viewportHeight * 0.3);

    await expect(page.locator('[data-testid="task-model-override-section-model"]')).toHaveAttribute(
      "data-expanded",
      "true",
    );
    await expect(
      page.locator('[data-testid="task-model-override-section-thinking"]'),
    ).toHaveAttribute("data-expanded", "false");
    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-model-sheet.png` });

    await page.locator('[data-testid="task-model-override-toggle-thinking"]').tap();
    await expect(page.locator('[data-testid="task-model-override-section-model"]')).toHaveAttribute(
      "data-expanded",
      "false",
    );
    await expect(
      page.locator('[data-testid="task-model-override-section-thinking"]'),
    ).toHaveAttribute("data-expanded", "true");

    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-model-sheet-thinking.png` });
  });

  test("the legacy model picker fills the screen", async ({ page }) => {
    await page.goto(`${HARNESS}?legacyPicker=1`);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await page.locator('[data-testid="task-chat-composer-model-override"]').tap();

    const box = (await page.locator('[data-testid="task-model-override-panel"]').boundingBox())!;
    const viewportHeight = await page.evaluate(() => window.visualViewport!.height);
    expect(box.height).toBeGreaterThan(viewportHeight * 0.55);

    await page.screenshot({ path: `${EVIDENCE_DIR}/before-webkit-iphone13-model-picker.png` });
  });

  test("long option labels stay on one line", async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await page.locator('[data-testid="task-chat-composer-model-override"]').tap();

    const metrics = await page.evaluate(() => {
      const buttons = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="task-model-override-section-model"] [data-slot="entity-option-list"] > button',
        ),
      ];
      const button = buttons.find((candidate) => candidate.textContent?.includes("0731"))!;
      const label = button.querySelector("span")!;
      return {
        labelHeight: label.getBoundingClientRect().height,
        labelWidth: label.getBoundingClientRect().width,
        scrollWidth: label.scrollWidth,
        whiteSpace: getComputedStyle(label).whiteSpace,
        textOverflow: getComputedStyle(label).textOverflow,
      };
    });

    expect(metrics.whiteSpace).toBe("nowrap");
    expect(metrics.textOverflow).toBe("ellipsis");
    expect(metrics.labelHeight).toBeLessThan(24);
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.labelWidth);
  });

  test("assignee and workspace pickers dock as compact sheets", async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    const viewportHeight = await page.evaluate(() => window.visualViewport!.height);

    await page.locator('[data-testid="assignee-selector"]').tap();
    const assignee = page.locator('[data-mobile-entity-picker]').first();
    await expect(assignee).toBeVisible();
    const assigneeBox = (await assignee.boundingBox())!;
    expect(assigneeBox.height).toBeLessThanOrEqual(viewportHeight * 0.55);
    await expect(assignee.locator("[data-mobile-sheet-header]")).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-assignee-sheet.png` });
    await assignee.locator("[data-mobile-sheet-close]").tap();
    await expect(page.locator("[data-mobile-entity-picker]")).toHaveCount(0);

    await page.locator('[data-testid="workspace-selector"] button').first().tap();
    const workspace = page.locator("[data-mobile-entity-picker]").first();
    await expect(workspace).toBeVisible();
    const workspaceBox = (await workspace.boundingBox())!;
    expect(workspaceBox.height).toBeLessThanOrEqual(viewportHeight * 0.55);
    await expect(workspace.locator("[data-mobile-sheet-header]")).toBeVisible();
  });

  test("the sheet keeps its height budget once two footer rows exist", async ({ page }) => {
    await page.goto(`${HARNESS}?footerRows=1`);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await page.locator('[data-testid="task-chat-composer-model-override"]').tap();

    const viewportHeight = await page.evaluate(() => window.visualViewport!.height);
    const panel = (await page.locator('[data-testid="task-model-override-panel"]').boundingBox())!;
    const footer = (await page.locator('[data-testid="task-model-override-footer"]').boundingBox())!;
    const list = await page.evaluate(() => {
      const node = document.querySelector<HTMLElement>(
        '[data-testid="task-model-override-section-model"] [data-slot="entity-option-list"]',
      )!;
      return { clientHeight: node.clientHeight, scrollHeight: node.scrollHeight };
    });

    expect(panel.height).toBeLessThanOrEqual(viewportHeight * 0.55);
    expect(footer.height).toBeGreaterThan(40);
    expect(footer.y + footer.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);

    const inherit = page.locator('[data-testid="task-model-override-inherit"]');
    await expect(inherit).toBeVisible();
    await expect(inherit).toHaveAttribute("aria-checked", "true");
    await expect(
      page.locator('[data-testid="task-model-override-scope-new_and_existing"]'),
    ).toBeVisible();

    await inherit.tap();
    await expect(inherit).toHaveAttribute("aria-checked", "false");
    await expect(
      page.locator('[data-testid="task-model-override-scope-new_and_existing"]'),
    ).toHaveCount(0);

    const afterToggle = (await page.locator('[data-testid="task-model-override-panel"]').boundingBox())!;
    expect(afterToggle.height).toBeLessThanOrEqual(viewportHeight * 0.55);
    expect(afterToggle.y + afterToggle.height).toBeLessThanOrEqual(viewportHeight + 1);
  });
});

test.describe("mobile task chat shell in an iOS standalone PWA", () => {
  const SAFE_AREA = 34;

  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        /display-mode:\s*standalone/.test(query)
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addListener: () => {},
              removeListener: () => {},
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            } as MediaQueryList)
          : original(query);
      Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    });
  });

  test("the composer clears the home indicator and never covers the last rows", async ({ page }) => {
    await page.goto(`${HARNESS}?safeArea=${SAFE_AREA}`);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');

    expect(await page.evaluate(() => window.matchMedia("(display-mode: standalone)").matches)).toBe(true);
    expect(await page.evaluate(() => window.innerHeight)).toBe(844);

    await installHeightProbe(page);
    await flickToBottom(page);

    const probe = await readProbe(page);
    expect(probe.heights.length - 1, `document height values: ${probe.heights.join(",")}`).toBeLessThanOrEqual(1);

    const dock = (await page.locator('[data-testid="task-chat-composer-dock"]').boundingBox())!;
    const last = (await page.locator('[data-testid="thread-last-row"]').boundingBox())!;
    const progress = (await page.locator('[data-testid="thread-progress-row"]').boundingBox())!;
    const viewportHeight = await page.evaluate(() => window.visualViewport!.height);

    expect(viewportHeight - (dock.y + dock.height)).toBeGreaterThanOrEqual(SAFE_AREA);
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y + 1);
    expect(progress.y + progress.height).toBeLessThanOrEqual(dock.y + 1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-standalone-thread-bottom.png` });
  });

  test("the standalone composer rises above the keyboard without hiding the last rows", async ({
    page,
  }) => {
    await page.goto(`${HARNESS}?safeArea=${SAFE_AREA}`);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await openKeyboard(page);
    await page.waitForTimeout(400);

    const dock = (await page.locator('[data-testid="task-chat-composer-dock"]').boundingBox())!;
    const last = (await page.locator('[data-testid="thread-last-row"]').boundingBox())!;
    const visibleBottom = await page.evaluate(() => window.visualViewport!.height);

    expect(dock.y + dock.height).toBeLessThanOrEqual(visibleBottom + 1);
    expect(last.y + last.height).toBeLessThanOrEqual(dock.y + 1);
    expect(last.y).toBeGreaterThanOrEqual(0);

    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-standalone-keyboard-open.png` });
  });

  test("the picker sheet clears the home indicator", async ({ page }) => {
    await page.goto(`${HARNESS}?safeArea=${SAFE_AREA}`);
    await page.waitForSelector('[data-testid="task-chat-composer-dock"]');
    await flickToBottom(page);
    await page.locator('[data-testid="task-chat-composer-model-override"]').tap();

    const panel = page.locator('[data-testid="task-model-override-panel"]');
    await expect(panel).toBeVisible();
    const padding = await panel.evaluate((node) => getComputedStyle(node).paddingBottom);
    expect(padding).toBe(`${SAFE_AREA}px`);

    const box = (await panel.boundingBox())!;
    const viewportHeight = await page.evaluate(() => window.visualViewport!.height);
    expect(box.height).toBeLessThanOrEqual(viewportHeight * 0.55);

    const list = await page.evaluate(() => {
      const node = document.querySelector<HTMLElement>(
        '[data-testid="task-model-override-section-model"] [data-slot="entity-option-list"]',
      )!;
      const rect = node.getBoundingClientRect();
      return { bottom: rect.bottom, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
    });
    expect(list.bottom).toBeLessThanOrEqual(viewportHeight - SAFE_AREA + 1);
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);

    await page.screenshot({ path: `${EVIDENCE_DIR}/after-webkit-iphone13-standalone-model-sheet.png` });
  });
});
