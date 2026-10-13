# 数据契约与领域模型

> 状态：Phase 2 Baseline
> 契约版本：1.0
> 实现来源：`contracts/v1/models.ts` 与 `contracts/v1/schemas/`

## 1. 目标

数据契约隔离 UI、Rust Core、微信版本适配器和本地索引。UI 只能依赖产品领域模型，不得依赖微信原始表名、字段或 XML 内容。

```text
微信/导入源
  → 平台与版本适配器
  → Canonical CallEvent
  → 本地索引与聚合
  → Versioned DTO
  → React UI
```

### 契约原则

1. **显式未知**：不知道就使用 `unknown` 或 `null`，不猜测。
2. **零不是未知**：`0` 表示可靠的零值，`null` 表示没有可靠值。
3. **来源可追溯**：每个 canonical event 都保留 lineage。
4. **质量随数据同行**：聚合结果必须包含 coverage 和 quality。
5. **ID 不透明**：UI 不解析 ID，不显示数据库主键或微信内部 ID。
6. **时间不丢信息**：事件使用 RFC 3339 偏移时间，同时保留 IANA timezone 与 offset。
7. **契约可版本化**：跨 IPC 的根对象携带 `contractVersion`。
8. **契约最小化**：密钥、原始 SQL、任意本地路径不进入前端 DTO。

## 2. 核心实体

### 2.1 CallEvent

一次规范化的通话尝试。它可以是已接通、未接、取消或未知结果。

关键字段：

- `startedAt`：来源能证明的开始时间；
- `connectedDurationSeconds`：实际接通时长，不是响铃时长；
- `mediaType`：语音、视频或未知；
- `direction`：呼入、呼出或未知；
- `outcome`：统一结果枚举；
- `qualityFlags`：影响使用方式的质量标志；
- `lineage`：来源、适配器、解析器和去重版本。

#### 不变量

- `connectedDurationSeconds` 不得小于 0；
- `outcome` 为 `missed`、`cancelled_*`、`rejected` 或 `busy` 时，时长通常为 `0` 或 `null`；
- `connectedDurationSeconds > 0` 时事件属于“可计时集合”；
- `excluded=true` 的事件默认不进入聚合，但仍保留用于审计和恢复；
- `contactId=null` 时必须包含 `unknown_contact`；
- 任意 inferred 值都必须有对应 confidence 或 quality flag。

### 2.2 Contact

应用层联系人身份。它不是微信原始联系人行的直接镜像。

- 支持别名；
- 支持多个原始身份可撤销地合并；
- 同名不能自动合并；
- `displayName` 是用户可理解名称，不是内部 ID；
- 联系人修正写入 overlay，不回写微信数据库。

### 2.3 ContributionDay

时光墙的最小日粒度聚合。

必须包含：

- 总尝试次数；
- 接通次数；
- 总接通时长；
- 语音、视频和未知类型计数；
- 当天数据覆盖状态；
- 影响当天统计的质量标志。

时光墙颜色不能仅根据 `durationSeconds` 绘制，还要用纹理、边框或说明区分：

- 完整覆盖且零事件；
- 部分覆盖；
- 缺失覆盖；
- 解析失败；
- 未来日期。

### 2.4 CallSummary

聚合结果同时保留三个分母：

- `attemptedCount`：所有通话尝试；
- `connectedCount`：可靠地显示已接通；
- `timedCount`：具有可靠时长。

`meanDurationSeconds`、`medianDurationSeconds` 和最长时长只针对可计时集合。

### 2.5 DataQuality

质量不是一个无法解释的总分，而是六个维度：

- 来源覆盖；
- 字段完备；
- 时间连续性；
- 结构一致性；
- 身份确定性；
- 去重确定性。

`score=null` 表示无法测量，不能按满分处理。

## 3. 时间模型

### 时间点

使用带偏移的 RFC 3339：

```text
2026-10-07T00:43:31+08:00
```

同时保留：

- `timezone: "Asia/Shanghai"`；
- `utcOffsetMinutes: 480`。

### 日期范围

日期范围为闭区间：

```text
startDate <= date <= endDate
```

所有按日、周、月聚合都使用请求中的 `timezone` 重新分桶。跨午夜通话按与每个日历日的真实重叠秒数分配；事件总时长与日聚合总和必须一致。

### 时间缺失

- 时间完全未知：`startedAt=null`；
- 只有结束时间：保留能证明的字段，不反推开始时间；
- 时区未知：保留原始可解释时间，增加 `unknown_timezone`，禁止精确时段洞察。

## 4. Unknown、Null 与 Empty

| 表达 | 含义 | 示例 |
|---|---|---|
| `unknown` | 枚举字段存在但语义无法确定 | `direction: "unknown"` |
| `null` | 可选数值/时间没有可靠来源 | `answeredAt: null` |
| `[]` | 已知集合为空 | `qualityFlags: []` |
| `0` | 可靠的零 | `durationSeconds: 0` |
| 缺少属性 | 只允许在明确 optional 字段 | `sourcePartition` |

序列化时不得通过移除 required 属性掩盖未知状态。

## 5. 质量门控

| 条件 | 允许的 UI 行为 | 禁止行为 |
|---|---|---|
| 覆盖未知 | 展示已有事件和提示 | 活跃率、标准化趋势 |
| 方向覆盖低 | 展示方向为 Unknown | 发起平衡、回拨率 |
| 时长缺失 | 展示次数 | 平均、中位、总时长结论 |
| 去重待复核多 | 展示原始候选 | 异常检测、精细对比 |
| 时区未知 | 展示日期近似值 | 精确星期×小时洞察 |
| Preview 适配器 | 持续显示兼容提示 | 宣称完整支持 |

门槛数值由统计策略版本管理，不写死在 UI。

## 6. Lineage 与隐私

`EventLineage` 用于：

- 定位解析错误；
- 适配器升级后定向重算；
- 解释去重结果；
- 支持用户修正与撤销。

约束：

- `sourceRecordIdHash` 是应用内部哈希，不显示给普通用户；
- 不包含数据库密钥；
- 不包含原始消息正文；
- 不将完整绝对路径传给 WebView；
- 诊断导出默认脱敏 lineage。

## 7. 版本策略

### Contract Version

- `1.0`：当前基线；
- major：字段移除、语义变化、枚举含义改变；
- minor：增加可选字段或新增向后兼容枚举值；
- patch 不进入 wire version，由应用版本记录。

前端处理规则：

- 支持的 major：正常解析；
- 相同 major 的未知可选字段：忽略；
- 未知枚举：适配层转换为 `unknown` 并附 warning；
- 不支持的 major：拒绝展示并提示升级，不能猜测解析。

### Parser 与 Dedup Version

解析和去重版本独立于 wire contract。版本变化后：

- 保留旧 lineage；
- 按影响范围重算 canonical event；
- 再生成聚合缓存；
- 用户修正 overlay 重新套用，不被覆盖。

## 8. 契约变更流程

1. 提交契约变更说明；
2. 同步修改 TypeScript 与 JSON Schema；
3. 增加或更新合法/非法 Fixture；
4. 检查 Rust DTO 映射；
5. 运行契约验证和前后兼容测试；
6. 对破坏性变更新增 major 目录，不直接修改旧 major；
7. 更新 ADR 和迁移说明。

## 9. Phase 2 验收标准

- [x] Canonical CallEvent 已定义；
- [x] Contact、ContributionDay、Summary、Quality 已定义；
- [x] Unknown、Null 和时间语义已定义；
- [x] Lineage 与隐私边界已定义；
- [x] TypeScript 类型已落盘；
- [x] JSON Schema 已落盘；
- [x] 合法示例 Fixture 已落盘；
- [ ] Rust `serde` DTO 与 v1 Schema 对齐；
- [ ] 在 CI 中使用完整 JSON Schema validator 校验 Fixture；
- [ ] 增加非法 Fixture 与兼容性回归测试。
