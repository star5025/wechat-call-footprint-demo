# macOS 今晚真机验收（2026-10-19）

## 结论与证据边界

- CI：https://github.com/star5025/wechat-call-footprint-demo/actions/runs/39187331403 ，completed / success。
- 产物对应提交：`4581b271b147ddd98424d9510121a672daf2ccbd`。目录名虽为 v0.4.0，两个包内 Info.plist 均为 **0.5.0**，最低系统版本 **12.0**。
- 两个 job 实际均为 `macos-15-arm64` image `20260907.0337.1`，Rust host 均为 `aarch64-apple-darwin`。
- job 117852402337：原生 arm64 构建；job 117852401817：交叉构建 x86_64。**Intel 交叉构建成功 ≠ Intel 真机实测；Apple Silicon/Rosetta 运行也不能代替 Intel 实测。**
- 两 job 的 npm ci、npm run check（contract/typecheck/Vitest/build）、主机 Rust 测试、指定 target unsigned app 构建、ditto 打包、上传均 success。各自 Rust 为 21 passed / 0 failed / 1 ignored；真实数据 ignored 测试未执行。不是两种 CPU 上各跑一遍测试。
- 已知非阻断日志：Actions Node 20 迁移提示、Node API 弃用提示、并发 npm cache 占用。当前工作区已在 CI 新增 Python 合成测试步骤，尚需新提交运行验证。
- 本次仅静态核验、下载和准备材料，**没有执行应用，没有读取本机微信**。UI/微信能力均待真机验证，不能报发布通过。
- 工作区已有他人修改（含 macos.rs），不属于上述 CI 包；后续修改必须重新构建并记录新 run/SHA，不能套用此处哈希。

## 包路径及 SHA-256

所有下载及日志只在系统临时目录，不在 git 仓库：

`C:\Users\This PC\AppData\Local\Temp\call-footprint-macos-39187331403-WEvTTp`

应传给对应 Mac 的是下列**内层应用 zip**（每个在同名无 .zip 子目录中）：

|芯片|文件名|字节|SHA-256|
|---|---|---:|---|
|Apple Silicon|call-footprint-aarch64-apple-darwin-unsigned.zip|3231381|085024e480e2a72d2d336df63bb492872f8066fb7d0131ff135a781c06918787|
|Intel|call-footprint-x86_64-apple-darwin-unsigned.zip|3411823|a80f0c154c9f7edb65e5151c2ff66109d589b042a3d8a5844071159b9a091e3f|

另保存 GitHub 外层 artifact zip（临时目录根部，以 `-github-artifact.zip` 结尾）：

|架构 / artifact ID|外层 SHA-256（已与 GitHub API digest 一致性核验）|
|---|---|
|arm64 / 12158762428|41f9f3284ba774766837df38a04bb3e24f5e639e13bd53f4916b8fd8eb829d0e|
|x86_64 / 12159185375|cdd66ff32fa6148716764ec509c735a675f1958674fe9e87176737a0f7d81aa3|

不要用外层 digest 去比对内层 zip。artifact 预计 2026-11-02 到期，临时目录也非长期归档。

内层 zip 全部条目解压到内存验证 CRC/长度通过，无路径穿越条目。每包 7 条目，仅含 `通话足迹.app/Contents` 下主程序、Info.plist、Resources/icon.icns 及目录。主程序 Unix mode 100755，Mach-O 64-bit：arm64 CPU type 0x0100000c；Intel 0x01000007，非 universal binary。此为静态结构检查，不等于系统加载/签名验证。

临时目录还含 `artifacts.json`、两份 `job-*.log`、`bundle-inspection.json`。这些是 CI/静态证据，不是用户数据诊断包。

## 前置：每台机器分别填写

- [ ] 日期、匿名机器代号；`sw_vers -productVersion` / `sw_vers -buildVersion`；芯片型号类别（Apple Silicon 或 Intel）；`uname -m`。若终端经 Rosetta，另从“关于本机”确认实体芯片。
- [ ] 包内 app 0.5.0、run/SHA、内层 zip 哈希对应上表。复制到 Mac 后先 `shasum -a 256 <zip>`；不匹配即停止。
- [ ] macOS >= 12.0 只是声明下限，CI macOS 15 不构成 macOS 12/13/14 全覆盖；每个系统版本单独记结果。
- [ ] 单独记录微信版本及 build；此提交读取入口仅允许 **macOS 微信 4.1.13**，不把 Windows 版本号当 Mac 版本；即使 4.1.13 也仍待实测。
- [ ] 用专门测试用户/合成数据做 UI 验收；微信读取只由数据所有者本人在授权账号上操作，不向协助者传原始数据。

## 非签名包限制与打开方式（由测试者操作）

本包使用 `--no-sign`，无 Developer ID 签名/公证保证，仅用于内部验收，不是公开发布安装包。没有 dmg。

1. 校验哈希后用 macOS 原生归档工具或 `ditto -x -k <zip> <独立测试目录>` 解压；两架构不要解到同一目录覆盖。
2. 可先对 app 主程序执行 `file` / `lipo -archs`，对 app 执行 `codesign -dv --verbose=2`、`spctl --assess --type execute` 做静态检查；记录状态码/是否拒绝即可。工具返回非零不等于功能失败，unsigned 包不应宣称已公证。
3. 首次手动打开可能被 Gatekeeper 拦截。仅在确认来源、哈希及本人同意后按系统“隐私与安全性→仍要打开”或 Finder“打开”提示处理。若政策禁止则记 BLOCKED，不绕过组织策略。
4. 不提供关闭 Gatekeeper、SIP、重签微信、关闭微信安全防护或全局删除 quarantine 的步骤。不要以 sudo 启动应用。安全拦截与 UI 功能失败分开记录。

## A. JSON / UI（不依赖微信）

只用合成 AppDataset；`contracts/v1/examples` 的单事件/贡献墙 JSON 不是完整导入文件。可本地保存如下最小空数据用于空态测试：

```json
{"format":"call-footprint-export","formatVersion":"1.0","contractVersion":"1.0","exportedAt":"2026-10-19T00:00:00+08:00","timezone":"Asia/Shanghai","source":{"kind":"normalized_file","displayName":"合成测试","sourceVersion":null},"account":{"id":"synthetic-account","displayName":"合成测试"},"contacts":[],"events":[],"coverage":[]}
```

- [ ] 未连接微信也能打开；窗口、中文字体、滚动、缩放/调整尺寸、关闭重开无白屏崩溃。
- [ ] 从文件打开上述 JSON，预览/确认及空态正常。取消文件选择不会清掉现有内容。
- [ ] 用仓库现有合成演示数据或测试者本地构造的完整合成导出做非空测试：预览计数、联系人页、日历/贡献墙、筛选、排序和时长显示相符；不使用真实联系人名称。
- [ ] 非法 JSON、错误 formatVersion、负时长、重复 event id 被友好拒绝，已有数据不被替换。
- [ ] 保存合成数据→再次打开，计数/统计相符；删除应用记录并确认提示，不影响微信；重启后验证预期持久化状态。
- [ ] 导出/截图仅含合成信息。A 项结果独立记 PASS/FAIL/BLOCKED；A 通过不等于微信适配通过。

## B. 微信读取（所有者本机授权；默认验证安全拒绝）

本 CI 提交没有已完成的自动密钥初始化。未设置本地私有清单时，预期是检查版本/账号/元数据后提示初始化未完成，**不是读取成功，也不是空通话结果**。此任务不要求生成、收集或传输任何密钥清单，也不提供提取密钥流程。

- [ ] 未安装/未登录/无数据：应安全提示，不崩溃，不覆盖原有合成数据。只在隔离测试环境验证，不为造故障删除微信文件。
- [ ] 非 4.1.13：应在版本检查拒绝自动读取；拒绝是保护行为，不代表该版本已支持。
- [ ] 4.1.13：保持官方微信正常登录；首次点击读取先确认授权弹窗，取消不启动读取。
- [ ] 默认无私有清单：版本/发现/元数据阶段的结果与上述限制一致，结束后可再次操作，不持续卡在“读取中”。UI 若只显示通用错误，也仅记录阶段和固定错误类别，不粘贴后端原始错误。
- [ ] 若权限受阻，由所有者按系统提示决定是否只给本应用必要的文件/完全磁盘访问并重启重试；记录授权类别，不截图包含用户名的路径。不得承诺完全磁盘访问可解决所有问题。
- [ ] 若所有者此前已独立准备合法、受保护的本地密钥配置，完整只读链路可另行授权验收：在本机核对总数/日期/时长/媒体类型、partial 与完整标识、重复扫描去重及临时快照清理。**不把密钥文件、路径、联系人、聊天或真实导出发送给协助者。**没有这项前提就记“完整读取 BLOCKED：密钥初始化未完成”，不要求临时采集密钥。
- [ ] 若提示泄漏绝对路径、账号标识或原始数据库错误，停止分享输出，记隐私 FAIL；原始弹窗/日志不入仓库，不以打码前截图作为证据。
- [ ] 结束后确认微信仍可正常使用，测试 app 退出；仅清理本次合成测试输出，不删除微信或所有者的任何密钥配置。

## 本轮新逻辑的额外验收门禁

下述仅针对重新构建后的新包，不适用于上表旧包：

- 初始化脚本仅支持原生 Apple Silicon；Intel 只测试 JSON/UI 与保护性拒绝。
- 首先以合成目标验证取消、超时、强制终止及恢复，确认临时目标真正退出；若出现 `manual_restore_required`，判失败并停止真实账号测试，不能视作自动清理成功。
- 临时重签微信副本不是沙箱，仍可能访问真实账号及联网；登录和账号变化可能持久化。改名 `.disabled` 也不能禁止直接执行。测试必须由所有者明确授权，结束后核对原版签名及正常使用，再清理临时副本。
- 不因自动化 mock 测试通过，就认定 LLDB、TCC、LaunchServices 和 GUI 恢复已验证。
- 私有 manifest 应为当前用户所有的 `0600` 普通文件；使用真实规范路径，拒绝符号链接。不得为测试将真实密钥改为公开权限；拒绝测试使用合成材料。
- 提交与下载新构建后，重新记录 run/SHA/包哈希；本轮本地测试结果不适用于旧包。

## 脱敏结果回传（只允许以下字段）

每台机器分别填写一行/一份：日期、匿名机器代号、macOS version/build、实体芯片类别、运行架构/Rosetta 是/否、app version、run/SHA、包 SHA-256、微信 version/build、签名/Gatekeeper 结果枚举、授权类别、A/B 各步骤 PASS/FAIL/BLOCKED、失败阶段、固定错误代码（若有）、耗时区间、是否 partial、是否正常退出/清理。

不要采集：密钥/候选材料/清单内容或其哈希、联系人/账号 ID/wxid、手机号、聊天内容、通话明细/真实数量、数据库/WAL/SHM、内存转储、原始日志、绝对用户路径、机器序列号、Apple ID、访问令牌。不要上传整个应用数据目录或真实导出。需要截图时仅限合成 UI 并先人工检查。

最终判定需拆开：`JSON/UI = ...`、`微信保护性拒绝 = ...`、`微信完整读取 = ...`、`Intel 真机 = ...`。没有实际结果统一填 NOT RUN/BLOCKED，不能用 CI success 代替。
