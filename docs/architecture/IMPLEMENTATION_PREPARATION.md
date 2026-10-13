# 正式工程前期准备

## 1. 目标目录结构

当前根目录是 v0.3 静态视觉原型。迁移正式工程时建议保留 `prototype/` 快照，并采用：

```text
apps/
  desktop/
    src/
      app/                 路由、组合根、全局状态
      components/          Button、Card、Sheet、Tabs、状态组件
      features/
        home/
        contribution-wall/
        insights/
        calls/
        contacts/
        settings/
      data/
        CallDataSource.ts
        DemoCallDataSource.ts
        TauriCallDataSource.ts
      design/
        tokens.css
      test/
    src-tauri/
      src/
        commands/          Tauri command broker
        services/          应用服务
        security/          路径、授权、密钥包装
        store/             本地索引
      capabilities/
crates/
  domain/                  Rust canonical types
  contract/                serde DTO 与 v1 映射
  adapter-api/             Source/Codec/Schema/Parser traits
  acquisition-worker/      隔离 Worker
  index-store/             加密索引、迁移和修正层
contracts/
  v1/
docs/
fixtures/
  synthetic/               可公开合成数据
  private/                 不进入 Git 的授权真实样本
scripts/
```

## 2. 技术基线

- Tauri 2；
- React + TypeScript；
- Vite；
- Rust stable，并提交 `rust-toolchain.toml`；
- 前端包管理器在迁移时选择并锁定，提交 lockfile；
- JSON Schema 2020-12；
- 日期计算优先使用 Temporal polyfill 或受控日期库，禁止散落手写时区逻辑；
- 图表优先保留 DOM/CSS 可访问实现，复杂图表再评估 ECharts。

## 3. 设计系统准备

将 v0.3 CSS 提取为：

- color tokens；
- typography tokens；
- spacing tokens；
- radius 与 elevation；
- motion durations；
- focus ring；
- contribution wall levels；
- coverage 与 quality patterns。

首批公共组件：

- `AppShell`；
- `PillNavigation`；
- `StoryCard`；
- `MetricCard`；
- `Sheet`；
- `SegmentedControl`；
- `ContributionGrid`；
- `CallListItem`；
- `EmptyState`；
- `PartialDataNotice`；
- `ErrorActionPanel`；
- `ScanProgress`。

## 4. 本地存储准备

应用私有数据库分层：

```text
source_registry       数据源、账号、版本、指纹和扫描历史
canonical_events      统一事件与 lineage
contact_identities    联系人身份与别名
correction_overlay    合并、排除、修正和撤销
aggregate_cache       可重建的日/周/月统计
schema_migrations     索引 Schema 版本
```

约束：

- 原始微信数据库不复制进长期索引；
- 聚合缓存可删除重建；
- correction overlay 独立于解析器结果；
- 存储迁移有备份、事务和失败恢复；
- Windows 使用用户范围 DPAPI 包装随机索引密钥；
- 临时明文与用户导出严格分开。

## 5. 版本支持准备

公开支持等级：

| 等级 | 行为 |
|---|---|
| Supported | 真实样本和自动回归通过，完整导入 |
| Preview | 有 Fixture 和有限实测，持续显示提示 |
| Import only | 只接受用户提供的已解密数据 |
| Research | 仅开发构建可用 |
| Unsupported | 明确拒绝，不尝试相似规则 |

每个适配器必须包含：

- adapter ID 和 SemVer；
- 平台与来源版本范围；
- Schema fingerprint；
- 支持能力；
- 已知限制；
- 对应 Fixture；
- 变更日志。

## 6. 安全准备

- Tauri capability 最小化；
- 生产环境禁用远程前端和 DevTools；
- CSP 不允许任意远程脚本；
- Worker 不接受任意 SQL、路径、动态库或 Shell；
- SQLite 只读、defensive、trusted schema off、禁扩展；
- Secret 类型禁止普通 Debug/Serialize；
- 日志脱敏测试；
- 正常退出、取消、崩溃和下次启动都执行临时文件清理；
- 自动更新使用 Tauri 签名 + Windows 代码签名；
- 依赖 lockfile、SBOM、许可和漏洞审计。

## 7. 首条纵向链路的完成定义

```text
选择已解密数据库
→ 探测并确认来源
→ 只读解析一个支持的 Fixture
→ 输出 v1 CallEvent
→ 写入临时索引
→ 联系人列表显示真实联系人
→ 记录页显示事件
→ 时光墙显示真实日期
→ 总时长与人工金标准一致
```

完成条件：

- 原始目录写入次数为 0；
- 16 次已接通、总时长等金标准精确一致；
- Unknown 和缺失覆盖能在 UI 中正确表达；
- 取消、损坏文件和不支持 Schema 有可恢复错误；
- 临时文件清理测试通过。

## 8. CI 准备

每次提交运行：

1. JSON 与 JSON Schema 语法检查；
2. TypeScript 类型检查；
3. Rust format、clippy、test；
4. 前端 lint、unit test 和 build；
5. Contract Fixture 校验；
6. 敏感信息扫描；
7. 许可证和依赖漏洞检查；
8. Windows 构建冒烟测试。

Release 额外运行：

- 真实脱敏 Fixture 回归；
- 安装、升级和卸载；
- 临时文件故障注入；
- Defender/SmartScreen 检查；
- updater 签名和防降级；
- SBOM 与 SHA-256 生成。

## 9. 尚需决策

正式工程初始化前只需确认：

1. 包管理器使用 pnpm 或 npm；
2. Windows 首发仅 x64，还是同时 ARM64；
3. 本地索引加密方案；
4. 首条真实链路支持的已解密数据库 Fixture；
5. 首发是否保持 Import-only；
6. 是否从第一版就拆分 Worker；
7. 最低 Windows 版本；
8. 应用正式名称与图标。
