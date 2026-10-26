# Rust 语言服务首个工作区里程碑验收

日期：2026-10-26。宿主 0.1.21、SDK 1.12.0 开发制品、插件 0.2.0；没有远端发布。
验收目标为真实 Asterlyn Cargo 虚拟工作区，macOS arm64。

## 交付边界

- Rustup 1.98.1 的实际 rust-analyzer/rust-src；server 报告 `rust-analyzer 1.98.1 (48a229ce 2026-09-01)`。
  开发验收通过官方 Rustup 补齐组件；产品不会自动下载安装工具或项目依赖。
- Rust 不依赖 Node。插件仅携带固定 profile JSON，宿主检查 Cargo/rustc/RA 实际二进制及策略摘要，
  直接运行工具链组件、固定 sysroot 和 rust-src，使用离线/locked Cargo 模型。
- TS 和 Rust 单独授权、单独进程；Git 刷新不使当前项目的授权失忆；停 Rust 后 TS 仍可请求。
- 工作区内的 Ctrl/Command-click、F12、引用选择、hover、基础 completion、未保存内容与版本化诊断。
  服务索引中的结果明确提示等待；不显示为“没有定义”。
- build scripts、proc-macro、自动 import 和保存即 Cargo check 关闭。Cargo 配置仍在用户授权的执行
  信任边界内，不声称只读沙箱。独立无 Cargo 文件、根外标准库/依赖导航、宏生成源码、跨平台完整验收未完成。

## 自动化证据

| 检查 | 结果 |
| --- | --- |
| `npm run check` / `npm run build` | 通过；启动 main 约 491 kB，低于既有 500 kB 门槛 |
| `npm run test:scripts` | 1,334 通过 |
| `cargo test --locked --workspace` | 498 通过、6 ignored（既有 opt-in）；不是把跳过项计作通过 |
| 原生语言 actor 聚焦复验 | 7 通过；含真实 TS/Rust 共存、Rust v2 未保存诊断、旧 review 不能启动另一 profile、UTF-16/长度上限 |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | 通过 |
| 真实 Rust transport 探针 | 本项目跨 crate definition、hover、多引用、completion、目标未保存前缀引发 +1 行、未保存语法诊断；磁盘源码不变，约 14.0 s |
| 双引擎真实 Rust Ctrl-click | 生产 editor/client/navigator/transport；真实鼠标事件到真实 RA 返回的目标并选中 `start`；见下表 |
| TS/JS 浏览器回归 | Chromium | 11783 ms | 34 ms | 1 |
| WebKit | 11782 ms | 34 ms | 1 |

浏览器全链路使用专用受控测试批准端口和本机 Rust transport，不能代替原生 UI 授权测试。
原生 actor 与真实包投影单独验收；应用启动后的两个 provider/安装身份最终还需原生日志确认。

## 资源与清理

冷语义查询包含首次按需解析，双引擎约 11.8 s，已打开标签页再次跳转均为 34 ms，且每轮只启动一个会话；普通 TS 导航循环保留 JS heap 样本
约 +163 kB / 20 轮（单次本机样本）。RA 单进程 RSS 抽样 1,336,624 KiB（约 1.27 GiB），
不是峰值或跨平台预算，尚不能宣称 Rust 服务轻量。固定 2 个 RA worker；关闭最后一个文档后回收
进程，TS 不随 Rust 停止。后续应另测长期缓存/多窗口与资源预算，不将协议大小上限等同 RSS 上限。

保留原有每文档 2 MiB、32 文档、64 actor 请求、128 transport 请求、4 MiB 帧与有界队列。
并发初始化和会话合计限制为 8；窗口/项目 activation/profile 构成启动身份；项目撤销和关闭清理整个树。

## 包与 SDK

- 插件源码提交 `a80753e`。插件包：4,579,680 B；解压文件 24,577,252 B，134 个 integrity 资源项；比 0.1.0 增加 597 B。
- SHA-256：`e98c56cecfb930b0d6327dcaf6180579eb039838b12b2acfc924f69363559915`。
- SDK：7,248 B；精确 tgz 同步 host template 与 sibling vendor，SHA-256/SHA-512 和 lock 一致；未发布的开发制品。
- 日志仅记录 profile、固定 indexing/ready/degraded、版本、计数、耗时与 document hash，不落源文或 server/Cargo 原文。

## 原生交付

- 宿主代码提交：`96c73fe`（SDK 提交 `0543766`；插件提交 `a80753e`）。
- 签名：完整 bundle ad-hoc + runtime，`codesign --verify --deep --strict` 成功；Sealed Resources v2。
- 真实本项目原生启动：两个 LSP contribution / 两个 registered provider，插件 0.2.0 `knownGood`，LSP 错误 0。
- 使用规范安装器交换 `Contents`；`/Applications/Asterlyn.app` 根身份保持，inode `203606126`。
- 原安装保留为验证过的 ZIP；没有新增展开的 `.app.backup`。原图标 bookmark 首次启动和退出重开均记录 frontend-ready。
- 安装的 executable SHA-256：`e069748d3a6002943ddf138af40e7e3ae8329fbeff5dcfaf13ca70fcb6bc1058`，与验收包一致。
- ZIP SHA-256：`011047b0d99188fbf3639d7203a7923ba2b402d08ea83c4af06f32aafb93b47e`；`Asterlyn-0.1.21-macos.app.zip` CRC 校验通过。
- 安装 buildId：`96c73fee28650da1236cc4bc862c9d779a98cab8-clean-1793009516351`。
- 重开 session：`session-1793009744041-34688-0`；该日志再次确认 LSP 0.2.0 的 2 个 contribution 和 provider。
- 仍有基线 `existing_project_directories` 的两个失败日志；未计为 LSP 错误，也不声称修复了此既有问题。
- 原生 UI 的真实执行授权留给用户首次启用 Rust；没有通过测试端口替实际应用批准。
