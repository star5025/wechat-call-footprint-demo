import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// No local browsers, native app, credentials, or WeChat data: GitHub Actions only.
if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Mac setup browser smoke is cloud-only; run it in GitHub Actions");
}
const { chromium } = await import("playwright");
const root = await fs.realpath(fileURLToPath(new URL("../dist/", import.meta.url)));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const contained = (target) => { const relative = path.relative(root, target); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); };
const server = http.createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const candidate = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!contained(candidate)) { response.writeHead(403).end(); return; }
    const target = await fs.realpath(candidate);
    if (!contained(target)) { response.writeHead(403).end(); return; }
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) { response.writeHead(404).end(); return; }
    const content = await fs.readFile(target);
    response.writeHead(200, { "Content-Type": mime[path.extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch { response.writeHead(404).end(); }
});
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.maxConnections = 32;
// A tiny, entirely synthetic AppDataset; never import the excluded production demo.
const dataset = {
  format: "call-footprint-export", formatVersion: "1.0", contractVersion: "1.0",
  exportedAt: "2026-10-01T12:00:00+08:00", timezone: "Asia/Shanghai",
  source: { kind: "normalized_file", displayName: "CI synthetic fixture", sourceVersion: "1" },
  account: { id: "ci-account", displayName: "CI账号", avatarRef: null },
  contacts: [{ id: "ci-contact", accountId: "ci-account", kind: "person", displayName: "CI联系人", wechatId: null,
    avatarRef: null, aliases: [], identityConfidence: "confirmed", needsReview: false, mergedFromContactIds: [],
    firstCallAt: "2026-10-01T12:00:00+08:00", lastCallAt: "2026-10-01T12:00:00+08:00" }],
  events: [{ id: "ci-event", accountId: "ci-account", contactId: "ci-contact", contactSnapshot: { displayName: "CI联系人", kind: "person" },
    conversationId: "ci-conversation", startedAt: "2026-10-01T12:00:00+08:00", answeredAt: null, endedAt: null,
    timezone: "Asia/Shanghai", utcOffsetMinutes: 480, connectedDurationSeconds: 60, mediaType: "voice", direction: "outgoing",
    outcome: "completed", parseConfidence: "confirmed", identityConfidence: "confirmed", dedupConfidence: "confirmed", qualityFlags: [], excluded: false,
    lineage: { sourceRefs: [{ sourceId: "ci-source", sourceRecordIdHash: "ci-hash", sourceDatabaseKind: "synthetic_fixture", sourcePartition: "ci" }],
      adapterId: "ci", adapterVersion: "1", parserVersion: "1", dedupVersion: "1", normalizedAt: "2026-10-01T12:00:00+08:00" } }],
  coverage: [{ startDate: "2026-10-01", endDate: "2026-10-01", state: "complete", sourceIds: ["ci-source"], reasonCode: null }]
};
const failures = [];
let browser;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  async function open(scenario, theme = "light", platform = "macos") {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === origin) await route.continue();
      else { failures.push(`External request: ${route.request().url()}`); await route.abort(); }
    });
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) failures.push(`HTTP ${response.status()}: ${response.url()}`); });
    await page.addInitScript(({ fixture, scenario, theme, platform }) => {
      localStorage.setItem("call-footprint.theme", theme);
      localStorage.setItem("call-footprint.appearance", "github");
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const callbacks = new Map(), listeners = new Map(), pending = new Map();
      let id = 0;
      const mock = window.__macSmoke = {
        calls: [], unexpected: [], saved: [], stored: clone(fixture),
        status: { accounts: [{ id: "ci-missing", label: "RAW_PRIVATE_LABEL", keyReady: false }, { id: "ci-ready", label: "RAW_PRIVATE_LABEL", keyReady: true }],
          wechatVersion: "4.1.13", canInitialize: scenario !== "blocked", blocker: scenario === "blocked" ? "MACOS_SETUP_TOOLS_MISSING: RAW_SECRET /private/ci" : null, recoveryRequired: false },
        settle(command, error = null, result = null) {
          const deferred = pending.get(command);
          if (!deferred) throw new Error(`No pending IPC: ${command}`);
          pending.delete(command);
          if (error) deferred.reject(error); else deferred.resolve(result);
        },
        emit(event) {
          for (const [eventId, value] of listeners) if (value.event === event) callbacks.get(value.handler)?.({ event, id: eventId,
            payload: { percent: 42, stage: "RAW_SECRET", detail: "/private/ci RAW_SECRET" } });
        },
        listenerCount: () => listeners.size
      };
      const defer = (command) => new Promise((resolve, reject) => pending.set(command, { resolve, reject }));
      window.__TAURI_INTERNALS__ = {
        transformCallback(callback, once = false) { const key = ++id; callbacks.set(key, (value) => { if (once) callbacks.delete(key); callback(value); }); return key; },
        unregisterCallback(key) { callbacks.delete(key); },
        async invoke(command, args = {}) {
          mock.calls.push({ command, args: clone(args) });
          switch (command) {
            case "app_info": return { name: "通话足迹", version: "ci", platform, arch: "aarch64", dataDirectory: "CI mock", isTauri: true };
            case "load_settings": return null;
            case "load_dataset": return JSON.stringify(mock.stored);
            case "save_settings": return null;
            case "save_dataset": mock.saved.push(args.content); mock.stored = JSON.parse(args.content); return null;
            case "mac_setup_check": return clone(mock.status);
            case "mac_setup_initialize":
              if (args.accountId !== "ci-missing" || args.acknowledged !== true) break;
              await defer(command); mock.status.accounts[0].keyReady = true; return clone(mock.status);
            case "mac_setup_scan":
              if (!mock.status.accounts.some((account) => account.id === args.accountId && account.keyReady)) break;
              return defer(command);
            case "mac_setup_cancel": return defer(command);
            case "plugin:event|listen":
              if (!["mac-setup-progress", "wechat-scan-progress"].includes(args.event) || !callbacks.has(args.handler)) break;
              listeners.set(++id, args); return id;
            case "plugin:event|unlisten": return null;
          }
          mock.unexpected.push({ command, args });
          throw new Error(`Unexpected IPC contract: ${command}`);
        }
      };
      // Tauri event.js unregisters here BEFORE invoking plugin:event|unlisten.
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event, eventId) {
        const listener = listeners.get(eventId);
        if (!listener || listener.event !== event) throw new Error("Unexpected event cleanup");
        callbacks.delete(listener.handler); listeners.delete(eventId);
      } };
    }, { fixture: dataset, scenario, theme, platform });
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator(".launch-screen").waitFor({ state: "hidden" });
    await page.locator(".memory-hero").waitFor();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.locator(".scan-setting").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    if (platform === "macos") await idle(page);
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    assert.equal(await page.locator("html").getAttribute("data-appearance"), "github");
    assert.ok(await dialog.evaluate((element) => { const r = element.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    return { page, dialog, context };
  }
  const count = (page, command) => page.evaluate((cmd) => window.__macSmoke.calls.filter((call) => call.command === cmd).length, command);
  const called = (page, command, n = 1) => page.waitForFunction(({ command, n }) => window.__macSmoke.calls.filter((call) => call.command === command).length >= n, { command, n });
  const button = (dialog, name) => dialog.getByRole("button", { name, exact: true });
  async function idle(page) { await page.locator('[role="dialog"][aria-busy="false"]').waitFor(); }
  async function unchanged(page) {
    assert.deepEqual(await page.evaluate(() => window.__macSmoke.stored), dataset);
    assert.deepEqual(await page.evaluate(() => window.__macSmoke.saved), []);
    assert.deepEqual(await page.evaluate(() => window.__macSmoke.unexpected), []);
    assert.equal(await page.evaluate(() => window.__macSmoke.listenerCount()), 0);
    assert.doesNotMatch(await page.locator("body").innerText(), /RAW_SECRET|RAW_PRIVATE_LABEL|\/private\/ci/);
    await page.locator(".memory-hero").waitFor();
  }
  // Initialization unavailable must not hide accounts or disable already-ready reading.
  {
    const { page, dialog, context } = await open("blocked", "dark");
    assert.equal(await dialog.getByRole("combobox").locator("option").count(), 2);
    assert.equal(await button(dialog, "准备密钥").count(), 0);
    await dialog.getByRole("combobox").selectOption("ci-ready");
    await button(dialog, "读取").click();
    assert.equal(await count(page, "mac_setup_scan"), 0);
    assert.equal(await count(page, "mac_setup_initialize"), 0);
    await button(dialog, "同意读取").click();
    await called(page, "mac_setup_scan");
    await page.evaluate(() => window.__macSmoke.settle("mac_setup_scan", "opaque RAW_SECRET /private/ci"));
    await idle(page);
    await unchanged(page);
    await context.close();
  }
  // Separate explicit risk acknowledgment, key readiness, read consent, and deferred cleanup.
  {
    const { page, dialog, context } = await open("initialize");
    await button(dialog, "准备密钥").click();
    assert.ok(await button(dialog, "初始化").isDisabled());
    assert.equal(await count(page, "mac_setup_initialize"), 0);
    await dialog.getByRole("checkbox").check();
    assert.equal(await count(page, "mac_setup_initialize"), 0);
    await button(dialog, "初始化").click();
    await called(page, "mac_setup_initialize");
    await page.evaluate(() => window.__macSmoke.emit("mac-setup-progress"));
    assert.doesNotMatch(await dialog.innerText(), /RAW_SECRET|\/private\/ci/);
    await page.evaluate(() => window.__macSmoke.settle("mac_setup_initialize"));
    await idle(page);
    await button(dialog, "读取").waitFor();
    assert.match(await dialog.innerText(), /密钥已就绪/);
    assert.equal(await count(page, "mac_setup_scan"), 0);
    await button(dialog, "读取").click();
    assert.equal(await dialog.getByRole("checkbox").count(), 0);
    assert.equal(await count(page, "mac_setup_scan"), 0);
    await button(dialog, "同意读取").click();
    await called(page, "mac_setup_scan");
    await button(dialog, "取消").click();
    await called(page, "mac_setup_cancel");
    await page.evaluate(() => window.__macSmoke.settle("mac_setup_cancel"));
    await page.keyboard.press("Escape");
    assert.ok(await dialog.isVisible());
    assert.ok(await button(dialog, "关闭设置").isDisabled());
    assert.ok(await button(dialog, "正在清理").isDisabled());
    assert.equal(await count(page, "mac_setup_check"), 2, "Cancel acknowledgment alone must not trigger cleanup completion");
    await page.evaluate(() => window.__macSmoke.settle("mac_setup_scan", "MACOS_SETUP_CANCELLED: RAW_SECRET"));
    await idle(page);
    assert.match(await dialog.innerText(), /操作已取消/);
    await unchanged(page);
    // Recovery errors stay fail-closed until a fresh, safe status check.
    await button(dialog, "读取").click();
    await button(dialog, "同意读取").click();
    await called(page, "mac_setup_scan", 2);
    await page.evaluate(() => window.__macSmoke.settle("mac_setup_scan", "MACOS_SETUP_CLEANUP_FAILED: RAW_SECRET /private/ci"));
    await idle(page);
    assert.match(await dialog.getByRole("alert").innerText(), /清理尚未完成/);
    assert.ok(await dialog.getByRole("combobox").isDisabled());
    assert.equal(await button(dialog, "读取").count(), 0);
    assert.equal(await button(dialog, "准备密钥").count(), 0);
    await page.evaluate(() => { window.__macSmoke.status.recoveryRequired = true; });
    await button(dialog, "重试").click(); await idle(page);
    assert.equal(await button(dialog, "读取").count(), 0);
    await page.evaluate(() => { window.__macSmoke.status.recoveryRequired = false; });
    await button(dialog, "重试").click(); await idle(page);
    await button(dialog, "读取").waitFor();
    assert.ok(await dialog.getByRole("combobox").isEnabled());
    await unchanged(page);
    await button(dialog, "关闭").click();
    await dialog.waitFor({ state: "hidden" });
    await context.close();
  }
  // A successful explicit read validates and saves through the real shared app flow.
  {
    const { page, dialog, context } = await open("blocked");
    await dialog.getByRole("combobox").selectOption("ci-ready");
    await button(dialog, "读取").click();
    await button(dialog, "同意读取").click();
    await called(page, "mac_setup_scan");
    await page.evaluate((fixture) => window.__macSmoke.settle("mac_setup_scan", null, {
      dataset: fixture,
      summary: { wechatVersion: "4.1.13", accountLabel: "账号 2", databaseShards: 1,
        contactsWithCalls: 1, callEvents: 1, warnings: [] }
    }), dataset);
    await called(page, "save_dataset");
    await page.locator("#mac-setup-title").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.__macSmoke.saved.length), 1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.__macSmoke.saved[0])), dataset);
    assert.equal(await page.evaluate(() => window.__macSmoke.listenerCount()), 0);
    assert.deepEqual(await page.evaluate(() => window.__macSmoke.unexpected), []);
    await context.close();
  }
  {
    const { page, dialog, context } = await open("windows", "light", "windows");
    assert.equal(await count(page, "mac_setup_check"), 0);
    assert.equal(await page.locator("#scan-consent-title").textContent(), "读取微信通话记录");
    await button(dialog, "取消").click();
    await unchanged(page);
    await context.close();
  }
  assert.deepEqual(failures, []);
  console.log("Production Mac setup smoke passed: consent, readiness, cancel/cleanup, recovery, GitHub themes, Windows routing.");
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
