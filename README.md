# 通话足迹 · WeChat Call Footprint

一个 local-first、源数据只读、结果可追溯的个人微信通话元数据回顾工具。

当前仓库包含：

- v0.3 可交互 UI Demo；
- Phase 1 产品骨架与体验基线；
- Phase 2 前后端数据契约；
- Tauri/Rust 正式工程的架构、测试和迁移准备。

双击 `index.html` 即可体验当前原型。

## 这版新增

- 独立“时光墙”页面，视觉参考 GitHub Contribution Graph
- 支持按一年、一个月和自定义时间段展示
- 颜色深浅表示每日通话时长
- 展示活跃日、通话次数、总时长和最亮的一天
- 悬停格子查看摘要，点击日期查看当天记录
- 可切换 2025/2026 年和月份
- 自定义范围最多 366 天

## 原有体验

- 消费级轻松界面：首页、时光墙、小发现、通话记录
- 柔和渐变、大卡片、圆润图形和轻量操作
- 联系人隐私模式、通话筛选与详情抽屉

## 说明

仍然只使用本地模拟数据，不读取真实微信数据库。时光墙中的历史日期包含用于展示效果的模拟聚合数据，近期通话日使用 Demo 的逐条记录。

## 产品与架构基线

- [产品骨架与体验基线](docs/product/PRODUCT_SKELETON.md)
- [领域模型与数据契约](docs/architecture/DATA_CONTRACTS.md)
- [前后端 API 契约](docs/architecture/API_CONTRACT.md)
- [正式工程前期准备](docs/architecture/IMPLEMENTATION_PREPARATION.md)
- [ADR-001：Local-first 分层架构](docs/architecture/ADR-001-LOCAL-FIRST-LAYERED-ARCHITECTURE.md)
- [ADR-002：质量感知与 Unknown](docs/architecture/ADR-002-QUALITY-AWARE-UNKNOWN-VALUES.md)
- [测试策略](docs/testing/TEST_STRATEGY.md)
- [开发路线图](ROADMAP.md)

## Contract v1

TypeScript 类型、JSON Schema 与示例位于 [`contracts/v1`](contracts/v1/README.md)。

无需安装依赖即可进行基础校验：

```powershell
node scripts/validate-contracts.mjs
```

## 隐私边界

- 核心功能默认离线；
- 不读取或分析聊天正文；
- 不修改微信原始数据库；
- 不上传联系人、通话记录或密钥；
- 不根据通话频率评价关系或推断情绪。
