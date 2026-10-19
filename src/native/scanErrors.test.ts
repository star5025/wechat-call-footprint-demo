import { describe, expect, it } from "vitest";
import { scanErrorMessage } from "./scanErrors";

describe("scan error messages", () => {
  it("distinguishes known macOS failures", () => {
    expect(scanErrorMessage("MACOS_MANIFEST_REQUIRED")).toBe("请先初始化密钥");
    expect(scanErrorMessage(new Error("MACOS_PERMISSION_DENIED"))).toBe("请检查访问权限");
    expect(scanErrorMessage("MACOS_VERSION_UNSUPPORTED")).toBe("微信版本不支持");
    expect(scanErrorMessage("[MACOS_DATA_PERMISSION] private path")).toBe("请检查访问权限");
    expect(scanErrorMessage("[MACOS_MANIFEST_AUTH] private key")).toBe("密钥验证失败");
    expect(scanErrorMessage("[MACOS_METADATA_SCHEMA] private schema")).toBe("密钥状态检查失败");
    expect(scanErrorMessage("[MACOS_APP_MISSING] private path")).toBe("未找到微信");
  });

  it("never displays raw private error detail", () => {
    expect(scanErrorMessage("MACOS_KEY_INVALID: /Users/private/secret-key.json")).toBe("密钥验证失败");
    for (const error of ["/Users/private/account.db", null, {}, new Error("private material")]) {
      expect(scanErrorMessage(error)).toBe("读取失败，请重试");
    }
  });
});
