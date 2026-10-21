import { describe, expect, it } from "vitest";
import { downloadHash, downloadReleases } from "./downloads";

const releasesUrl = "https://github.com/star5025/wechat-call-footprint-demo/releases";

describe("download release metadata", () => {
  it("uses a Pages-safe hash without adding a server path", () => {
    expect(downloadHash).toBe("#/download");
    const page = new URL(downloadHash, "https://star5025.github.io/wechat-call-footprint-demo/");
    expect(page.pathname).toBe("/wechat-call-footprint-demo/");
    expect(page.hash).toBe("#/download");
  });

  it("offers only the published Windows installers at the fixed stable tag", () => {
    const windows = downloadReleases[0];
    expect(windows.os).toBe("windows");
    expect(windows.version).toBe("v0.5.1");
    expect(windows.compatibility).toBe("Windows 10 / 11 · x64");
    expect(windows.preview).toBe(false);
    expect(windows.installers.map((installer) => installer.url)).toEqual([
      `${releasesUrl}/download/v0.5.1/Call-Footprint-v0.5.1-x64-setup.exe`,
      `${releasesUrl}/download/v0.5.1/Call-Footprint-v0.5.1-portable.exe`
    ]);
    expect(windows.notices.join(" ")).toContain("不含后续主题和动效更新");
  });

  it("pins both Mac architectures to the validated preview source, not latest", () => {
    const mac = downloadReleases[1];
    expect(mac.os).toBe("macos");
    expect(mac.preview).toBe(true);
    expect(mac.sourceCommit).toBe("91d2d93");
    expect(mac.installers.map((installer) => installer.url)).toEqual([
      `${releasesUrl}/download/v0.5.1-macos-preview.1/Call-Footprint-v0.5.1-macos-arm64.dmg`,
      `${releasesUrl}/download/v0.5.1-macos-preview.1/Call-Footprint-v0.5.1-macos-x64.dmg`
    ]);
    const notice = mac.notices.join(" ");
    for (const warning of ["未经签名", "Apple 公证", "真实 Mac", "WeChat 4.1.13", "arm64", "Apple 开发工具", "并非一键读取", "Intel", "已有密钥", "不支持初始化"]) {
      expect(notice).toContain(warning);
    }
  });

  it("links release-specific notes without checksum entries or invented Linux installers", () => {
    expect(downloadReleases.map((release) => release.os)).toEqual(["windows", "macos"]);
    for (const [index, tag] of ["v0.5.1", "v0.5.1-macos-preview.1"].entries()) {
      const release = downloadReleases[index];
      expect(release.releaseNotesUrl).toBe(`${releasesUrl}/tag/${tag}`);
      expect(release).not.toHaveProperty("checksumUrl");
      for (const installer of release.installers) {
        const url = new URL(installer.url);
        expect(url.protocol).toBe("https:");
        expect(url.hostname).toBe("github.com");
        expect(url.pathname).toContain(`/releases/download/${tag}/`);
        expect(url.search).toBe("");
      }
    }
  });
});
