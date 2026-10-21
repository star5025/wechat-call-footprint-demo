export const downloadHash = "#/download";

const releasesUrl = "https://github.com/star5025/wechat-call-footprint-demo/releases";
const windowsTag = "v0.5.1";
const macosTag = "v0.5.1-macos-preview.1";

export const downloadReleases = [
  {
    os: "windows",
    name: "Windows",
    compatibility: "Windows 10 / 11 · x64",
    version: windowsTag,
    preview: false,
    releaseNotesUrl: `${releasesUrl}/tag/${windowsTag}`,
    notices: ["此版本不含后续主题和动效更新。"],
    installers: [
      {
        label: "下载安装版",
        description: "常规安装，推荐使用",
        url: `${releasesUrl}/download/${windowsTag}/Call-Footprint-v0.5.1-x64-setup.exe`
      },
      {
        label: "下载便携版",
        description: "无需安装，直接运行",
        url: `${releasesUrl}/download/${windowsTag}/Call-Footprint-v0.5.1-portable.exe`
      }
    ]
  },
  {
    os: "macos",
    name: "macOS",
    compatibility: "Apple Silicon / Intel",
    version: "v0.5.1 · preview.1",
    preview: true,
    sourceCommit: "91d2d93",
    releaseNotesUrl: `${releasesUrl}/tag/${macosTag}`,
    notices: [
      "测试版未经签名或 Apple 公证，尚未在真实 Mac 上验证；系统可能阻止打开。",
      "微信读取仅面向 WeChat 4.1.13。仅 Apple Silicon（arm64）支持初始化，且需要 Apple 开发工具，并非一键读取。",
      "Intel 版仅支持导入 JSON 或使用已有密钥，不支持初始化。"
    ],
    installers: [
      {
        label: "下载 Apple Silicon 版",
        description: "M 系列芯片 · arm64 · DMG",
        url: `${releasesUrl}/download/${macosTag}/Call-Footprint-v0.5.1-macos-arm64.dmg`
      },
      {
        label: "下载 Intel 版",
        description: "Intel 芯片 · x64 · DMG",
        url: `${releasesUrl}/download/${macosTag}/Call-Footprint-v0.5.1-macos-x64.dmg`
      }
    ]
  }
] as const;
