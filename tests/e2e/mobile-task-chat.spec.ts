import { expect, test } from "@playwright/test";
import { json, setup } from "./agent-chat.shared";

const ANNOUNCEMENT_SETTLE_MS = 3_000;

const VIEWPORT = { width: 390, height: 844 };
const KEYBOARD_HEIGHT = 336;

test.use({ viewport: VIEWPORT, hasTouch: true, isMobile: true });

interface ThreadScrollSample {
  scrollY: number;
  scrollHeight: number;
  innerHeight: number;
}

declare global {
  interface Window {
    __setKeyboardInset?: (inset: number) => void;
    __threadScrollTrace?: ThreadScrollSample[];
  }
}

test("the mobile task thread rests at the bottom and opens the agent picker above the keyboard", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await setup(request);
  try {
    await page.addInitScript(() => {
      const real = window.visualViewport;
      if (!real) return;
      const fake = new EventTarget() as EventTarget & Record<string, unknown>;
      let inset = 0;
      Object.defineProperties(fake, {
        height: { get: () => real.height - inset },
        width: { get: () => real.width },
        offsetTop: { get: () => real.offsetTop },
        offsetLeft: { get: () => real.offsetLeft },
        pageTop: { get: () => real.pageTop },
        pageLeft: { get: () => real.pageLeft },
        scale: { get: () => real.scale },
      });
      const forward = (type: string) => real.addEventListener(type, () => fake.dispatchEvent(new Event(type)));
      forward("resize");
      forward("scroll");
      Object.defineProperty(window, "visualViewport", { configurable: true, get: () => fake });
      window.__setKeyboardInset = (next: number) => {
        inset = next;
        fake.dispatchEvent(new Event("resize"));
      };
    });

    const issue = await json(
      await request.post(`/api/companies/${fixture.company.id}/issues`, {
        data: { title: "Mobile thread bottom rest", status: "backlog" },
      }),
    );
    for (let index = 0; index < 30; index += 1) {
      await json(
        await request.post(`/api/issues/${issue.id}/comments`, {
          data: {
            body: `Message ${index}: the mobile thread has to hold still once the reader reaches the newest message.`,
          },
        }),
      );
    }

    await page.goto(`/${fixture.company.issuePrefix}/issues/${issue.identifier}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("task-chat-composer-input")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Message 29:", { exact: false })).toBeAttached();

    await page.waitForTimeout(ANNOUNCEMENT_SETTLE_MS + 500);
    const announcement = page.getByRole("button", { name: "Dismiss announcement" });
    if (await announcement.isVisible()) await announcement.click();

    await page.evaluate(() => {
      window.__threadScrollTrace = [];
      const scroller = document.scrollingElement ?? document.documentElement;
      const record = () => {
        const trace = window.__threadScrollTrace!;
        const last = trace[trace.length - 1];
        const sample = {
          scrollY: Math.round(window.scrollY),
          scrollHeight: scroller.scrollHeight,
          innerHeight: window.innerHeight,
        };
        if (
          last &&
          last.scrollY === sample.scrollY &&
          last.scrollHeight === sample.scrollHeight
        ) {
          return;
        }
        trace.push(sample);
      };
      window.addEventListener("scroll", record, { passive: true });
      window.setInterval(record, 50);
      record();
    });

    for (let index = 0; index < 8; index += 1) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1_000);

    const trace = await page.evaluate(() => window.__threadScrollTrace ?? []);
    await testInfo.attach("thread-scroll-trace", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(trace)),
    });

    const heights: number[] = [];
    for (const sample of trace) {
      if (heights[heights.length - 1] !== sample.scrollHeight) heights.push(sample.scrollHeight);
    }
    expect(heights).toEqual([...new Set(heights)]);

    const resting = trace[trace.length - 1];
    expect(resting.scrollHeight - resting.scrollY - resting.innerHeight).toBeLessThanOrEqual(1);

    await page.screenshot({ path: testInfo.outputPath("thread-bottom-rest.png") });
    await testInfo.attach("thread-bottom-rest", {
      contentType: "image/png",
      path: testInfo.outputPath("thread-bottom-rest.png"),
    });

    await page.getByTestId("task-chat-composer-assignee").click();
    await page.evaluate((inset) => window.__setKeyboardInset?.(inset), KEYBOARD_HEIGHT);
    await page.waitForTimeout(200);

    const sheet = page.locator("[data-mobile-entity-picker]");
    await expect(sheet).toBeVisible();

    await page.evaluate((keyboardHeight) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${keyboardHeight}px;background:repeating-linear-gradient(45deg,rgba(20,20,20,.88),rgba(20,20,20,.88) 10px,rgba(60,60,60,.88) 10px,rgba(60,60,60,.88) 20px);color:#fff;font:600 14px sans-serif;display:flex;align-items:center;justify-content:center;z-index:2147483647`;
      overlay.textContent = `software keyboard (${keyboardHeight}px)`;
      document.body.appendChild(overlay);
    }, KEYBOARD_HEIGHT);
    await page.screenshot({ path: testInfo.outputPath("agent-picker-above-keyboard.png") });
    await testInfo.attach("agent-picker-above-keyboard", {
      contentType: "image/png",
      path: testInfo.outputPath("agent-picker-above-keyboard.png"),
    });

    const options = sheet.locator("button");
    await expect(options.filter({ hasText: "Alpha" })).toBeVisible();
    await expect(options.filter({ hasText: "Zeta" })).toBeAttached();

    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(VIEWPORT.width / 2);
    expect(box!.y + box!.height).toBeLessThanOrEqual(VIEWPORT.height - KEYBOARD_HEIGHT);
  } finally {
    await fixture.restore();
  }
});
