# 通话足迹 · Call Footprint

一款完全在本机运行的个人微信通话元数据回顾应用。

当前版本：**v0.5.0（Windows 微信 4.1.15.13 自动扫描版）**

## 能做什么

- 通过首页快速查看总通话时长、接通次数、最长一次和最近记录；
- 使用类似 GitHub Contribution Graph 的“时光墙”，按一年、一个月或自定义范围回看；
- 查看通话日期、时间、类型、方向、结果和已接通时长；
- 显示描述性“小发现”，但不评价关系或推断情绪；
- 在明确授权后，只读扫描本机 Windows 微信 4.1.15.13 的联系人和通话元数据；
- 导入符合 Contract v1 的标准 JSON；
- 导出完整的本地通话数据 JSON；
- 将设置和导入数据保存在本机应用目录，可随时删除。

## 当前数据范围

应用首次启动不预载任何联系人或通话记录，而是展示首次使用引导。用户可主动扫描本机微信或导入 Contract v1 JSON；删除本地数据后也会回到这一空白状态。合成数据仅作为自动化测试 fixture，不进入生产运行路径。

v0.5.0 已接入首个严格版本化的 Windows 适配器，仅支持经过本机验证的微信 **4.1.15.13**。扫描前会明确说明并征得同意；后端只以 `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ` 权限读取微信进程，不注入、不挂钩、不写回微信。数据库和 WAL 先复制为一致快照，再逐页认证、临时解密并只读解析；密钥不落盘、不进入前端，临时副本正常结束后删除。未知微信版本会拒绝自动读取，可继续使用 Contract v1 JSON 导入。

macOS 适配器正在开发，界面和 Contract v1 与 Windows 版保持一致。当前已支持微信 **4.1.13** 的应用版本识别、沙盒数据目录发现、多账号活跃度判断和 `key_info.db` 只读元数据验证；数据库密钥解锁与端到端解析尚未完成，因此暂不作为正式可用版本发布。

## Windows 安装

发布目录包含：

- `通话足迹_0.5.0_x64-setup.exe`：推荐，当前用户安装；
- `通话足迹.exe`：便携运行文件；
- `使用说明.txt`：简要说明与隐私边界。

应用尚未购买代码签名证书，Windows SmartScreen 可能显示“未知发布者”。这是签名状态提示，不代表应用会上传数据。

## 本地开发

### 环境

- Windows 10/11 x64，或 macOS 12+（Apple Silicon）；
- Node.js 20+；
- Rust stable；
- Windows：Visual Studio 2022 Build Tools 和 Microsoft Edge WebView2 Runtime；
- macOS：Xcode Command Line Tools。

### 命令

```shell
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

```shell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 工程结构

```text
src/                    React + TypeScript 桌面 UI
src/data/               数据聚合、导入校验和测试 fixture
src/native/             Tauri IPC / 浏览器预览桥接层
src-tauri/              Rust 本地能力与 Windows/macOS 打包配置
contracts/v1/           稳定的领域类型、JSON Schema 和示例
docs/                   产品、架构、隐私和测试基线
prototype/v0.3/         已确认视觉方向的静态原型快照
scripts/                Contract 校验脚本
```

## 隐私边界

- 核心功能默认离线；
- 解析器只筛选通话气泡；聊天正文不会进入规范化结果或持久化文件；
- 不修改微信原始数据库，不注入或挂钩微信进程；
- 不上传联系人、通话记录、文件或密钥；
- 自动扫描需要用户明确确认，密钥只在进程内存短暂使用；
- 规范化联系人与通话元数据当前以未加密 JSON 保存在本机应用目录，可随时删除；
- 导入和导出均由用户主动选择文件；
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
