# 前后端 API 契约

> 状态：Pre-Tauri Baseline
> Transport：Tauri 2 typed command + event
> Wire contract：`contracts/v1/models.ts`

## 1. 边界

React WebView 被视为低信任展示层。所有文件、数据库、进程、密钥与系统凭据操作必须由 Rust Core 或隔离 Worker 完成。

前端只能提交：

- 应用生成的 `sourceId`、`accountId`、`contactId`；
- 日期范围、筛选条件和分页游标；
- 用户明确选择的高层操作。

前端不得提交：

- 任意 SQL；
- 任意本地路径；
- PID、内存地址或读取长度；
- 数据库密钥；
- 动态库或可执行文件路径；
- 更新服务器 URL。

## 2. 响应封装

成功响应：

```ts
ContractEnvelope<T> = {
  contractVersion: "1.0"
  requestId: string
  dataRevision: string
  generatedAt: RFC3339DateTime
  data: T
  warnings: ApiWarning[]
}
```

失败响应统一为 `ApiError`。用户文案使用 `message` 和 `actions`，技术详情不直接展示。

## 3. Command 清单

### 3.1 数据源

#### `source_list()`

返回用户已授权的数据源，不自动扫描全盘。

```ts
ContractEnvelope<DataSource[]>
```

#### `source_choose(kind)`

打开系统文件/目录选择器。前端只能传来源类型：

```ts
type SourceChoiceKind = "normalized_file" | "decrypted_database" | "offline_backup"
```

Rust 返回授权后的 `DataSource`，不返回可被前端任意拼接的原始路径。

#### `source_remove(sourceId)`

删除应用对来源的登记和派生索引，不删除微信原文件。

### 3.2 扫描

#### `scan_start(sourceId, mode)`

```ts
type ScanMode = "full" | "incremental"
```

返回：

```ts
ContractEnvelope<{ scanId: string }>
```

#### `scan_status(scanId)`

返回 `ScanProgress`。

#### `scan_cancel(scanId)`

幂等取消。已经结束的任务返回当前终态，不报内部错误。

#### `scan_progress` Event

后端以受限频率发送 `ScanProgress`。前端断线后必须能通过 `scan_status` 恢复状态，不能只依赖 event。

### 3.3 账号与联系人

#### `account_list()`

返回账号展示信息和数据覆盖摘要。

#### `contact_list(accountId, query, cursor, limit)`

- `limit` 默认 50，最大 200；
- `query` 最大 120 字符；
- 返回不透明 cursor。

#### `contact_get(contactId)`

返回联系人和摘要，不默认返回全部事件。

#### `contact_merge(primaryId, secondaryIds)`

写入应用 correction overlay，可撤销，不修改微信。

#### `contact_unmerge(correctionId)`

撤销联系人合并并触发受影响聚合重算。

### 3.4 通话与聚合

#### `call_summary(filter)`

返回：

```ts
ContractEnvelope<{
  summary: CallSummary
  quality: DataQuality
}>
```

#### `call_list(request)`

返回 `CallListResult`。分页必须使用 cursor，避免使用在增量更新下不稳定的 offset。

#### `call_get(eventId)`

返回单个 `CallEvent` 和适合普通用户展示的来源摘要。原始 lineage 只进入高级诊断。

#### `contribution_wall(request)`

返回 `ContributionWallResult`。

约束：

- 最大范围 366 天；
- 所有日历日都必须返回一个 `ContributionDay`；
- 缺失覆盖不能省略该日期；
- 日总时长之和必须与同范围摘要一致；
- 默认不返回未来日期；UI 自行渲染未来格。

#### `insight_list(filter)`

返回固定模板的描述性发现。每条发现必须包含：

- 事实文本；
- 指标值和分母；
- 日期范围；
- 质量状态；
- 组成事件或查询条件；
- 方法版本。

MVP 可暂不实现。

### 3.5 本地数据与隐私

#### `privacy_status()`

返回网络开关、遥测开关、本地数据清单和最近清理状态。

#### `local_data_delete(scope)`

```ts
type DeleteScope = "cache" | "index" | "corrections" | "logs" | "all_generated_data"
```

永远不允许删除微信原始来源。

#### `diagnostics_export(options)`

默认脱敏；调用前返回预览清单，由用户二次确认。

## 4. 请求校验

Rust Command 层在进入业务逻辑前完成：

- 契约版本检查；
- 字符串长度和枚举检查；
- 日期格式、范围顺序和最大跨度；
- ID 是否属于当前授权会话；
- cursor 签名与过期检查；
- 分页上限；
- 操作是否允许在当前扫描状态执行。

路径必须由 Rust 根据内部 source registry 解析并 canonicalize。任何来自 WebView 的字符串都不能直接用于文件打开或 SQL 拼接。

## 5. 错误处理

### 用户可恢复错误

| ErrorCode | 默认操作 |
|---|---|
| `SOURCE_ACCESS_DENIED` | `reauthorize`, `choose_source` |
| `SOURCE_BUSY` | `retry`, `close_wechat_and_retry` |
| `SNAPSHOT_INCONSISTENT` | `retry`, `import_offline_copy` |
| `UNSUPPORTED_SOURCE` | `import_offline_copy`, `export_diagnostics` |
| `STORAGE_FULL` | 清理缓存或更改位置 |
| `OPERATION_CANCELLED` | 返回安全状态，不显示红色故障页 |

### Fail Closed 错误

以下情况不得生成“看起来合理”的部分统计：

- 密钥验证失败；
- Schema 无可靠匹配；
- 快照一致性检查失败；
- 数据库损坏；
- 契约 major 不支持。

若只有某个分片失败，可返回 Partial，但必须标出覆盖范围和受影响指标。

## 6. 并发与幂等

- 同一 source 同时只允许一个写索引的扫描；
- 查询可读取上一个稳定索引；
- 新扫描在事务完成前不替换稳定索引；
- `scan_cancel`、`source_remove` 和清理命令幂等；
- Command 使用 `requestId` 关联日志；
- 前端重试不得导致重复导入或重复 correction。

## 7. Demo 与 Native 数据源

前端只依赖统一接口：

```ts
interface CallDataSource {
  listContacts(...): Promise<Contact[]>
  getSummary(...): Promise<CallSummary>
  listCalls(...): Promise<CallListResult>
  getContributionWall(...): Promise<ContributionWallResult>
  listInsights(...): Promise<Insight[]>
}
```

实现：

```text
DemoCallDataSource      开发、截图和视觉回归
TauriCallDataSource     正式 IPC
```

页面不得通过环境判断散落不同逻辑，只在应用组合根选择实现。

## 8. 安全日志约束

允许记录：

- requestId；
- command 名；
- 阶段、耗时和非敏感计数；
- ErrorCode；
- 适配器 ID 与版本。

禁止记录：

- 密钥和候选密钥；
- 聊天正文；
- 联系人真实名称；
- 完整原始路径；
- 原始记录内容；
- Tauri IPC 的完整敏感 payload。

## 9. 首条纵向链路

正式工程第一条真实链路固定为：

```text
用户选择已解密数据库
→ Rust 登记 DataSource
→ Worker 只读探测 Schema
→ 解析 CallEvent
→ 写入临时/本地索引
→ contact_list
→ call_list
→ contribution_wall
→ UI 显示真实记录与时光墙
```

此链路跑通前，不开始自动内存读取、增量扫描或高级洞察。
