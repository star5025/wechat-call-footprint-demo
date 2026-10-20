# macOS 今晚首次运行：内部验收

仅用于新 CI 产物；旧版验收记录及旧包哈希不能代替本轮结果。默认所有真机项均为 **NOT RUN**。不要把此材料当作公开 Mac 下载/发布说明。

## 1. 包与机器（先做静态检查）

- 每台 Mac 记录：匿名机器代号、macOS version/build、实体芯片、运行架构/Rosetta、app version、CI run/commit SHA。
- CI 两个 job 使用 `macos-15`，并检查主机为 arm64；Intel 包是 x86_64 交叉构建。CI 通过、Rosetta 运行均不等于 Intel 真机通过，也不等于 macOS 12 等最低系统版本实测通过。
- 下载对应架构的 workflow artifact：`call-footprint-<target>-unsigned-internal`；target 为 `aarch64-apple-darwin` 或 `x86_64-apple-darwin`。内含：
  - `call-footprint-<target>-unsigned.app.zip`
  - `call-footprint-<target>-unsigned.dmg`
  - `SHA256SUMS`（校验内层 zip/DMG，不是 GitHub 外层 artifact zip）
- 在同一独立目录内先执行 `shasum -a 256 -c SHA256SUMS`，再执行 `hdiutil verify <对应DMG>`。任何失败即停止；哈希只用于传输完整性，不是来源认证/公证。
- CI 静态检查主程序 Mach-O 单一架构、执行权限；`Contents/Resources` 的文件仅为图标和 `macos/bootstrap_keys.py`、`macos/capture_keys.py`，helper 字节与源码一致。后端应从 Tauri `resource_dir()/macos/bootstrap_keys.py` 找到入口，不应依赖源码目录。私钥、用户配置、测试不入包。
- 包使用 `--bundles app,dmg --no-sign`，**未做 Developer ID 分发签名/公证，仅供内部验证**。CI 不挂载 DMG、不启动 GUI/helper，不代表运行能力通过。只上传短期 workflow artifacts，不创建 Release 或公开 Mac 下载入口；“internal”名称不提供访问控制，敏感内部材料仍须受限仓库/渠道。
- 用户自行挂载 DMG 并复制 app 到独立位置，或解压 app zip（二选一，不相互覆盖）。Gatekeeper 若拦截，仅在核验来源、哈希且本人同意后使用系统允许的 Finder“打开”/“隐私与安全性”提示。政策禁止则记 **BLOCKED**；不自动移除 quarantine，不关闭 Gatekeeper/SIP、不自动启用开发者政策，不用 sudo 启动。

## 2. 先空环境，仅测 UI 与保护性拒绝

使用独立 macOS 测试用户，尚未登录微信、不含真实数据。不要为了造空环境退出/删除日常账号。

- [ ] 手动打开 app：窗口、中文、缩放、导航、关闭重开正常，无白屏。
- [ ] 不初始化、不启动临时微信；检查未安装/无账号/无数据提示，取消选择或授权不改变已有应用记录。
- [ ] 用下列**合成**完整空导出测试导入、预览、确认、空态、保存后重开；再取消导入，已有状态不丢失。真实账号/导出不用于此阶段。

```json
{"format":"call-footprint-export","formatVersion":"1.0","contractVersion":"1.0","exportedAt":"2026-10-20T00:00:00+08:00","timezone":"Asia/Shanghai","source":{"kind":"normalized_file","displayName":"合成测试","sourceVersion":null},"account":{"id":"synthetic-account","displayName":"合成测试"},"contacts":[],"events":[],"coverage":[]}
```

- [ ] 空态不是微信读取成功；版本不支持、初始化缺失、权限受阻应为明确保护性拒绝，不能显示为“0 条读取成功”。空环境通过后才能进入下一阶段。

## 3. 受控的本人已有账号（可跳过，不能默认授权）

**初始化警告：临时 ad-hoc 重签微信副本降低签名保护，不是沙箱；仍可访问真实账号、联网，登录及账号变更可能持久化。不要在临时副本编辑消息/草稿。原版 app 不应被修改，但这不意味着账号数据没有副作用。** 所有者须事前理解并单独明确同意；无同意或不接受风险即 **BLOCKED**。

前提：本人已有的受控账号、适配版本官方微信（当前 4.1.13）、原生 Apple Silicon（非 Rosetta）、非 root、系统工具可用，开发者政策已经由所有者独立决定并配置。Intel 本轮仅测 UI/安全拒绝，初始化不支持时不得强行绕过。权限/TCC 或组织政策拦截也不能靠自动改系统政策解决。

- [ ] 先正常退出官方微信；应用检查版本/账号，再显示初始化授权与上述风险提示。不同意/点取消不得启动 helper，不影响已有记录。
- [ ] 经本人确认后才初始化；包内 bootstrap 调用同目录 capture helper。只调试其明确启动的临时进程，不附加已有微信、不自动杀原版。缺 helper/工具或政策不满足应安全失败，不能假报 ready。
- [ ] state 为当前用户所有的私有 **0700** 目录；初始化工作目录应为空且与原版/数据库路径不重叠；manifest 为当前用户所有的 **0600** 普通文件，使用真实规范路径、无符号链接。仅在本机检查权限/状态，不输出内容，不把真实密钥改成公开权限来造拒绝用例。
- [ ] 单独验证“授权前取消”“初始化进行中取消”“超时/错误后重试”。先用合成/无私密目标验证可控终止；不为触发错误破坏真实微信。UI 必须等 owned 子进程退出和清理确认，才能恢复可操作。进度消失/显示已取消不等于清理成功；取消后不得出现迟到的成功状态或替换已有记录。
- [ ] 清理核验：临时进程已退出；原版签名仍有效且未改变；临时 bundle 注销/停用。`.disabled` 改名**不能禁止直接执行**，在确认无进程使用后由所有者清理本次临时副本，不碰原版、微信数据或既有私有 manifest。
- [ ] `manual_restore_required`、退出不确定或原版签名无法确认：记 **FAIL/BLOCKED**，停止真实账号读取，按恢复提示正常退出临时副本、核验原版后手动打开；不要把自动拉起请求等同于原版运行正常，也不要强制继续初始化。
- [ ] 只有初始化/清理确认后，另行授权真实只读扫描。本人本机核对日期、时长、类型、去重、partial/完整标识、快照清理与微信正常使用。初始化 ready 或生成 manifest **不等于**完整读取成功；空结果须与权限/缺密钥/partial 区分。应用“删除记录”不等于删除 manifest/state，也绝不应删除微信数据。

## 4. 各项独立判定与最小回传

每项分别写 `PASS / FAIL / BLOCKED / NOT RUN`，附失败阶段、固定错误码（如有）：

| 项 | 本轮结论 |
|---|---|
| CI / 包资源 / Mach-O / DMG / 哈希 | 未运行新 CI 前 NOT RUN |
| 空环境 JSON/UI、保护性拒绝 | NOT RUN |
| bootstrap 实际启动/初始化 | NOT RUN |
| 取消/超时与 owned 进程退出 | NOT RUN |
| 清理与原版恢复 | NOT RUN |
| 本人账号 live 完整/partial 读取 | NOT RUN |
| Intel 真机 / 不同 macOS 版本 | 分机分别记录，默认 NOT RUN |

Python 合成安全测试、资源静态检查或 ARM CI success 均不能替代 LLDB/TCC/GUI/LaunchServices/live 验证。

仅回传机器与版本类别、run/SHA、**包** SHA-256、上述状态、阶段/固定码、耗时区间、partial 是/否、退出/清理是否确认。**不向我们发送原始日志、密钥/候选材料/manifest（或其哈希）、数据集/真实导出、数据库/WAL/SHM、账号/联系人/通话明细、绝对用户路径、内存转储。** 截图仅限人工检查过的合成 UI。出现隐私信息泄漏即停止分享，单独记隐私 FAIL。
