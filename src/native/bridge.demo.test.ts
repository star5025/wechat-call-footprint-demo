import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/domain";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  storage = new Map();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); }
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage, __TAURI_INTERNALS__: {} });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Pages demo isolation", () => {
  it("loads only synthetic data despite private browser data or a native global", async () => {
    vi.stubEnv("MODE", "pages-demo");
    storage.set("call-footprint.dataset.v1", '{"private":"do-not-load"}');
    storage.set("call-footprint.pages-demo.v1.dataset.v1", '{"private":"do-not-load"}');
    const bridge = await import("./bridge");
    const dataset = await bridge.loadDataset();
    expect(dataset?.source.kind).toBe("demo");
    expect(dataset?.contacts).toHaveLength(5);
    expect(JSON.stringify(dataset)).not.toContain("do-not-load");
    expect(bridge.isTauriRuntime()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cannot import, persist, delete private data or invoke a scan", async () => {
    vi.stubEnv("MODE", "pages-demo");
    const bridge = await import("./bridge");
    const dataset = (await bridge.loadDataset())!;
    const original = new Map(storage);
    expect(await bridge.chooseImportFile()).toBeNull();
    await bridge.saveDataset(dataset);
    await bridge.deleteDataset();
    expect(await bridge.exportJson("private.json", dataset)).toBeNull();
    await expect(bridge.scanWechatCalls()).rejects.toThrow();
    await expect(bridge.preflightMacSetup()).rejects.toThrow();
    await expect(bridge.initializeMacSetup("synthetic-account", true)).rejects.toThrow();
    await expect(bridge.scanMacSetup("synthetic-account")).rejects.toThrow();
    await expect(bridge.cancelMacSetup()).rejects.toThrow();
    expect(storage).toEqual(original);
    expect(invoke).not.toHaveBeenCalled();
    expect(await bridge.loadDataset()).toEqual(dataset);
  });

  it("keeps demo settings separate from desktop browser settings", async () => {
    vi.stubEnv("MODE", "pages-demo");
    const privateSettings = { ...DEFAULT_SETTINGS, lastContactId: "private-contact" };
    storage.set("call-footprint.settings.v1", JSON.stringify(privateSettings));
    const bridge = await import("./bridge");
    expect(await bridge.loadSettings()).toBeNull();
    await bridge.saveSettings(DEFAULT_SETTINGS);
    expect(await bridge.loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(storage.get("call-footprint.settings.v1")!)).toEqual(privateSettings);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still starts with synthetic data if optional storage is corrupt or unavailable", async () => {
    vi.stubEnv("MODE", "pages-demo");
    storage.set("call-footprint.pages-demo.v1.settings.v1", "broken-json");
    const bridge = await import("./bridge");
    expect(await bridge.loadSettings()).toBeNull();
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); }
    });
    expect(await bridge.loadSettings()).toBeNull();
    await expect(bridge.saveSettings(DEFAULT_SETTINGS)).resolves.toBeUndefined();
    expect((await bridge.loadDataset())?.source.kind).toBe("demo");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps multi-account demo records session-only and blocks collection export", async () => {
    vi.stubEnv("MODE", "pages-demo");
    storage.set("call-footprint.dataset.v1", '{"private":"do-not-load"}');
    const bridge = await import("./bridge");
    const collection = (await bridge.loadAccountCollection())!;
    expect(collection.datasets).toHaveLength(2);
    expect(JSON.stringify(collection)).not.toContain("do-not-load");
    const original = new Map(storage);
    await bridge.saveAccountCollection(collection);
    expect(await bridge.exportAccountCollection("accounts.json", collection)).toBeNull();
    expect(storage).toEqual(original);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("migrates native legacy data in memory and saves a full collection atomically", async () => {
    vi.stubEnv("MODE", "production");
    const { createDemoDataset } = await import("@/demo/dataset");
    const original = createDemoDataset();
    invoke.mockResolvedValueOnce(JSON.stringify(original));
    const bridge = await import("./bridge");
    const collection = (await bridge.loadAccountCollection())!;
    expect(collection.datasets).toEqual([original]);
    expect(invoke).toHaveBeenCalledTimes(1);
    await bridge.saveAccountCollection(collection);
    expect(invoke).toHaveBeenLastCalledWith("save_dataset", { content: JSON.stringify(collection) });
    invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(bridge.saveAccountCollection(collection)).rejects.toThrow("disk full");
    expect(collection.datasets).toEqual([original]);
  });

  it("does not seed synthetic data in the desktop build", async () => {
    vi.stubEnv("MODE", "production");
    invoke.mockResolvedValueOnce(null);
    const bridge = await import("./bridge");
    expect(bridge.isTauriRuntime()).toBe(true);
    expect(await bridge.loadDataset()).toBeNull();
    expect(invoke).toHaveBeenCalledWith("load_dataset");
  });
});
