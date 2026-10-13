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

## 下一里程碑：M1 正式前端骨架

- [ ] 初始化 Tauri 2 + React + TypeScript；
- [ ] 将 v0.3 拆分为页面和公共组件；
- [ ] 提取设计 Token；
- [ ] 实现 `DemoCallDataSource`；
- [ ] 使用 v1 契约替换页面内硬编码对象；
- [ ] 完成 Loading、Empty、Partial、Missing 和 Error 状态；
- [ ] 生成第一份 Windows 开发版 EXE；
- [ ] 保持 UI 视觉与 v0.3 一致。

## M2 真实数据库最小闭环

- [ ] 用户选择已解密数据库；
- [ ] Rust 只读打开与 Schema 探测；
- [ ] 解析联系人和 CallEvent；
- [ ] 记录页显示真实事件；
- [ ] 时光墙显示真实 ContributionDay；
- [ ] 与 22/16/44,352 秒金标准一致；
- [ ] 错误、取消和临时清理测试通过。

## M3 隔离与自动采集

- [ ] Acquisition Worker；
- [ ] SQLite/WAL 一致快照；
- [ ] 多分片与精确去重；
- [ ] 增量扫描；
- [ ] Windows 自动发现；
- [ ] 自动密钥能力独立安全与法律评审；
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
