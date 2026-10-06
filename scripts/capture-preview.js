import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { PNG } from "pngjs";
import gifenc from "gifenc";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const fixture = await readFile(
  new URL("../tests/fixture.html", import.meta.url),
);
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixture);
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const profile = await mkdtemp(join(tmpdir(), "power-mode-preview-"));
const extensionPath = resolve(".");
const destination = "docs/media";
let context;

try {
  await mkdir(destination, { recursive: true });
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    executablePath: process.env.POWER_MODE_BROWSER_PATH || undefined,
    headless: true,
    viewport: { width: 960, height: 700 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const manager = await context.newPage();
  await manager.goto("chrome://extensions/");
  const item = manager.locator("extensions-item");
  await expect(item).toHaveCount(1);
  const extensionId = await item.evaluate((element) => element.id);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.setViewportSize({ width: 360, height: 500 });
  const toggle = popup.getByRole("switch");
  await expect(toggle).toBeEnabled();
  await toggle.check();
  await popup.getByLabel("Virtual pets").selectOption("all");
  await popup.screenshot({
    path: `${destination}/settings.png`,
    clip: { x: 0, y: 0, width: 360, height: Math.ceil(await popup.locator("body").evaluate((body) => body.getBoundingClientRect().height)) },
  });
  await popup.getByLabel("Virtual pets").selectOption("fish");

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.bringToFront();
  const host = page.locator("[data-power-mode-host]");
  await expect(host).toHaveCount(1);
  await expect
    .poll(
      () =>
        host.locator("canvas").evaluate((canvas) => {
          const data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, 60).data;
          let bubbles = 0;
          for (let index = 0; index < data.length; index += 4) {
            const alpha = data[index + 3] / 255;
            const foreground = (alpha - 20 / 255) / (1 - 20 / 255);
            if (foreground <= 0.1 || foreground >= 0.95) continue;
            const background = (20 / 255) * (1 - foreground);
            const red = (data[index] * alpha - 91 * background) / foreground;
            const green =
              (data[index + 1] * alpha - 210 * background) / foreground;
            const blue =
              (data[index + 2] * alpha - 223 * background) / foreground;
            if (
              Math.abs(red - 133) <= 5 &&
              Math.abs(green - 221) <= 5 &&
              Math.abs(blue - 235) <= 5
            )
              bubbles += 1;
          }
          return bubbles;
        }),
      { timeout: 12000 },
    )
    .toBeGreaterThan(10);
  const clip = { x: 0, y: 0, width: 960, height: 700 };
  await page.screenshot({ path: `${destination}/ocean.png`, clip });
  await page.locator("#notes").click();
  const frames = [];
  const text = "Swimming fish and smiling friends.";
  let previousTime = Date.now();
  for (let index = 0; index < 120; index += 1) {
    if (index === 48 || index === 84) {
      await popup.bringToFront();
      await popup.getByLabel("Virtual pets").selectOption(index === 48 ? "rooster" : "donkey");
      await page.bringToFront();
    }
    if (index < 24) await page.keyboard.type(text[index]);
    await page.evaluate(
      () =>
        new Promise((ready) => {
          const start = performance.now();
          function next(time) {
            if (time - start >= 100) ready();
            else requestAnimationFrame(next);
          }
          requestAnimationFrame(next);
        }),
    );
    const buffer = await page.screenshot({ clip });
    const now = Date.now();
    frames.push({ buffer, delay: Math.max(20, now - previousTime) });
    previousTime = now;
  }
  const encoder = GIFEncoder();
  for (const frame of frames) {
    const image = PNG.sync.read(frame.buffer);
    const palette = quantize(image.data, 128);
    const indexed = applyPalette(image.data, palette);
    encoder.writeFrame(indexed, image.width, image.height, {
      palette,
      delay: frame.delay,
      repeat: 0,
    });
  }
  encoder.finish();
  const gif = encoder.bytes();
  await writeFile(`${destination}/power-mode.gif`, gif);
  console.log(
    `Captured 120 real animation frames of fish, rooster, and donkey: ${gif.length} bytes; ocean.png and settings.png saved.`,
  );
} finally {
  await context?.close();
  await new Promise((closed) => server.close(closed));
  await rm(profile, { recursive: true, force: true });
}
