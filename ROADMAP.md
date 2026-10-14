# Roadmap

## 已完成：Phase 0–2 基线

- [x] v0.3 消费级 UI 方向获确认；
- [x] 首页、时光墙、小发现和记录原型；
- [x] 年/月/自定义时光墙；
- [x] 产品定位、页面职责和核心旅程；
- [x] Canonical CallEvent 与质量模型；
- [x] TypeScript 和 JSON Schema v1；
- [x] API、错误和扫描状态契约；
- [x] Local-first 架构 ADR；
- [x] 测试与统计金标准。

## 已完成：M1 正式桌面工程

- [x] Tauri 2 + React + TypeScript；
- [x] 页面、公共组件、设计 Token 和 Demo 数据源；
- [x] 使用 v1 契约替换页面内硬编码对象；
- [x] Loading、Empty、Partial、Missing 和 Error 状态；
- [x] Windows 便携 EXE 与 NSIS 安装包；
- [x] 保持 UI 视觉与 v0.3 一致。

## 已完成：M2 Windows 真实数据库闭环

- [x] Windows 微信 4.1.15.13 严格版本适配；
- [x] 安装、进程、账号、自定义数据目录和消息分片自动发现；
- [x] 原库只读快照、逐页 HMAC、WAL checksum 与提交边界验证；
- [x] 进程内密钥候选恢复和数据库 HMAC 验证；
- [x] 联系人、Name2Id、VoIP payload 和 CallEvent 解析；
- [x] 记录页、时光墙和统计使用真实事件；
- [x] 本机真实数据 Release 链路验证；
- [x] 扫描互斥、资源预算、密钥清零与临时清理。

## 下一里程碑：M3 隔离、任务化与增量采集

- [ ] 独立 Acquisition Worker；
- [ ] Contract v1 `scan_start/status/cancel/progress` 完整任务接口；
- [ ] 跨分片多来源合并与精确去重；
- [ ] 增量扫描；
- [ ] 更多 Windows 微信 build 的独立适配器；
- [ ] 自动密钥能力独立法律评审；
- [ ] Defender/SmartScreen 兼容测试。

## M4 产品完善

- [ ] 多联系人与身份合并；
- [ ] 数据质量中心；
- [ ] 完整/脱敏/聚合导出；
- [ ] 本地索引加密；
- [ ] 安装、升级、卸载和自动更新；
- [ ] Windows 代码签名；
- [ ] 无障碍和高 DPI 完整验收。

## 延后研究

- macOS 实证适配；
- 稳健趋势和变化点；
- 本地模型生成摘要；
- 正式隐私预算下的聚合分享。

明确不进入路线图：关系评分、感情判断、聊天正文分析、自动回复、数据库写回和撤回恢复。
