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
const contacts = ["云朵邮差（虚构）", "月球园丁（虚构）", "星砂船长（虚构）", "薄荷机器人（虚构）", "纸飞机向导（虚构）"];

async function waitForHome(page) {
  await page.locator(".launch-screen").waitFor({ state: "hidden" });
  await page.locator(".app main .memory-hero").waitFor({ state: "visible" });
  await page.getByRole("heading", { level: 1, name: /演示旅人（虚构）$/ }).waitFor();
  await page.locator(".soft-column").first().waitFor();
  assert.equal(await page.locator(".first-use-card").count(), 0, "Synthetic records must render, not an empty state");
}

async function navigate(page, label, heading) {
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: new RegExp(label + "$") }).click();
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  await page.locator(".pill-nav button[aria-current='page']").filter({ hasText: label }).waitFor();
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
  await assertNoOverflow(page, "desktop home");
  await assertNoRealDataControls(page);

  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor();
  await page.locator(".settings-sheet").getByRole("button", { name: /重置演示/ }).waitFor();
  assert.equal(await page.locator(".settings-sheet .setting-item").count(), 1, "Only demo reset belongs in demo settings");
  await page.locator(".settings-sheet").getByText("虚构数据", { exact: true }).waitFor();
  await assertNoRealDataControls(page);
  await page.keyboard.press("Escape");
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor({ state: "hidden" });

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

  await navigate(page, "小发现", "关于你们的小发现");
  await page.locator(".discovery-card").first().waitFor();
  assert.equal(await page.locator(".discovery-card").count(), 4);
  await navigate(page, "排行", "通话时长排行");
  await page.locator(".rank-card").first().waitFor();
  assert.equal(await page.locator(".rank-card").count(), 3);
  await navigate(page, "记录", "通话记录");
  await page.locator(".feed-card").first().waitFor();
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
  assert.match(download.suggestedFilename(), /\.png$/i);
  assert.equal(await download.failure(), null, "PNG download must complete successfully");
  const downloadPath = await download.path();
  assert.ok(downloadPath, "Download must be backed by a file, not just an export toast");
  const png = await fs.readFile(downloadPath);
  assert.deepEqual(png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"), "Downloaded bytes must have the PNG signature");
  assert.ok(png.length > 24 && png.toString("ascii", 12, 16) === "IHDR", "Downloaded PNG must include an image header");
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, "Exported image must have nonzero dimensions");
  await download.delete();
  await exportDialog.waitFor({ state: "hidden" });

  await navigate(page, "首页", /演示旅人（虚构）$/);
  await selectContact(page, 1);
  await navigate(page, "记录", "通话记录");
  await page.locator(".feed-card").first().waitFor();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.lastRoute === "calls", settingsKey);
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.locator('.settings-sheet[aria-hidden="false"]').waitFor();
  await assertNoRealDataControls(page);
  await page.locator(".settings-sheet").getByRole("button", { name: /重置演示/ }).click();
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
  await assertNoRealDataControls(page);
  await navigate(page, "通话日历", "通话日历");
  await assertNoOverflow(page, "mobile calendar");
  await navigate(page, "首页", /演示旅人（虚构）$/);
  await waitForHome(page);
  assert.deepEqual(failures, [], "Static Pages demo must complete all interactions without runtime/network errors");
  console.log(`Cloud headless Pages smoke passed for ${metadata.commit}`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
