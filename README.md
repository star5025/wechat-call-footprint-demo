# 通话足迹 · Call Footprint

一款完全在本机运行的个人微信通话元数据回顾应用。

当前版本：**v0.4.0（首个 Windows 桌面工程版）**

## 能做什么

- 通过首页快速查看总通话时长、接通次数、最长一次和最近记录；
- 使用类似 GitHub Contribution Graph 的“时光墙”，按一年、一个月或自定义范围回看；
- 查看通话日期、时间、类型、方向、结果和已接通时长；
- 显示描述性“小发现”，但不评价关系或推断情绪；
- 一键隐藏联系人名称，便于投屏或分享画面；
- 导入符合 Contract v1 的标准 JSON；
- 导出完整私人 JSON 或脱敏 JSON；
- 将设置和导入数据保存在本机应用目录，可随时删除。

## 当前数据范围

应用首次启动使用一套完全合成的 Demo 数据，便于直接体验所有页面。

v0.4.0 支持用户主动导入规范化 JSON，但**暂未接入微信进程、加密数据库或自动密钥读取**。这一层将在桌面工程和数据契约稳定后以独立版本适配器实现，不会破坏当前 UI。

## Windows 安装

发布目录包含：

- `通话足迹_0.4.0_x64-setup.exe`：推荐，当前用户安装；
- `通话足迹.exe`：便携运行文件；
- `使用说明.txt`：简要说明与隐私边界。

应用尚未购买代码签名证书，Windows SmartScreen 可能显示“未知发布者”。这是签名状态提示，不代表应用会上传数据。

## 本地开发

### 环境

- Windows 10/11 x64；
- Node.js 20+；
- Rust stable（MSVC）；
- Visual Studio 2022 Build Tools，包含 Desktop development with C++；
- Microsoft Edge WebView2 Runtime。

### 命令

```powershell
npm ci
npm run check
npm run tauri:dev
npm run tauri:build
```

`npm run check` 会依次执行：

1. Contract JSON Schema 与示例校验；
2. TypeScript 类型检查；
3. Vitest 单元测试；
4. Vite 生产构建。

Rust 测试：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 工程结构

```text
src/                    React + TypeScript 桌面 UI
src/data/               Demo 数据、聚合、导入校验和脱敏导出
src/native/             Tauri IPC / 浏览器预览桥接层
src-tauri/              Rust 本地能力与 Windows 打包配置
contracts/v1/           稳定的领域类型、JSON Schema 和示例
docs/                   产品、架构、隐私和测试基线
prototype/v0.3/         已确认视觉方向的静态原型快照
scripts/                Contract 校验脚本
```

## 隐私边界

- 核心功能默认离线；
- 不读取或分析聊天正文；
- 不修改微信原始数据库；
- 不上传联系人、通话记录、文件或密钥；
- 导入和导出均由用户主动选择文件；
- 脱敏导出会移除联系人名称、别名、头像引用和来源记录哈希；
- 不根据通话频率评价关系或推断情绪。

## 产品与架构文档

- [产品骨架与体验基线](docs/product/PRODUCT_SKELETON.md)
- [领域模型与数据契约](docs/architecture/DATA_CONTRACTS.md)
- [前后端 API 契约](docs/architecture/API_CONTRACT.md)
- [正式工程前期准备](docs/architecture/IMPLEMENTATION_PREPARATION.md)
- [Local-first 分层架构 ADR](docs/architecture/ADR-001-LOCAL-FIRST-LAYERED-ARCHITECTURE.md)
- [质量感知与 Unknown ADR](docs/architecture/ADR-002-QUALITY-AWARE-UNKNOWN-VALUES.md)
- [测试策略](docs/testing/TEST_STRATEGY.md)
- [开发路线图](ROADMAP.md)

## 版本说明

详见 [CHANGELOG.md](CHANGELOG.md)。
