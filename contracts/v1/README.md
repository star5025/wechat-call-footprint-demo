# Contract v1

本目录是通话足迹前端、Tauri Command、Rust Core 和导出格式之间的 v1 契约基线。

## 内容

```text
models.ts                         TypeScript 领域模型
schemas/common.schema.json        公共枚举与值类型
schemas/call-event.schema.json    Canonical CallEvent
schemas/contribution-wall.schema.json
schemas/api-error.schema.json
examples/call-event.json
examples/contribution-wall.json
```

## 使用规则

- UI 只依赖这里的产品字段，不依赖微信数据库字段；
- Rust DTO 必须与 JSON Schema 对齐；
- 契约 major 变更创建新目录，例如 `contracts/v2/`；
- 新增字段优先为 optional，并提供合理的旧客户端降级；
- 新增枚举值时前端必须具备 `unknown` fallback；
- 示例不得包含真实联系人、路径、密钥或原始消息内容。

## 验证

当前仓库不依赖 npm 包，可直接运行：

```powershell
node scripts/validate-contracts.mjs
```

该脚本检查：

- 所有 JSON 可解析；
- Schema 基本结构与相对 `$ref` 目标；
- CallEvent 示例的 required、枚举和基本不变量；
- Contribution Wall 日期连续性、计数与摘要一致性；
- TypeScript 和 Schema 的关键枚举一致性。

正式工程建立后，CI 还应使用完整的 JSON Schema 2020-12 validator。
