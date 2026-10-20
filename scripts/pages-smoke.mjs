import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pagesBase } from "./check-pages-build.mjs";

// Never open a local browser/app: this script is exclusively for cloud CI.
if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Pages browser smoke is cloud-only; run it in GitHub Actions");
}
const { chromium } = await import("playwright");
const directory = fileURLToPath(new URL("../dist-pages/", import.meta.url));
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2"
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!pathname.startsWith(pagesBase)) {
      response.writeHead(404).end();
      return;
    }
    const relative = pathname.slice(pagesBase.length) || "index.html";
    const target = path.resolve(directory, relative);
    if (!target.startsWith(`${path.resolve(directory)}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const content = await fs.readFile(target);
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(target)] ?? "application/octet-stream" });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});
const themeKey = "call-footprint.pages-demo.v1.theme";
const settingsKey = "call-footprint.pages-demo.v1.settings.v1";
const legacyDatasetKey = "call-footprint.dataset.v1";
const bogusDataset = "{bogus legacy dataset: must never be parsed}";
const contacts = ["阿杰", "老周", "Lily", "小王", "张同学"];

async function assertMinimalDemoLabel(page) {
  const visibleText = await page.locator("body").innerText();
  assert.equal((visibleText.match(/演示/g) ?? []).length, 1, "Only the header may label the demo");
  assert.doesNotMatch(visibleText, /虚构|合成/);
  assert.equal(await page.locator(".topbar .pages-demo-tag").textContent(), "演示");
}

async function waitForHome(page) {
  await page.locator(".launch-screen").waitFor({ state: "hidden" });
  await page.locator(".app main .memory-hero").waitFor({ state: "visible" });
  await page.getByRole("heading", { level: 1, name: /小陈$/ }).waitFor();
  await page.locator(".soft-column").first().waitFor();
  assert.equal(await page.locator(".first-use-card").count(), 0, "Synthetic records must render, not an empty state");
  await assertMinimalDemoLabel(page);
}

async function navigate(page, label, heading) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: new RegExp(label + "$") }).click();
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  await page.locator(".pill-nav button[aria-current='page']").filter({ hasText: label }).waitFor();
  await assertMinimalDemoLabel(page);
}

async function selectContact(page, index) {
  await page.locator(".contact-switch").click();
  await page.locator(".contact-menu-react").getByRole("button", { name: new RegExp(contacts[index]) }).click();
  await page.locator(".contact-switch strong").filter({ hasText: contacts[index] }).waitFor();
  assert.equal(await page.locator(".contact-switch strong").textContent(), contacts[index]);
  await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key) ?? "null")?.lastContactId === id,
    { key: settingsKey, id: `synthetic-demo-contact-${index + 1}` });
}

async function assertNoRealDataControls(page) {
  assert.equal(await page.getByRole("button", { name: /读取微信|打开文件|保存文件|删除记录|自动扫描/ }).count(), 0,
    "Desktop real-data actions must not be exposed in the demo");
  assert.equal(await page.locator('input[type="file"], .scan-consent-dialog, .import-dialog, .first-use-card').count(), 0);
}

async function assertNoOverflow(page, label) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const dimensions = await page.evaluate(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };
    return {
      width: innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      app: bounds(".app"), main: bounds("main"), nav: bounds(".pill-nav"),
      outliers: [...document.querySelectorAll(".app main *")].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      }).slice(0, 12).map((element) => {
        const rect = element.getBoundingClientRect();
        return { class: String(element.className), left: rect.left, right: rect.right, width: rect.width };
      })
    };
  });
  assert.ok(dimensions.scrollWidth <= dimensions.width + 1, `${label}: document overflows horizontally: ${JSON.stringify(dimensions)}`);
  for (const region of ["app", "main", "nav"]) {
    assert.ok(dimensions[region].left >= -1 && dimensions[region].right <= dimensions.width + 1,
      `${label}: ${region} must fit the viewport: ${JSON.stringify(dimensions)}`);
  }
}

async function assertDownloadEntry(page, label) {
  const link = page.getByRole("link", { name: "下载 Windows x64 安装包", exact: true });
  assert.equal(await link.count(), 1, `${label}: exactly one Windows download link`);
  assert.ok(await link.isVisible(), `${label}: download link must be visible`);
  assert.equal(await link.getAttribute("href"),
    "https://github.com/star5025/wechat-call-footprint-demo/releases/download/v0.5.1/Call-Footprint-v0.5.1-x64-setup.exe");
  assert.equal(await link.textContent(), "下载");
  assert.equal(await link.getAttribute("title"), null, "Download link must not add a tooltip");
  assert.ok(await link.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth
      && rect.top >= 0 && rect.bottom <= innerHeight && (hit === element || element.contains(hit));
  }), `${label}: download must be a reachable touch target`);
  // Inspect the direct installer URL only; never click it or bypass the external-request guard.
}

async function assertTopbarLayout(page, label) {
  const layout = await page.evaluate(() => {
    const bounds = (element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const header = document.querySelector(".app.pages-demo .topbar");
    return {
      width: innerWidth,
      header: bounds(header),
      children: [...header.children].map(bounds),
      actions: [...header.querySelector(".top-actions").children].map(bounds)
    };
  });
  for (const group of [layout.children, layout.actions]) {
    for (const [index, rect] of group.entries()) {
      assert.ok(rect.left >= 0 && rect.right <= layout.width, `${label}: topbar control must fit: ${JSON.stringify(rect)}`);
      if (layout.width > 900) {
        assert.ok(rect.top >= layout.header.top && rect.bottom <= layout.header.bottom,
          `${label}: desktop navigation and actions must remain in the topbar`);
      }
      for (const other of group.slice(index + 1)) {
        const overlap = Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 0.5
          && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 0.5;
        assert.ok(!overlap, `${label}: topbar controls overlap: ${JSON.stringify([rect, other])}`);
      }
    }
  }
}

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const failures = [];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, reducedMotion: "reduce" });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  // Seed once, before any application code, without resetting persisted theme/settings on reload.
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem("pages-smoke-seeded")) {
      localStorage.setItem(key, value);
      sessionStorage.setItem("pages-smoke-seeded", "true");
    }
  }, { key: legacyDatasetKey, value: bogusDataset });
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      failures.push(`Unexpected external request: ${route.request().url()}`);
      await route.abort();
    } else await route.continue();
  });
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("requestfailed", (request) => failures.push(`Request failed: ${request.url()}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  const response = await page.goto(`${origin}${pagesBase}`, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await waitForHome(page);
  assert.equal(await page.locator(".contact-switch strong").textContent(), contacts[0]);
  assert.equal(await page.locator(".demo-tag").textContent(), "演示");
  await page.locator(".contact-switch").click();
  await page.locator(".contact-menu-react").waitFor();
  assert.deepEqual(await page.locator(".contact-menu-react strong").allTextContents(), contacts, "Exactly five synthetic contacts must be available");
  assert.equal(await page.locator(".contact-menu-react button").count(), 5);
  assert.equal(await page.locator(".contact-menu-react button").filter({ hasText: "✅" }).locator("strong").textContent(), contacts[0]);
  await page.locator(".contact-switch").click();
  await selectContact(page, 1);
  await selectContact(page, 0);
  // Exercise the shared application transition with animations enabled, not just demo startup.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.__contactAnimationCount = 0;
    window.__originalAnimate = Element.prototype.animate;
    window.__firstChartBar = document.querySelector(".soft-column .bar");
    window.__numberFrames = [];
    window.__numberStart = Number(document.querySelector(".big-number").dataset.numberCurrent);
    window.__numberObserver = new MutationObserver(() => {
      window.__numberFrames.push(Number(document.querySelector(".big-number").dataset.numberCurrent));
    });
    window.__numberObserver.observe(document.querySelector(".big-number"), { attributes: true, attributeFilter: ["data-number-current"] });
    Element.prototype.animate = function (...args) {
      if (this.matches("[data-contact-content]")) {
        window.__contactAnimationCount += 1;
        if (Number(args[0][0].opacity) < .9) throw new Error("Contact fade must not flash the background");
      }
      return window.__originalAnimate.apply(this, args);
    };
  });
  await selectContact(page, 1);
  assert.equal(await page.evaluate(() => window.__contactAnimationCount), 4,
    "Shared home sections must animate on contact change");
  assert.ok(await page.evaluate(() => window.__firstChartBar === document.querySelector(".soft-column .bar")),
    "Chart bars must be reused so heights can interpolate");
  assert.ok(await page.locator(".soft-column .bar").first().evaluate((element) =>
    getComputedStyle(element).transitionProperty.split(", ").includes("height")));
  assert.match(await page.locator(".latest-main strong").textContent(), /老周/);
  await page.waitForFunction(() => [...document.querySelectorAll("[data-contact-content]")]
    .every((element) => element.getAnimations().length === 0));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-number-target]")]
    .every((element) => element.dataset.numberCurrent === element.dataset.numberTarget));
  const numericMotion = await page.evaluate(() => {
    window.__numberObserver.disconnect();
    const element = document.querySelector(".big-number");
    return { start: window.__numberStart, frames: window.__numberFrames, end: Number(element.dataset.numberTarget), label: element.getAttribute("aria-label") };
  });
  assert.ok(numericMotion.frames.some((value) => value > Math.min(numericMotion.start, numericMotion.end)
    && value < Math.max(numericMotion.start, numericMotion.end)), "Total duration must show intermediate values, not just replace text");
  assert.equal(numericMotion.frames.at(-1), numericMotion.end);
  assert.match(numericMotion.label, /^\d+小时 \d+分$/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await selectContact(page, 0);
  assert.ok(await page.locator("[data-number-target]").evaluateAll((elements) => elements.every((element) =>
    element.dataset.numberCurrent === element.dataset.numberTarget)), "Reduced motion must display exact numbers immediately");
  assert.equal(await page.evaluate(() => window.__contactAnimationCount), 4,
    "Reduced motion must skip the scripted contact animations");
  await page.evaluate(() => { Element.prototype.animate = window.__originalAnimate; });
  for (const width of [901, 921, 1024, 1100, 1101, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page, `desktop home ${width}`);
    await assertTopbarLayout(page, `desktop ${width}`);
    await assertDownloadEntry(page, `desktop ${width}`);
  }
  await assertNoRealDataControls(page);

  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor();
  await page.locator(".settings-sheet").getByRole("button", { name: /重置/ }).waitFor();
  assert.equal(await page.locator(".settings-sheet .setting-item").count(), 1, "Only demo reset belongs in demo settings");
  assert.equal(await page.locator(".settings-sheet .local-note").count(), 0);
  assert.doesNotMatch(await page.locator(".settings-sheet").innerText(), /演示|虚构|合成/);
  await assertNoRealDataControls(page);
  await page.keyboard.press("Escape");
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor({ state: "hidden" });

  const appearanceKey = "call-footprint.pages-demo.v1.appearance";
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "主题风格：默认", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor();
  assert.equal(await page.getByRole("button", { name: "主题风格：默认", exact: true }).getAttribute("aria-expanded"), "false");
  assert.ok(await page.getByRole("button", { name: "主题风格：默认", exact: true }).evaluate((element) => element === document.activeElement));
  await page.getByRole("button", { name: "主题风格：默认", exact: true }).click();
  await page.getByRole("listbox", { name: "主题风格", exact: true }).getByRole("option", { name: "GitHub", exact: true }).click();
  await page.waitForFunction((key) => document.documentElement.dataset.appearance === "github"
    && localStorage.getItem(key) === "github", appearanceKey);
  await page.keyboard.press("Escape");
  for (const theme of ["dark", "light"]) {
    await page.getByRole("button", { name: theme === "dark" ? "切换到黑夜模式" : "切换到日间模式", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    await waitForHome(page);
    assert.equal(await page.locator("html").getAttribute("data-appearance"), "github");
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    const palette = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      heroBackground: getComputedStyle(document.querySelector(".memory-hero")).backgroundColor,
      meta: document.querySelector('meta[name="theme-color"]').content
    }));
    assert.equal(palette.background, theme === "dark" ? "rgb(13, 17, 23)" : "rgb(255, 255, 255)");
    assert.equal(palette.meta, theme === "dark" ? "#0d1117" : "#ffffff");
    for (const width of [390, 921, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoOverflow(page, `GitHub ${theme} home ${width}`);
      await assertTopbarLayout(page, `GitHub ${theme} topbar ${width}`);
      await assertDownloadEntry(page, `GitHub ${theme} download ${width}`);
    }
    await navigate(page, "通话日历", "通话日历");
    await page.locator(".wall-cell.has-record").first().hover();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "通话日历", exact: true }).hover();
    await navigate(page, "记录", "通话记录");
    await page.locator(".feed-card").first().click();
    await page.locator('.detail-sheet[aria-hidden="false"]').waitFor();
    await page.locator(".detail-sheet .sheet-close").click();
    await navigate(page, "小发现", "关于你们的小发现");
    await navigate(page, "排行", "通话时长排行");
    await navigate(page, "首页", /小陈$/);
  }
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "主题风格：GitHub", exact: true }).click();
  await page.getByRole("listbox", { name: "主题风格", exact: true }).getByRole("option", { name: "默认", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await waitForHome(page);
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "default");

  assert.ok(await page.locator('script[src$="/theme-init.js"]').count(), "Theme initializer must load");
  assert.ok(await page.locator('script[type="module"]').count(), "Built entry module must load");
  const metadataResponse = await page.request.get(`${origin}${pagesBase}build-info.json`);
  assert.equal(metadataResponse.status(), 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.commit, process.env.GITHUB_SHA);
  assert.equal(metadata.base, pagesBase);
  assert.ok(Number.isFinite(Date.parse(metadata.builtAt)), "Build timestamp must be valid");
  for (const theme of ["dark", "light"]) {
    await page.getByRole("button", { name: theme === "dark" ? "切换到黑夜模式" : "切换到日间模式", exact: true }).click();
    await page.waitForFunction(({ key, theme }) => document.documentElement.dataset.theme === theme
      && document.documentElement.style.colorScheme === theme && localStorage.getItem(key) === theme, { key: themeKey, theme });
    await page.reload({ waitUntil: "networkidle" });
    await waitForHome(page);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme, "Theme must survive reload");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), themeKey), theme);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), legacyDatasetKey), bogusDataset,
      "Demo must ignore and preserve a malformed legacy dataset");
    assert.equal(await page.locator(".contact-switch strong").textContent(), contacts[0]);
  }

  const column = page.locator(".soft-column").last();
  await column.hover();
  await column.locator(".soft-column-tip").waitFor({ state: "visible" });
  const chartValue = await column.locator(".soft-column-tip").textContent();
  assert.match(chartValue, /^\d+:\d{2}(?::\d{2})?$/, "Chart hover must expose a formatted duration");
  assert.ok((await column.getAttribute("aria-label")).includes(chartValue));
  await page.locator(".soft-tabs").getByRole("button", { name: "次数", exact: true }).click();
  await page.locator(".soft-tabs button.active").filter({ hasText: "次数" }).waitFor();
  await column.hover();
  await column.locator(".soft-column-tip").waitFor({ state: "visible" });
  assert.match(await column.getAttribute("aria-label"), /通话 \d+ 次$/);
  assert.match(await column.locator(".soft-column-tip").textContent(), /^\d+$/);

  await navigate(page, "通话日历", "通话日历");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const theme of ["dark", "light"]) {
    await page.getByRole("button", { name: theme === "dark" ? "切换到黑夜模式" : "切换到日间模式", exact: true }).click();
    await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme);
    const metricMotion = await page.evaluate(async () => {
      const cells = [...document.querySelectorAll(".wall-cell.has-record")];
      const summary = document.querySelector(".wall-summary").textContent;
      const before = cells.map((cell) => getComputedStyle(cell).backgroundColor);
      const sample = [];
      const buttons = document.querySelectorAll(".wall-metric-toggle button");
      buttons[1].click();
      const started = performance.now();
      while (performance.now() - started < 650) {
        await new Promise(requestAnimationFrame);
        sample.push(cells.map((cell) => getComputedStyle(cell).backgroundColor));
      }
      const after = cells.map((cell) => getComputedStyle(cell).backgroundColor);
      const changed = before.map((color, index) => color !== after[index] ? index : -1).filter((index) => index >= 0);
      const slider = getComputedStyle(document.querySelector(".wall-metric-toggle"), "::before");
      return {
        changed: changed.length,
        interpolated: changed.some((index) => sample.some((colors) => colors[index] !== before[index] && colors[index] !== after[index])),
        reused: cells.every((cell) => cell.isConnected),
        summaryUnchanged: summary === document.querySelector(".wall-summary").textContent,
        selected: buttons[1].getAttribute("aria-pressed"),
        sliderTransform: slider.transform,
        sliderDuration: slider.transitionDuration
      };
    });
    assert.ok(metricMotion.changed > 0 && metricMotion.interpolated, `${theme}: heatmap colors must interpolate rather than jump`);
    assert.ok(metricMotion.reused && metricMotion.summaryUnchanged, "Metric switches must retain calendar cells and summary data");
    assert.equal(metricMotion.selected, "true");
    assert.notEqual(metricMotion.sliderTransform, "none");
    assert.equal(metricMotion.sliderDuration, "0.38s");
    // Reverse direction mid-transition, then leave the original metric selected.
    await page.locator(".wall-metric-toggle").getByRole("button", { name: "按时长", exact: true }).click();
    await page.locator(".wall-metric-toggle").getByRole("button", { name: "按次数", exact: true }).click();
    await page.locator(".wall-metric-toggle").getByRole("button", { name: "按时长", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".wall-cell")].every((cell) => cell.getAnimations().length === 0));
  }
  assert.equal(await page.evaluate(() => {
    const app = document.querySelector(".app");
    app.classList.add("reduced-motion");
    const duration = getComputedStyle(document.querySelector(".wall-metric-toggle"), "::before").transitionDuration;
    app.classList.remove("reduced-motion");
    return duration;
  }), "0s", "In-app reduced motion must also disable the metric slider");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(await page.locator(".wall-cell.has-record").first().evaluate((cell) =>
    getComputedStyle(cell).transitionDuration.split(",").every((duration) => parseFloat(duration) < .01)),
    "Metric color transitions must respect reduced motion");
  await page.locator(".contribution-card").scrollIntoViewIfNeeded();
  const day = page.getByRole("button", { name: /^10 月 19 日，/ });
  await day.hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor({ state: "visible" });
  assert.equal(await tooltip.locator("strong").textContent(), "10 月 19 日");
  assert.match(await tooltip.textContent(), /1 次已接通/);
  // Read live boxes after hover, never cached element handles; allow the cell's small hover transform.
  await page.waitForFunction(() => {
    const tip = document.querySelector('.wall-hover-card');
    const cell = document.querySelector('.wall-cell.has-record:hover');
    if (!tip || !cell) return false;
    const t = tip.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const anchorX = Math.max(110, Math.min(innerWidth - 110, c.left + c.width / 2));
    return getComputedStyle(tip).position === "fixed" && Math.abs(t.left + t.width / 2 - anchorX) < 4
      && c.top - t.bottom > 0 && c.top - t.bottom < 30
      && t.left >= 0 && t.right <= innerWidth && t.top >= 0 && t.bottom <= innerHeight;
  });
  await page.getByRole("heading", { level: 1, name: "通话日历", exact: true }).hover();
  await tooltip.waitFor({ state: "hidden" });
  await day.click();
  await page.locator(".day-preview").waitFor({ state: "visible" });
  const wallCard = await page.locator(".contribution-card").elementHandle();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    const element = document.querySelector(".wall-stat strong [data-number-target]");
    window.__wallNumberStart = Number(element.dataset.numberCurrent);
    window.__wallNumberFrames = [];
    window.__wallNumberObserver = new MutationObserver(() => window.__wallNumberFrames.push(Number(element.dataset.numberCurrent)));
    window.__wallNumberObserver.observe(element, { attributes: true, attributeFilter: ["data-number-current"] });
  });
  await selectContact(page, 1);
  await page.waitForFunction(() => [...document.querySelectorAll(".wall-summary [data-number-target]")]
    .every((element) => element.dataset.numberCurrent === element.dataset.numberTarget));
  const wallMotion = await page.evaluate(() => {
    window.__wallNumberObserver.disconnect();
    return { start: window.__wallNumberStart, frames: window.__wallNumberFrames,
      end: Number(document.querySelector(".wall-stat strong [data-number-target]").dataset.numberTarget) };
  });
  assert.ok(wallMotion.frames.some((value) => value > Math.min(wallMotion.start, wallMotion.end)
    && value < Math.max(wallMotion.start, wallMotion.end)), "Calendar statistics must show intermediate values");
  assert.equal(wallMotion.frames.at(-1), wallMotion.end);
  assert.equal(await page.locator(".wall-stat strong [data-number-target]").count(), 4);
  assert.ok(await page.locator(".wall-stat strong [data-number-target]").first().evaluate((element) =>
    getComputedStyle(element).display === "inline" && getComputedStyle(element).fontSize === getComputedStyle(element.parentElement).fontSize),
    "Numeric wrappers must retain calendar statistic typography");
  assert.equal(await page.locator(".day-preview").count(), 0, "Previous contact's day detail must clear");
  assert.equal(await page.getByRole("tooltip").count(), 0, "Previous contact's tooltip must clear");
  assert.ok(await wallCard.evaluate((element) => element === document.querySelector(".contribution-card")),
    "Calendar must update in place, preserving range and controls");
  assert.ok(await page.locator(".contribution-card.mode-year").count());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await selectContact(page, 0);
  assert.ok(await page.locator(".wall-summary [data-number-target]").evaluateAll((elements) =>
    elements.every((element) => element.dataset.numberCurrent === element.dataset.numberTarget)),
    "Calendar statistics must snap for reduced motion");
  await wallCard.dispose();

  await navigate(page, "小发现", "关于你们的小发现");
  await page.locator(".discovery-card").first().waitFor();
  assert.equal(await page.locator(".discovery-card").count(), 4);
  await navigate(page, "排行", "通话时长排行");
  await page.locator(".rank-card").first().waitFor();
  assert.equal(await page.locator(".rank-card").count(), 3);
  await navigate(page, "记录", "通话记录");
  await page.locator(".feed-card").first().waitFor();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.__feedAnimations = 0;
    window.__feedAnimateOriginal = Element.prototype.animate;
    window.__feedNode = document.querySelector(".call-feed");
    Element.prototype.animate = function (...args) {
      if (this.matches(".call-feed")) {
        window.__feedAnimations += 1;
        if (Number(args[0][0].opacity) < .9) throw new Error("Filter animation must not flash white");
      }
      return window.__feedAnimateOriginal.apply(this, args);
    };
  });
  const totalCalls = await page.locator(".feed-card").count();
  assert.ok(totalCalls > 0, "Call feed must contain real rendered synthetic records");
  await page.getByRole("button", { name: "通话时长：全部时长", exact: true }).click();
  await page.getByRole("listbox", { name: "通话时长", exact: true }).getByRole("option", { name: "5 分钟以内", exact: true }).click();
  await page.getByRole("button", { name: "通话时长：5 分钟以内", exact: true }).waitFor();
  await page.waitForFunction((total) => {
    const count = document.querySelectorAll(".feed-card").length;
    return count > 0 && count < total && document.querySelector(".calls-header .date-line")?.textContent === `${count} 条记录`;
  }, totalCalls);
  const filteredDurations = await page.locator(".feed-card .feed-time strong").allTextContents();
  for (const duration of filteredDurations) {
    assert.match(duration, /^[0-4]分 [0-5]\d秒$/, `Duration filter leaked a record: ${duration}`);
    assert.notEqual(duration, "0分 00秒", "Unconnected calls must be excluded by duration");
  }
  assert.equal(await page.evaluate(() => window.__feedAnimations), 1, "Duration change must animate");
  await page.getByRole("button", { name: "排序方式：最新优先", exact: true }).click();
  await page.getByRole("listbox", { name: "排序方式", exact: true }).getByRole("option", { name: "时长升序", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__feedAnimations), 2, "Sort change must animate");
  await page.getByRole("button", { name: "时间范围：全部时间", exact: true }).click();
  await page.getByRole("listbox", { name: "时间范围", exact: true }).getByRole("option", { name: "自定义", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__feedAnimations), 3, "Time range change must animate even if results are unchanged");
  await page.getByRole("button", { name: "搜索记录", exact: true }).click();
  const search = page.locator(".search-reveal input");
  await search.fill("没有匹配的联系人");
  await page.locator(".call-feed .gentle-note").waitFor();
  assert.equal(await page.evaluate(() => window.__feedAnimations), 4, "Empty results must animate");
  await search.fill("没有匹配的联系人2");
  assert.equal(await page.evaluate(() => window.__feedAnimations), 5, "Every condition update must animate, even empty-to-empty");
  await search.fill("");
  assert.equal(await page.evaluate(() => window.__feedAnimations), 6);
  assert.ok(await page.evaluate(() => window.__feedNode === document.querySelector(".call-feed")), "Feed must update in place");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await search.fill("阿杰");
  assert.equal(await page.evaluate(() => window.__feedAnimations), 6, "Reduced motion must skip filter animations");
  await search.fill("");
  await page.evaluate(() => { Element.prototype.animate = window.__feedAnimateOriginal; });
  await page.locator(".feed-card").first().click();
  await page.locator('.detail-sheet[aria-hidden="false"]').waitFor();
  await page.locator(".detail-sheet").getByRole("heading", { name: new RegExp(contacts[0]) }).waitFor();
  await page.locator(".detail-sheet .sheet-close").click();
  await page.locator('.detail-sheet[aria-hidden="false"]').waitFor({ state: "hidden" });

  await page.getByRole("button", { name: `为${contacts[0]}导出通话总结长图`, exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "导出通话总结？", exact: true });
  await exportDialog.waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    exportDialog.getByRole("button", { name: "确认", exact: true }).click()
  ]);
  assert.equal(download.suggestedFilename(), `${contacts[0]}-通话总结.png`);
  assert.equal(await download.failure(), null, "PNG download must complete successfully");
  const downloadPath = await download.path();
  assert.ok(downloadPath, "Download must be backed by a file, not just an export toast");
  const png = await fs.readFile(downloadPath);
  assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"), "Downloaded bytes must have the PNG signature");
  assert.ok(png.length > 24 && png.toString("ascii", 12, 16) === "IHDR", "Downloaded PNG must include an image header");
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, "Exported image must have nonzero dimensions");
  await download.delete();
  await exportDialog.waitFor({ state: "hidden" });

  await navigate(page, "首页", /小陈$/);
  await selectContact(page, 1);
  await navigate(page, "记录", "通话记录");
  await page.locator(".feed-card").first().waitFor();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.lastRoute === "calls", settingsKey);
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor();
  await assertNoRealDataControls(page);
  await page.locator(".settings-sheet").getByRole("button", { name: /重置/ }).click();
  await waitForHome(page);
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor({ state: "hidden" });
  assert.equal(await page.locator(".contact-switch strong").textContent(), contacts[0], "Reset must restore the first synthetic contact");
  await page.locator('.pill-nav button[aria-current="page"]').filter({ hasText: "首页" }).waitFor();
  await page.waitForFunction((key) => {
    const settings = JSON.parse(localStorage.getItem(key));
    return settings?.lastRoute === "home" && settings.lastContactId === null;
  }, settingsKey);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), legacyDatasetKey), bogusDataset);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), themeKey), "light", "Reset must not overwrite the independent theme preference");

  await page.setViewportSize({ width: 390, height: 844 });
  await waitForHome(page);
  await assertNoOverflow(page, "mobile home");
  await assertTopbarLayout(page, "mobile 390");
  assert.ok(await page.locator(".pill-nav").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top > innerHeight / 2 && Math.abs(innerHeight - rect.bottom - 14) < 2;
  }), "Mobile navigation must be anchored to the viewport bottom");
  await assertDownloadEntry(page, "mobile 390");
  await assertNoRealDataControls(page);
  await navigate(page, "通话日历", "通话日历");
  await assertNoOverflow(page, "mobile calendar");
  await navigate(page, "首页", /小陈$/);
  await waitForHome(page);
  assert.deepEqual(failures, [], "Static Pages demo must complete all interactions without runtime/network errors");
  console.log(`Cloud headless Pages smoke passed for ${metadata.commit}`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
