# ADR-001：Local-first 分层架构与隔离采集 Worker

- 状态：Accepted
- 日期：2026-10-13
- 决策人：项目维护者

## 背景

产品需要读取用户本机数据、解析不可信 SQLite、生成统计并以轻量 UI 展示。微信版本、数据库布局和权限方式可能变化；UI 仍需持续快速迭代。

如果 UI 直接读取数据库，或把微信原始字段泄漏到页面，将造成：

- UI 与特定微信版本耦合；
- WebView 获得过高系统权限；
- 解析错误影响整个桌面进程；
- 后续迁移和测试困难；
- 隐私边界无法被清楚审计。

## 决策

采用以下正式目标架构：

```text
React / TypeScript UI
  → versioned CallDataSource interface
  → Tauri command broker
  → Rust Core application services
  → isolated acquisition worker
  → compile-time source adapters
  → encrypted local analytics store
```

### 信任边界

- WebView：低信任展示层；
- Tauri Command Broker：参数校验和授权边界；
- Rust Core：业务编排和稳定领域模型；
- Worker：快照、解密、Schema 探测和解析不可信输入；
- Adapter：按平台和来源版本编译进应用；
- Store：只保存 canonical event、修正层和可重建聚合。

### 数据源策略

第一条真实链路使用用户主动选择的已解密数据库或规范化文件。自动发现、活动数据库快照和运行时密钥获取均延后到基础链路稳定之后。

### UI 数据源

长期保留两个实现：

- `DemoCallDataSource`：开发、截图、视觉回归和无隐私数据演示；
- `TauriCallDataSource`：正式 IPC。

UI 组件不感知当前使用哪个实现。

## 替代方案

### A. 继续扩展静态 HTML

优点：迭代快。
缺点：缺少类型、模块边界、原生能力和正式发布路径。
结论：仅作为视觉原型保留，不作为正式产品基础。

### B. Electron 单进程

优点：生态成熟、Node 能力丰富。
缺点：体积更大，敏感本地能力更容易泄漏到渲染层。
结论：不采用。

### C. Tauri 主进程内完成全部解析

优点：实现较少。
缺点：损坏数据库或解析器崩溃会影响 UI 主进程。
结论：早期 PoC 可暂时同进程，正式版必须迁移到 Worker。

### D. 动态原生适配器插件

优点：可单独更新兼容性。
缺点：插件与 Core 几乎同权限，供应链和签名复杂。
结论：MVP 不采用；适配器编译进应用。

## 后果

### 正面

- UI 可独立快速调整；
- 微信版本变化局限在 Adapter；
- 可对 Worker 设置资源限制；
- Demo 和真实数据共享页面；
- 数据契约可测试和版本化；
- 原始数据只读边界更容易审计。

### 代价

- 需要维护 TypeScript、Rust 和 JSON Schema 映射；
- Worker 协议和生命周期增加工程量；
- 数据迁移、兼容矩阵和 Fixture 必须持续维护；
- 端到端调试比单文件 Demo 更复杂。

## 强制约束

- WebView 不接收密钥、任意路径或原始 SQL；
- 不在微信源目录写入；
- 不加载远程原生代码；
- 未知 Schema 和未知枚举 fail closed；
- 所有统计可追溯到 canonical event；
- 聚合缓存可从事件重建；
- 联系人修正可撤销且不回写微信；
- 核心功能断网可用。

## 实施阶段

1. 固化产品骨架与 v1 契约；
2. 迁移 Tauri + React + TypeScript；
3. 建立 DemoDataSource 与契约测试；
4. 实现已解密数据库导入的纵向链路；
5. 引入隔离 Worker；
6. 实现 Windows 一致快照；
7. 安全评审后决定是否加入自动密钥能力。
