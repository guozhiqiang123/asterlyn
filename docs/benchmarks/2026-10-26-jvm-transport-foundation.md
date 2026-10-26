# A1a：JVM 导入前的有界事件传输

日期：2026-10-26。承接 [A0 失败证据](2026-10-26-android-jvm-a0.md)，本次完成 A1 的队列子阶段。
未新增 JVM profile、执行权限、客户端能力或 SDK；A1 整体、A2 模型与 Java/Kotlin/Groovy 上线仍未完成。

## 行为与资源边界

真实 JDT 导入能瞬间发送数百条进度/状态。原通道把每条通知与响应放进同一个 16 项队列，满队列会杀服务；
初始化等待又会把所有非目标响应放进另一个 16 项缓冲。因此只放大其中一个队列不能解决问题。

新 `inbox` 在 reader 和初始化缓冲使用相同规则：

- 响应、诊断、服务器请求、未知通知仍是最多 16 项的严格 FIFO，超限仍停止所属进程。
- 只对 JDT 的 `language/progressReport` 和五种已知 `language/status` 使用 6 个固定替换槽；
  每条最多 8 KiB，只保留该类最新值。不是任意 token/string key 的无界 map，也未放开通用 `$/progress`。
- 消费者按保留消息的接收顺序合并两个区域；ServiceReady 与各已知状态单独保留，不让进度覆盖就绪。
- EOF/协议错误有独立终止槽；普通队列满时 reader 也无需阻塞等待错误投递。断开会唤醒等待者。
- `next_event` 的初始化缓冲恢复 FIFO；此前 `poll_event` 用 remove(0)，而 `next_event` 用 pop()，两入口顺序不同。
- 4 MiB 帧、8 KiB 头、128 transport 请求、8 项 writer 和 actor 的所有既有限额保留。固定状态槽最多新增
  48 KiB 序列化正文容量/缓冲；这不是实际 JSON 堆内存或进程 RSS 的上限，不把协议限额冒充内存预算。

这只是单语言进程内的状态传输，未提供 Android model generation、变体切换、启动取消、JDK/profile 信任绑定、
`workspace/configuration` 客户端请求或诊断一致性适配；不允许插件提交 argv，也不据此宣称 JVM 可用。

## 验证

- 核心 crate 16 项单元测试通过；新增 7 项 mailbox 测试及 1 项真实管道/reader/初始化缓冲测试。
  用 20,000 条合并候选消息验证响应、诊断和 ServiceReady 不丢失；另用 1,000 条子进程通知覆盖启动路径。
  未知状态/请求/响应的容量、8 KiB 状态上限、满队列终止、断开唤醒和 FIFO 均有回归。
- 显式设置真实工具环境后，3 项真实 TS/Rust transport 测试通过。TS 本项目跨文件定义/引用、hover、补全和
  dirty 诊断约 1.29 秒；Rust 跨 crate、引用、补全、dirty target +1 行与版本化诊断约 13.00 秒。
  这些为单轮本机耗时，不是新的 p95 或资源预算。
- 显式设置工具环境后的原生 language actor 6 项通过（13.61 秒），包括真实 TS/Rust 独立会话、dirty 请求和回收。
  未设置环境的 opt-in 空跑不作为真实服务证据。
- `npm run check`、`npm run build`、`npm run test:scripts`（1,338 项）、核心 crate clippy 全 target / warnings-as-errors 通过。
- 无 UI 交互变更；键盘/可访问性沿用现有 TS/Rust 路径，没有 Android UI 验收结论。

## 本机交付

运行代码提交 `771c46a` 已重新构建并完整 ad-hoc 签名，严格 bundle 验证与 ZIP CRC 通过。
[机器可读交付证据](2026-10-26-jvm-transport-delivery.json) 记录原生日志、图标启动和资源样本。

- ZIP：`target/release/bundle/macos/Asterlyn-0.1.21-macos.app.zip`，20,022,135 B。
- ZIP SHA-256：`34eb1a7a07768639dd27b4ab1b0cc5134ed0a94fa8f1de1a9ec1dc6dfd07e64b`。
- 安装 executable SHA-256：`c4551940f76eea3566db70215055cb179dc2593972dee6e201987f5d305d2615`，与验收包一致。
- buildId：`771c46af06f14b9934acb8ec9b63257e0f05c819-clean-1793018912194`；版本仍为 0.1.21，未发布远端。
- 真实 Asterlyn 项目启动日志记录 frontend-ready、2 个已有语言 provider，语言服务错误 0。
  两条既有 `existing_project_directories` 错误仍存在，未计作语言错误，也不声称修复。
- 规范安装器只交换 `/Applications/Asterlyn.app/Contents`；根 inode `203606126` 保持。
  旧包保存在已验证 ZIP；无展开的 `.app.backup`。保存图标首次启动和退出重开均记录 frontend-ready。
  首次启动达到 frontend-ready 后即退出，当时 provider 尚未完成注册；重开后日志确认 2 个已有 provider。
  没有通过测试端口替真实应用批准执行权限。
- 重开后根进程单次 RSS 112,816 KiB、CPU 0.1%；不含 WebKit/helper/语言进程，
  不是整树、峰值或长期内存预算。JVM 服务尚未进入产品，本次不存在 JVM 内存达标结论。
- 测试 worktree 已删除；本次创建的独立 Gradle daemon 已清理，未停止用户的共享 daemon。
  清理时两个原 Android 项目 Git 状态均无变更。

交付收尾仅把 `cfg(test)` 洪峰夹具从 600 轮降至 500 轮（1,000 条通知），使单个测试子进程参数低于 Linux
128 KiB 限制；16 项单元测试再次通过。该调整和文档不改变上述已安装运行代码。Linux/Windows 原生、Android
编辑器交互、只读 SDK/依赖来源和混合语言一致性仍未验收，安装基础改造不表示 Android 功能已开放。
