import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium, expect } from "@playwright/test";

const TYPING_COLORS = [[246, 237, 85], [94, 255, 189], [255, 100, 126], [107, 232, 255]];

test(
  "unpacked extension browser workflows",
  { timeout: 180000 },
  async (suite) => {
    const fixture = await readFile(new URL("./fixture.html", import.meta.url));
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixture);
    });
    await new Promise((resolveReady) =>
      server.listen(0, "127.0.0.1", resolveReady),
    );
    const profile = await mkdtemp(join(tmpdir(), "power-mode-"));
    const extensionPath = resolve(".");
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        executablePath: process.env.POWER_MODE_BROWSER_PATH || undefined,
        headless: true,
        viewport: { width: 1280, height: 900 },
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });
      const errors = [];
      context.on("page", (opened) =>
        opened.on("pageerror", (error) => errors.push(error.message)),
      );
      const manager = await context.newPage();
      await manager.goto("chrome://extensions/");
      const item = manager.locator("extensions-item");
      await expect(item).toHaveCount(1);
      const extensionId = await item.evaluate((element) => element.id);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      const toggle = popup.getByRole("switch");
      const petChoice = popup.getByLabel("Virtual pets");
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();
      await suite.test(
        "popup has stable width, readable controls, and pet preview",
        async () => {
          await popup.setViewportSize({ width: 180, height: 500 });
          assert.equal(
            await popup
              .locator("html")
              .evaluate((element) => element.getBoundingClientRect().width),
            360,
          );
          await popup.setViewportSize({ width: 360, height: 500 });
          const selectBounds = await petChoice.boundingBox();
          assert.ok(selectBounds.width >= 300);
          assert.ok(
            selectBounds.x >= 0 && selectBounds.x + selectBounds.width <= 360,
          );
          assert.equal(
            await popup
              .locator("body")
              .evaluate((element) => element.scrollWidth),
            360,
          );
          await expect(popup.locator("h1")).toHaveText("Power Mode");
          const colored = await popup
            .locator("#pet-preview")
            .evaluate((canvas) => {
              const data = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, canvas.height).data;
              return data.some((value, index) => index % 4 === 3 && value > 0);
            });
          assert.ok(colored);
          await mkdir("test-results", { recursive: true });
          await popup.screenshot({ path: "test-results/popup-polished.png" });
        },
      );
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const host = page.locator("[data-power-mode-host]");
      const counter = host.locator(".hits");
      const notes = page.locator("#notes");
      const focusNotes = async () => {
        await page.bringToFront();
        await page.locator("#button").click();
        await notes.click();
      };
      const resetByFocus = focusNotes;
      const pixels = (topOnly = false, belowPets = false) =>
        host.locator("canvas").evaluate(
          (canvas, options) => {
            const top = options.belowPets ? 60 : 0;
            const height = options.topOnly
              ? Math.min(52, canvas.height)
              : canvas.height - top;
            const data = canvas
              .getContext("2d")
              .getImageData(0, top, canvas.width, height).data;
            let colored = 0;
            for (let index = 3; index < data.length; index += 4) {
              const typingPixel = options.colors.some((color) => color.every((value, channel) => Math.abs(data[index - 3 + channel] - value) <= 2));
              if (data[index] > 0 && (!options.belowPets || typingPixel)) colored += 1;
            }
            return colored;
          },
          { topOnly, belowPets, colors: TYPING_COLORS },
        );
      const petLeft = () =>
        host.locator("canvas").evaluate((canvas) => {
          const data = canvas
            .getContext("2d")
            .getImageData(0, 0, canvas.width, 52).data;
          let left = canvas.width;
          for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 0)
              left = Math.min(left, ((index - 3) / 4) % canvas.width);
          }
          return left === canvas.width ? -1 : left;
        });
      await mkdir("test-results", { recursive: true });

      await suite.test(
        "disabled default, live enable, milestone, moving pets, and fade",
        async () => {
          await focusNotes();
          await page.keyboard.type("abc");
          await expect(host).toHaveCount(0);
          await popup.bringToFront();
          await petChoice.selectOption("donkey");
          await toggle.check();
          await focusNotes();
          await expect(host).toHaveCount(1);
          await expect(host.locator(".counter")).toBeHidden();
          await expect.poll(() => pixels(true)).toBeGreaterThan(700);
          await page.keyboard.type("abcdefghij", { delay: 20 });
          await expect(counter).toHaveText("10 HITS");
          await expect(host.locator(".celebration")).toHaveText(
            "10 HITS COMBO!",
          );
          assert.ok((await pixels()) > 0);
          await expect.poll(() => pixels(true)).toBeGreaterThan(700);
          await expect.poll(petLeft).toBeGreaterThan(12);
          await page.screenshot({ path: "test-results/desktop.png" });
          await page.keyboard.type("k");
          await expect(counter).toHaveText("11 HITS");
          const petCenter = () =>
            host.locator("canvas").evaluate((canvas) => {
              const data = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, 52).data;
              let total = 0;
              let count = 0;
              for (let index = 3; index < data.length; index += 4) {
                if (data[index] > 0) {
                  total += ((index - 3) / 4) % canvas.width;
                  count += 1;
                }
              }
              return total / count;
            });
          const start = await petCenter();
          await page.keyboard.type("lmno", { delay: 60 });
          assert.ok((await petCenter()) > start + 5);
          await expect
            .poll(() =>
              host
                .locator(".celebration")
                .evaluate((element) => getComputedStyle(element).opacity),
            )
            .toBe("0");
          await expect(host.locator(".counter")).toBeHidden({ timeout: 3000 });
          await expect.poll(() => pixels(false, true)).toBe(0);
          assert.ok((await pixels(true)) > 0);
          await page.keyboard.type("abc");
          await expect(counter).toHaveText("3 HITS");
        },
      );

      await suite.test(
        "passwords, shortcuts, programmatic edits, and target changes",
        async () => {
          await page.locator("#password").click();
          await page.keyboard.type("privatepassword");
          await expect(host.locator(".counter")).toBeHidden();
          await focusNotes();
          await page.keyboard.press("Control+A");
          await page.keyboard.press("ArrowRight");
          await notes.evaluate((element) => {
            element.value += "ignored";
            element.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: "ignored",
              }),
            );
          });
          await expect(host.locator(".counter")).toBeHidden();
          await page.keyboard.type("abc");
          await expect(counter).toHaveText("3 HITS");
          await page.locator("#title").click();
          await page.keyboard.type("xy");
          await expect(host.locator(".counter")).toBeHidden();
          await page.keyboard.type("z");
          await expect(counter).toHaveText("3 HITS");
        },
      );

      await suite.test(
        "IME commits count once; contenteditable supports Enter and Backspace",
        async () => {
          await resetByFocus();
          await page.keyboard.type("abc");
          const session = await context.newCDPSession(page);
          await session.send("Input.imeSetComposition", {
            text: "\u6f22",
            selectionStart: 1,
            selectionEnd: 1,
          });
          await expect(counter).toHaveText("3 HITS");
          await session.send("Input.insertText", { text: "\u6f22" });
          await expect(counter).toHaveText("4 HITS");
          await session.detach();
          await page.locator("#editor").click();
          await page.keyboard.type("hello");
          await expect(counter).toHaveText("5 HITS");
          await page.keyboard.press("Enter");
          await page.keyboard.press("Backspace");
          await expect(counter).toHaveText("7 HITS");
        },
      );

      await suite.test(
        "scrolled textarea caret and input fallback render particles",
        async () => {
          await resetByFocus();
          await expect.poll(() => pixels(false, true)).toBe(0);
          await notes.fill("line\n".repeat(40));
          await notes.press("Control+End");
          await page.keyboard.type("abc");
          await expect(counter).toHaveText("3 HITS");
          await expect.poll(() => pixels(false, true)).toBeGreaterThan(0);
          const position = await host.locator("canvas").evaluate((canvas, colors) => {
            const data = canvas
              .getContext("2d")
              .getImageData(0, 60, canvas.width, canvas.height - 60).data;
            const points = [];
            for (let index = 3; index < data.length; index += 4) {
              if (data[index] > 0 && colors.some((color) => color.every((value, channel) => Math.abs(data[index - 3 + channel] - value) <= 2)))
                points.push({
                  x: ((index - 3) / 4) % canvas.width,
                  y: 60 + Math.floor((index - 3) / 4 / canvas.width),
                });
            }
            return points;
          }, TYPING_COLORS);
          const bounds = await notes.boundingBox();
          assert.ok(position.length > 0);
          assert.ok(
            position.every(
              (point) =>
                point.y >= bounds.y - 50 &&
                point.y <= bounds.y + bounds.height + 50,
            ),
          );
          await page.locator("#email").click();
          await page.keyboard.type("abc");
          await expect(counter).toHaveText("3 HITS");
          assert.ok((await pixels()) > 0);
        },
      );

      await suite.test(
        "pet selector updates live and mobile layout fits",
        async () => {
          await popup.bringToFront();
          await petChoice.selectOption("off");
          await focusNotes();
          await page.keyboard.type("abcdefghij");
          await expect(counter).toHaveText("10 HITS");
          assert.equal(await pixels(true), 0);
          await popup.bringToFront();
          await petChoice.selectOption("rooster");
          await page.setViewportSize({ width: 390, height: 844 });
          await focusNotes();
          await page.keyboard.type("abcdefghij", { delay: 15 });
          await expect(counter).toHaveText("10 HITS");
          await expect.poll(() => pixels(true)).toBeGreaterThan(700);
          await expect.poll(petLeft).toBeGreaterThan(12);
          const bounds = await host.locator(".counter").boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
          await page.screenshot({ path: "test-results/mobile.png" });
          await popup.reload();
          await expect(petChoice).toHaveValue("rooster");
        },
      );

      await suite.test(
        "reduced motion uses static counter without pets or animation",
        async () => {
          await page.emulateMedia({ reducedMotion: "reduce" });
          await resetByFocus();
          await page.keyboard.type("abcdefghij");
          await expect(counter).toHaveText("10 HITS");
          assert.equal(await pixels(), 0);
          assert.equal(
            await host.evaluate(
              (element) => element.shadowRoot.getAnimations().length,
            ),
            0,
          );
          await expect(host.locator(".celebration")).toBeHidden();
          await page.emulateMedia({ reducedMotion: "no-preference" });
        },
      );

      await suite.test(
        "idle fish blow bubbles and seaweed sways on desktop and mobile",
        async () => {
          await popup.bringToFront();
          await petChoice.selectOption("fish");
          await page.setViewportSize({ width: 1280, height: 900 });
          await resetByFocus();
          await expect(host.locator(".counter")).toBeHidden();
          const waterSignature = () =>
            host.locator("canvas").evaluate((canvas) => {
              const data = canvas
                .getContext("2d")
                .getImageData(35, 20, 40, 40).data;
              return data.reduce(
                (sum, value, index) => sum + value * (index % 17),
                0,
              );
            });
          const signature = await waterSignature();
          await expect.poll(waterSignature).not.toBe(signature);
          const bubblePixels = () =>
            host.locator("canvas").evaluate((canvas) => {
              const data = canvas
                .getContext("2d")
                .getImageData(0, 0, canvas.width, 60).data;
              let count = 0;
              for (let index = 0; index < data.length; index += 4) {
                const alpha = data[index + 3] / 255;
                const foreground = (alpha - 20 / 255) / (1 - 20 / 255);
                if (foreground <= 0.1 || foreground >= 0.95) continue;
                const background = (20 / 255) * (1 - foreground);
                const red =
                  (data[index] * alpha - 91 * background) / foreground;
                const green =
                  (data[index + 1] * alpha - 210 * background) / foreground;
                const blue =
                  (data[index + 2] * alpha - 223 * background) / foreground;
                if (
                  Math.abs(red - 133) <= 5 &&
                  Math.abs(green - 221) <= 5 &&
                  Math.abs(blue - 235) <= 5
                )
                  count += 1;
              }
              return count;
            });
          await expect.poll(bubblePixels, { timeout: 12000 }).toBeGreaterThan(10);
          await page.screenshot({ path: "test-results/fish-desktop.png" });
          await expect(host.locator(".counter")).toBeHidden();
          await page.setViewportSize({ width: 390, height: 844 });
          await popup.bringToFront();
          await petChoice.selectOption("all");
          await resetByFocus();
          await expect.poll(() => pixels(true)).toBeGreaterThan(700);
          await page.screenshot({ path: "test-results/ocean-mobile.png" });
          await popup.reload();
          await expect(petChoice).toHaveValue("all");
          await popup.screenshot({ path: "test-results/popup-all-pets.png" });
        },
      );

      await suite.test(
        "pets grow after five seconds and appear down the mobile page",
        async () => {
          await popup.bringToFront();
          await petChoice.selectOption("donkey");
          await page.setViewportSize({ width: 390, height: 844 });
          await resetByFocus();
          const measure = () => host.locator("canvas").evaluate((canvas) => {
            const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let run = 0;
            let largest = 0;
            let bottom = 0;
            for (let row = 0; row < canvas.height; row += 1) {
              let occupied = false;
              for (let column = 0; column < canvas.width; column += 1) {
                if (data[(row * canvas.width + column) * 4 + 3] > 0) { occupied = true; break; }
              }
              run = occupied ? run + 1 : 0;
              largest = Math.max(largest, run);
              if (occupied) bottom = row;
            }
            return { largest, bottom };
          });
          await expect.poll(async () => (await measure()).largest).toBeGreaterThan(30);
          const initial = await measure();
          await expect.poll(async () => (await measure()).largest, { timeout: 7500 }).toBeGreaterThan(initial.largest * 1.2);
          assert.ok((await measure()).bottom > 200);
          await page.screenshot({ path: "test-results/growing-pets-mobile.png" });
          await popup.bringToFront();
          await petChoice.selectOption("rooster");
        },
      );

      await suite.test(
        "custom idle delay persists, audio resumes after blur, and mute stops playback",
        async () => {
          await page.setViewportSize({ width: 1280, height: 900 });
          await popup.bringToFront();
          await petChoice.selectOption("rooster");
          const sound = popup.getByLabel("Idle animal sounds");
          const idleTime = popup.getByLabel("Idle time (seconds)");
          await expect(idleTime).toHaveValue("5");
          await idleTime.fill("3");
          await idleTime.press("Tab");
          await expect(idleTime).toBeEnabled();
          await popup.reload();
          await expect(idleTime).toHaveValue("3");
          await idleTime.fill("0");
          await idleTime.press("Tab");
          await expect(idleTime).toHaveValue("3");
          await expect(popup.getByRole("alert")).toHaveText("Enter a whole number from 1 to 3600 seconds.");
          await expect(sound).toBeChecked();
          await sound.uncheck();
          await expect(sound).toBeEnabled();
          const session = await context.newCDPSession(page);
          const worlds = [];
          session.on("Runtime.executionContextCreated", (event) => worlds.push(event.context));
          await session.send("Runtime.enable");
          const world = worlds.find((entry) => entry.origin.includes(extensionId));
          assert.ok(world);
          const evaluate = async (expression) => {
            const response = await session.send("Runtime.evaluate", { contextId: world.id, expression, returnByValue: true });
            assert.equal(response.exceptionDetails, undefined);
            return response.result.value;
          };
          await evaluate(`window.petTones = 0; window.AudioContext = class extends AudioContext {
            constructor() { super(); window.petAudio = this; window.petAnalyser = null; window.petContexts = (window.petContexts || 0) + 1; }
            createOscillator() { window.petTones++; return super.createOscillator(); }
            createBufferSource() { window.petTones++; return super.createBufferSource(); }
            createGain() {
              const gain = super.createGain();
              window.petAnalyser ||= this.createAnalyser();
              gain.connect(window.petAnalyser);
              return gain;
            }
          };`);
          await sound.check();
          await expect(sound).toBeEnabled();
          await focusNotes();
          await page.keyboard.press("ArrowRight");
          await expect.poll(() => evaluate('window.petAudio?.state')).toBe("running");
          assert.equal(await evaluate("window.petTones"), 0);
          await evaluate('window.dispatchEvent(new Event("blur"))');
          await expect.poll(() => evaluate("window.petAudio.state")).toBe("suspended");
          await evaluate('window.dispatchEvent(new Event("focus"))');
          await expect.poll(() => evaluate("window.petAudio.state")).toBe("running");
          const start = Date.now();
          await expect.poll(() => evaluate(`(() => {
            if (!window.petAnalyser) return 0;
            const samples = new Float32Array(window.petAnalyser.fftSize);
            window.petAnalyser.getFloatTimeDomainData(samples);
            return Math.max(...samples.map(Math.abs));
          })()`), { timeout: 7000, intervals: [100] }).toBeGreaterThan(0.01);
          assert.ok(Date.now() - start >= 2500);
          assert.ok(await evaluate("window.petTones") >= 1);
          await page.keyboard.press("ArrowRight");
          await evaluate(`Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
            window.dispatchEvent(new Event("blur"));
            window.volumeControlsOpened = performance.now();`);
          await expect.poll(() => evaluate("window.petAudio.state")).toBe("suspended");
          await evaluate('navigator.mediaDevices.dispatchEvent(new Event("devicechange"))');
          await expect.poll(() => evaluate("performance.now() - window.volumeControlsOpened"), { timeout: 6000, intervals: [100] }).toBeGreaterThan(3500);
          const callsBeforeRefocus = await evaluate("window.petTones");
          await evaluate('delete document.hasFocus; window.dispatchEvent(new Event("focus"))');
          await expect.poll(() => evaluate("window.petTones"), { timeout: 1800, intervals: [100] }).toBeGreaterThan(callsBeforeRefocus);
          await evaluate("window.petAudio.suspend()");
          await expect.poll(() => evaluate("window.petAudio.state")).toBe("running");
          const contextsBefore = await evaluate("window.petContexts");
          const callsBefore = await evaluate("window.petTones");
          await evaluate("window.petAudio.close()");
          await expect.poll(() => evaluate("window.petContexts")).toBeGreaterThan(contextsBefore);
          await expect.poll(() => evaluate("window.petAudio.state")).toBe("running");
          await evaluate('navigator.mediaDevices.dispatchEvent(new Event("devicechange"))');
          await expect.poll(() => evaluate("window.petTones"), { timeout: 10000 }).toBeGreaterThan(callsBefore);
          await popup.bringToFront();
          await sound.uncheck();
          await expect.poll(() => evaluate("window.petAudio.state")).toBe("closed");
          await popup.reload();
          await expect(sound).not.toBeChecked();
          await expect(idleTime).toHaveValue("3");
          await session.detach();
        },
      );

      await suite.test(
        "saved audio preferences survive fresh pages, reloads, and URL navigation",
        async () => {
          await popup.bringToFront();
          await popup.getByLabel("Idle animal sounds").check();
          await expect(popup.getByLabel("Idle animal sounds")).toBeEnabled();
          for (const kind of ["rooster", "donkey"]) {
            await popup.bringToFront();
            await petChoice.selectOption(kind);
            const fresh = await context.newPage();
            const session = await context.newCDPSession(fresh);
            const audioContexts = new Map();
            const sources = [];
            const worlds = [];
            session.on("Runtime.executionContextCreated", ({ context: world }) => worlds.push(world));
            session.on("WebAudio.contextCreated", ({ context: audioContext }) => audioContexts.set(audioContext.contextId, audioContext.contextState));
            session.on("WebAudio.contextChanged", ({ context: audioContext }) => audioContexts.set(audioContext.contextId, audioContext.contextState));
            session.on("WebAudio.contextWillBeDestroyed", ({ contextId }) => audioContexts.delete(contextId));
            session.on("WebAudio.audioNodeCreated", ({ node }) => {
              if (node.nodeType === "AudioBufferSource") sources.push(node);
            });
            await session.send("Runtime.enable");
            await session.send("WebAudio.enable");
            try {
              await fresh.goto(`http://127.0.0.1:${server.address().port}/`);
              await fresh.bringToFront();
              await expect(fresh.locator("[data-power-mode-host]")).toHaveCount(1);
              await expect.poll(() => audioContexts.size).toBeGreaterThan(0);
              await fresh.locator("#button").click();
              await expect.poll(() => [...audioContexts.values()].includes("running")).toBe(true);
              await expect.poll(() => sources.length, { timeout: 9000 }).toBeGreaterThan(0);
              const world = worlds.find((entry) => entry.origin.includes(extensionId));
              assert.ok(world);
              const file = kind === "rooster" ? "rooster.oga" : "donkey.wav";
              const decoded = await session.send("Runtime.evaluate", {
                contextId: world.id,
                awaitPromise: true,
                returnByValue: true,
                expression: `(async () => {
                  const response = await fetch(chrome.runtime.getURL("assets/audio/${file}"));
                  const decoder = new OfflineAudioContext(1, 1, 44100);
                  const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
                  let peak = 0;
                  for (const sample of buffer.getChannelData(0).subarray(0, Math.floor(buffer.sampleRate * 5.5)))
                    peak = Math.max(peak, Math.abs(sample));
                  return { duration: buffer.duration, peak };
                })()`,
              });
              assert.equal(decoded.exceptionDetails, undefined);
              assert.ok(decoded.result.value.duration > 1);
              assert.ok(decoded.result.value.peak > 0.05, `${kind} excerpt is too quiet`);
              if (kind === "rooster") {
                for (const destination of ["reload", "other-url"]) {
                  const callsBefore = sources.length;
                  if (destination === "reload") await fresh.reload();
                  else await fresh.goto(`http://127.0.0.1:${server.address().port}/another-page`);
                  await expect(fresh.locator("[data-power-mode-host]")).toHaveCount(1);
                  await fresh.locator("#button").click();
                  await expect.poll(() => sources.length, { timeout: 10000 }).toBeGreaterThan(callsBefore);
                }
              }
            } finally {
              await session.detach();
              await fresh.close();
            }
          }
          await popup.bringToFront();
          await popup.getByLabel("Idle animal sounds").uncheck();
        },
      );

      await suite.test(
        "hidden pages stop ambient rendering and visible pages restart without typing",
        async () => {
          await page.bringToFront();
          const session = await context.newCDPSession(page);
          const worlds = [];
          session.on("Runtime.executionContextCreated", (event) =>
            worlds.push(event.context),
          );
          await session.send("Runtime.enable");
          const extensionWorld = worlds.find((world) =>
            world.origin.includes(extensionId),
          );
          assert.ok(extensionWorld, JSON.stringify(worlds));
          await session.send("Runtime.evaluate", {
            contextId: extensionWorld.id,
            expression:
              'Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));',
          });
          await expect.poll(() => pixels()).toBe(0);
          await session.send("Runtime.evaluate", {
            contextId: extensionWorld.id,
            expression:
              'delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));',
          });
          await expect.poll(() => pixels(true)).toBeGreaterThan(700);
          await expect(host.locator(".counter")).toBeHidden();
          await session.detach();
        },
      );

      await suite.test(
        "60-second sustained typing has no long tasks",
        { skip: process.env.POWER_MODE_SKIP_PERFORMANCE === "1" },
        async () => {
          await page.setViewportSize({ width: 1280, height: 900 });
          await resetByFocus();
          await page.evaluate(() => {
            window.longTasks = [];
            window.observer = new PerformanceObserver((list) =>
              window.longTasks.push(
                ...list.getEntries().map((entry) => entry.duration),
              ),
            );
            window.observer.observe({ type: "longtask" });
          });
          await page.keyboard.type("a".repeat(750), { delay: 80 });
          await expect(counter).toHaveText("750 HITS");
          const tasks = await page.evaluate(() => {
            window.observer.disconnect();
            return window.longTasks;
          });
          assert.deepEqual(
            tasks,
            [],
            `Long tasks observed: ${tasks.join(", ")}`,
          );
          await expect.poll(() => pixels(false, true)).toBe(0);
          assert.ok((await pixels()) > 0);
        },
      );

      await suite.test(
        "disable removes effects; re-enable does not duplicate; popup persists",
        async () => {
          await popup.bringToFront();
          await popup.setViewportSize({ width: 360, height: 380 });
          await popup.screenshot({ path: "test-results/popup.png" });
          await toggle.uncheck();
          await expect(host).toHaveCount(0);
          await toggle.check();
          await focusNotes();
          await page.keyboard.type("abc");
          await expect(host).toHaveCount(1);
          await expect(counter).toHaveText("3 HITS");
          await popup.reload();
          await expect(toggle).toBeChecked();
          await expect(manager.locator("[data-power-mode-host]")).toHaveCount(
            0,
          );
          assert.deepEqual(errors, []);
        },
      );
    } finally {
      await context?.close();
      await new Promise((resolveClosed) => server.close(resolveClosed));
      await rm(profile, { recursive: true, force: true });
    }
  },
);
