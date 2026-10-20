import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAC_RECOVERY_GUIDANCE, macSetupAvailability, macSetupInitializationIssue, macSetupIssue, macSetupProgress,
  macSetupVersion, selectMacSetupAccount, type MacSetupStatus
} from "./macSetup";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

function status(overrides: Partial<MacSetupStatus> = {}): MacSetupStatus {
  return {
    accounts: [{ id: "opaque-a", label: "账号 1", keyReady: false }, { id: "opaque-b", label: "账号 2", keyReady: true }],
    wechatVersion: "4.1.13", canInitialize: true, blocker: null, recoveryRequired: false,
    ...overrides
  };
}

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  listen.mockReset();
  vi.stubEnv("MODE", "production");
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Mac setup status decisions", () => {
  it("requires a valid selected account, with initialization and reading mutually exclusive", () => {
    expect(macSetupAvailability(null, "opaque-a")).toMatchObject({ canRead: false, canInitialize: false });
    expect(macSetupAvailability(status(), "missing")).toMatchObject({ canRead: false, canInitialize: false });
    expect(macSetupAvailability(status(), "opaque-a")).toMatchObject({ canRead: false, canInitialize: true });
    expect(macSetupAvailability(status(), "opaque-b")).toMatchObject({ canRead: true, canInitialize: false });
    expect(macSetupAvailability(status({ accounts: [] }), "opaque-a").canInitialize).toBe(false);
  });

  it("blocks both operations during recovery even for a ready key", () => {
    for (const id of ["opaque-a", "opaque-b"]) {
      expect(macSetupAvailability(status({ recoveryRequired: true }), id)).toMatchObject({
        canRead: false, canInitialize: false, recoveryRequired: true
      });
    }
  });

  it("keeps ready-key reads available despite an initialization blocker", () => {
    const blocked = status({ canInitialize: false, blocker: "MACOS_SETUP_WECHAT_RUNNING" });
    expect(macSetupAvailability(blocked, "opaque-b").canRead).toBe(true);
    expect(macSetupAvailability(blocked, "opaque-a").canInitialize).toBe(false);
    expect(macSetupAvailability(status({ blocker: "unknown" }), "opaque-a").canInitialize).toBe(false);
  });

  it("retains selection only when it still belongs to the current check", () => {
    expect(selectMacSetupAccount(status(), "opaque-b")).toBe("opaque-b");
    expect(selectMacSetupAccount(status(), "obsolete")).toBe("opaque-a");
    expect(selectMacSetupAccount(status({ accounts: [] }), "opaque-b")).toBe("");
  });

  it("never exposes unknown native errors, paths, key values, or version diagnostics", () => {
    const secret = "/Users/private/keys.json key=abcdef";
    for (const error of [secret, new Error(secret), { message: secret }, null, `MACOS_UNKNOWN: ${secret}`]) {
      const issue = macSetupIssue(error);
      expect(issue.message).not.toContain(secret);
      expect(issue.recoveryRequired).toBe(false);
    }
    expect(macSetupIssue(`[MACOS_MANIFEST_AUTH] ${secret}`).message).toBe("密钥验证失败");
    expect(macSetupVersion(secret)).toBe("未确认");
    expect(macSetupVersion("4.1.13")).toBe("4.1.13");
  });

  it("treats failed cleanup and recovery as blocking, not successful cancellation", () => {
    for (const code of ["MACOS_SETUP_CLEANUP_FAILED", "MACOS_SETUP_RECOVERY_REQUIRED", "MACOS_RECOVERY_REQUIRED"]) {
      expect(macSetupIssue(`[${code}] private detail`)).toEqual({ message: MAC_RECOVERY_GUIDANCE, recoveryRequired: true });
    }
    expect(macSetupIssue("MACOS_SETUP_CANCELLED")).toEqual({ message: "操作已取消，原有通话记录未改变。", recoveryRequired: false });
  });

  it("preserves initialization failure/recovery returned as status even when a key is already ready", () => {
    const ready = status({ accounts: [{ id: "opaque-a", label: "账号 1", keyReady: true }] });
    expect(macSetupInitializationIssue(ready)).toBeNull();
    expect(macSetupInitializationIssue({ ...ready, blocker: "[MACOS_INITIALIZE_FAILED] private detail" })?.message).toContain("初始化未完成");
    expect(macSetupInitializationIssue({ ...ready, blocker: "[MACOS_CANCELLED] private detail" })?.message).toContain("操作已取消");
    expect(macSetupInitializationIssue({ ...ready, recoveryRequired: true })).toEqual({ message: MAC_RECOVERY_GUIDANCE, recoveryRequired: true });
  });

  it("gives fixed actionable advice for actual native dependency blockers", () => {
    const cases = {
      MACOS_NATIVE_ARM64_REQUIRED: "Apple Silicon", MACOS_DEVELOPER_MODE_REQUIRED: "开发者模式",
      MACOS_LLDB_REQUIRED: "Xcode", MACOS_PYTHON_LLDB_REQUIRED: "Python", MACOS_WECHAT_MUST_QUIT: "正常退出",
      MACOS_PROCESS_CHECK_FAILED: "微信状态", MACOS_ACK_REQUIRED: "勾选", MACOS_HELPER_MISSING: "重新安装",
      MACOS_STATE_SECURITY: "访问权限", MACOS_ACCOUNT_INVALID: "重新选择"
    };
    for (const [code, advice] of Object.entries(cases)) {
      const issue = macSetupIssue(`[${code}] /Users/private/secret`);
      expect(issue.message).toContain(advice);
      expect(issue.message).not.toContain("/Users/");
    }
  });

  it("clamps progress and replaces all native diagnostic text", () => {
    const progress = { stage: "/Users/private", detail: "secret key", percent: 125 };
    expect(macSetupProgress(progress, "initialize")).toMatchObject({ stage: "正在初始化", percent: 100 });
    expect(JSON.stringify(macSetupProgress(progress, "scan"))).not.toMatch(/private|secret/);
    expect(macSetupProgress({ ...progress, percent: -1 }, "scan").percent).toBe(0);
    expect(macSetupProgress({ ...progress, percent: NaN }, "scan").percent).toBe(0);
    expect(macSetupProgress({ ...progress, stage: "cancelling" }, "initialize").stage).toBe("正在清理");
  });
});

describe("Mac setup native bridge", () => {
  it("rejects every privileged API in a regular browser without invoking or listening", async () => {
    vi.stubGlobal("window", {});
    const bridge = await import("./native/bridge");
    await expect(bridge.preflightMacSetup()).rejects.toThrow("MACOS_SETUP_NATIVE_REQUIRED");
    await expect(bridge.initializeMacSetup("opaque-a", true, vi.fn())).rejects.toThrow("MACOS_SETUP_NATIVE_REQUIRED");
    await expect(bridge.scanMacSetup("opaque-a", vi.fn())).rejects.toThrow("MACOS_SETUP_NATIVE_REQUIRED");
    await expect(bridge.cancelMacSetup()).rejects.toThrow("MACOS_SETUP_NATIVE_REQUIRED");
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it("uses the agreed opaque-ID commands and never automatically scans after initialization", async () => {
    const bridge = await import("./native/bridge");
    invoke.mockResolvedValue(status());
    await expect(bridge.preflightMacSetup()).resolves.toEqual(status());
    await expect(bridge.initializeMacSetup("opaque-a", true)).resolves.toEqual(status());
    expect(invoke.mock.calls).toEqual([
      ["mac_setup_check"],
      ["mac_setup_initialize", { accountId: "opaque-a", acknowledged: true }]
    ]);
    expect(listen).not.toHaveBeenCalled();
  });

  it("subscribes before initialization and always removes its listener on rejection", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    invoke.mockRejectedValue("MACOS_SETUP_CLEANUP_FAILED");
    const bridge = await import("./native/bridge");
    const onProgress = vi.fn();
    await expect(bridge.initializeMacSetup("opaque-b", false, onProgress)).rejects.toBe("MACOS_SETUP_CLEANUP_FAILED");
    expect(listen).toHaveBeenCalledWith("mac-setup-progress", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("mac_setup_initialize", { accountId: "opaque-b", acknowledged: false });
    expect(listen.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
    listen.mock.calls[0][1]({ payload: { stage: "check", detail: "", percent: 10 } });
    expect(onProgress).toHaveBeenCalledWith({ stage: "check", detail: "", percent: 10 });
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("does not settle a scan or remove its listener just because cancellation was requested", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    let rejectScan!: (reason: string) => void;
    const nativeScan = new Promise((_, reject) => { rejectScan = reject; });
    invoke.mockImplementation((command: string) => command === "mac_setup_scan" ? nativeScan : Promise.resolve());
    const bridge = await import("./native/bridge");
    const operation = bridge.scanMacSetup("opaque-b", vi.fn());
    const rejected = expect(operation).rejects.toBe("MACOS_SETUP_CANCELLED");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("mac_setup_scan", { accountId: "opaque-b" }));
    await bridge.cancelMacSetup();
    expect(invoke).toHaveBeenCalledWith("mac_setup_cancel");
    expect(unlisten).not.toHaveBeenCalled();
    rejectScan("MACOS_SETUP_CANCELLED");
    await rejected;
    expect(listen).toHaveBeenCalledWith("wechat-scan-progress", expect.any(Function));
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("never invokes the native operation if subscribing to progress fails", async () => {
    listen.mockRejectedValue(new Error("no event listener"));
    const bridge = await import("./native/bridge");
    await expect(bridge.initializeMacSetup("opaque-a", true, vi.fn())).rejects.toThrow("no event listener");
    expect(invoke).not.toHaveBeenCalled();
  });
});
