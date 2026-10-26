# Rust 语言服务兼容计划

- 日期：2026-10-26；状态：**R0/R1 与 R2 工作区功能已实现，签名包及覆盖安装验收已通过；R3/R4/R5 待实施**。
- 宿主基线：`c79fa95`；规划时的可用插件为 `dev.asterlyn.lsp` 0.1.0、SDK 1.11.0，仅 TS/JS；本次交付为 0.2.0 / SDK 1.12.0。
- 目标：用 rust-analyzer 为普通 Rust 源码提供可用的定义/引用跳转、悬停、基础补全和诊断，
  与现有 TS/JS 同时工作。先在本项目真实 Cargo workspace 验收，再扩展其他 Rust 项目。
- 用户在发现 `.rs` 无法跳转后授权继续实施。当前交付目标先闭环本项目内 Rust 定义/引用导航，
  不把 R3 外部源码或 R4 Cargo/宏增强提前标为完成。允许本机准备组件、开发和本地打包；不发布远端。

## 1. 架构选择

继续使用同级 `asterlyn-plugin-lsp` 仓库，增加 Rust contribution；不新建 Rust 插件仓库，
也不在宿主中直接注册绕过插件治理的 Rust 服务。

插件负责语言与项目匹配、显示名称、受校验的 profile 声明和打包。宿主负责可信工具链解析、
固定启动配置、Cargo 执行策略、真实缓冲区、LSP 通信、授权、结果呈现、只读源码和进程监督。
插件不得提供任意 executable、argv、environment 或初始化 JSON。

建议新增宿主内置 `rust-analyzer` profile，与 `typescript` profile 并列。首版从**已安装的
Rustup 工具链组件**解析 rust-analyzer，直接运行校验后的实际二进制，不执行工作区里的同名工具，
不把 Rustup proxy 在工作区中的隐式工具链选择当作可信解析。插件不随包捆绑各平台 Rust 二进制；
固定下载/托管 server 是后续独立交付方案。[上游安装方式][ra-binary]

SDK 若需拓展 profile 枚举，以增量 minor 版本规划，暂拟 1.12.0，实际版本在 R0 冻结。
Rust 插件包必须提高最低宿主版本至首个通过双语言验收的版本；不得沿用当前 0.1.13 下限让旧宿主
接收到不认识的 Rust descriptor。当前 TS/JS 0.1.0 包及其校验值保持兼容。

## 2. 规划时核实的阻塞项（基线）

| 位置 | 当前限制 | Rust 接入前必须完成 |
| --- | --- | --- |
| `src/composition/language-services-runtime.ts`、`src/application/plugins/language-service-contract.ts`、SDK/原生投影校验 | 语言、扩展名、serverId 仅允许 TS/JS | 引入一致的已知 profile 注册表；同步全部静态/运行时校验，避免再次发生类型支持但桌面校验拒绝的问题 |
| `src/features/language-services/language-service-client.ts` | Session/consent key 不含 serverId，同插件两种服务会冲突 | 加入 profile 与执行策略身份；TS 授权不能自动批准 Rust/Cargo；保持真实 WorkspaceSession 身份，避免重新引入刷新反复弹窗 |
| `src-tauri/src/application/language_service.rs` | 启动锁只按 window owner，启动会调用 `cancel_owner` | 改为按 workspace activation + profile 管理；启动 Rust 不得杀死 TS，全窗口撤销仍停止两者 |
| `crates/asterlyn-language-service/src/lib.rs` | `start`、参数、环境、cwd、initializeOptions、tsdk 都绑定 TypeScript | 拆分通用传输与宿主验证后的 profile 启动/初始化；Rust 不依赖 Node，不接收 TS 的 `--stdio`/tsserver 参数 |
| `src-tauri/src/commands/language_service.rs`、`src/adapters/tauri/tauri-language-service-bridge.ts`、协议类型与确认文案 | 固定插件资源、Node 解析和 TypeScript review | 请求 profile 必须来自已验证包/声明及宿主 allowlist；review 绑定实际 Rust 工具链与策略，不能只扩大字符串枚举 |
| 原生诊断调度 | 使用 TS 专有 semantic/syntactic 请求；push 缺 version 会丢弃 | 独立 Rust 诊断策略，按实际 server capabilities 选择 pull/有版本 push；保留严格版本关联 |
| 目标打开与只读编辑器 | 仅打开 workspace catalog，read-only 禁用语义 overlay | 标准库和 Cargo 依赖需要受控只读源码入口；不能把任意 server URI 当作文件读取授权 |

优先按能力拆模块，例如 `profiles/typescript`、`profiles/rust-analyzer`、`diagnostics/pull`。
不继续在大 actor/App 文件中叠加语言分支，不通过提高 ownership ceiling 容纳实现。

## 3. 首版用户交互

- 已识别 Cargo 项目中的普通 `.rs` 文件启用 Rust provider；Ctrl/Command-click、F12、定义处查引用、Shift+F12、
  Alt/Option+F7、多结果筛选和键盘选择复用现有导航链路。
- 悬停先用安全纯文本；基础补全只应用已验证的当前缓冲区编辑，保持正常 undo。
  自动 import、多文件编辑、命令型补全、rename、formatting/code actions 不随本计划默认开放。
- 显示“工具链缺失 / 正在加载 Cargo / 索引中 / 可用 / 部分可用 / 失败”等状态。索引未完成时
  不把空结果伪装成“没有定义”，也不把健康的长索引误判成插件超时隔离。
- Rust 和 TS 可同时使用；关闭最后一个 Rust 文档可以回收 Rust 进程，TS 继续工作。
  同项目、同 profile/策略/执行身份只确认一次；Git 刷新、文件切换及匹配身份的服务重建复用选择。
  真实项目切换、显式禁用/卸载、工具链或执行策略变化按既有撤销规则处理。
- 授权界面显示 Rust、选定工具链与实际执行范围，摘要作为细节；不复用 TS/Node 的名称和提示。
- 独立 `.rs`、`rust-project.json`、无 Cargo 根目录先保留基础编辑并明确状态；首个里程碑不宣称
  完整支持所有 Rust 项目布局。Cargo workspace 和多个 crate 属于必测主路径。

## 4. 工具链、项目模型与执行授权

### 4.1 固定工具链，先检查再启动

宿主在工作区外查询已安装 Rustup 工具链，校验实际 rust-analyzer/cargo/rustc 路径、版本与摘要，
并绑定 rust-src/sysroot。项目的 `rust-toolchain.toml` 是待核实的选择提示，不能直接授予任意本地
toolchain 路径、wrapper、项目内程序或自动下载权。缺组件要显示可执行的准备步骤，不能虚报服务就绪。
默认启动前要求指定工具链的 rust-analyzer 与 rust-src 均已准备好，并显式固定 sysroot 来源，
避免把首次服务启动变成隐式组件下载。
Rustup 支持显式工具链选择，但也允许自定义路径，宿主必须收紧接受范围。[Rustup 环境说明][rustup-env]

本次只读检查发现：本机存在 stable 与 1.98.1；两者查询 rust-analyzer 均返回 unknown binary；
1.98.1 已装 cargo/rustc/rustfmt/clippy，未列出 rust-src。**当前尚不具备指定工具链的真实 Rust
服务验收条件**。未执行任何安装/更新命令。R0/R2 实施时需先明确准备组件与版本证据。
不要把“存在 `~/.cargo/bin/rust-analyzer` proxy”当作组件已安装。

### 4.2 Cargo 加载也不是不执行代码的安全模式

上游明确将项目视为可信：构建脚本、过程宏以及 Cargo/工具链配置都可能引入代码执行。
关闭部分选项不能据此宣称 OS 沙箱或任意项目可安全只读分析。[上游安全边界][ra-security]

首次 Rust 授权必须在 Cargo 加载当前项目或执行项目相关命令之前，明确包含 rust-analyzer 及项目模型
访问/潜在执行；现有 TS 授权不继承。初期关闭构建脚本、过程宏和保存即 Cargo check，作为受控
功能范围；“完整构建分析”必须由用户显式开启，纳入不同的策略身份，不能被项目配置偷偷启用。
R0 要冻结此策略的协议/权限表示；若需新增声明或 manifest 权限，先完成治理与兼容审查。

首期固定宿主配置至少核对：`cargo.buildScripts.enable=false`、`procMacro.enable=false`、
`checkOnSave=false`，并由宿主管理项目重载与受支持配置。实际初始化对象的字段映射及覆盖优先级
必须用选定版本验证，不能假定只有 VS Code 的设置格式有效。[配置入口与默认行为][ra-config]

默认不 fetch、不安装 rust-src、不更新锁文件、不执行任意 check/overrideCommand。
Cargo 模型准备采用固定离线/锁定策略；依赖未缓存或锁文件需更新时给出“需准备依赖”的状态，
由显式操作解决，不能自动重试下载。Cargo 配置会合并父目录及用户目录，审查不能只看根目录一个
`.cargo/config.toml`；wrapper、编译器路径、环境和网络行为都要进入敌对 fixture。[Cargo 配置规则][cargo-config]
环境清理与 offline 参数只是控制措施，不是系统级网络/文件隔离的证明。

项目识别使用宿主已有的有界 catalog 证据，支持虚拟 workspace、多 crate、嵌套独立 Cargo 根和
Git worktree；不无界递归扫描。打开某子目录而 Cargo workspace 根位于授权目录外时，提示打开根
或另行授权，不静默扩大根目录。路径依赖和符号链接同样不能自动扩大源码读取权限。

## 5. 协议与诊断

- 从 initialize 结果协商能力，继续 UTF-16；验证 Rust 非 ASCII 标识符、emoji 前缀、CRLF/BOM
  和 LocationLink 范围。未知编码不猜测。必要的 completion resolve 采用受界定只读请求及先前
  server item 身份；不把 command/additionalTextEdits 当作可直接执行的编辑。
- 工作区配置、进度创建等 server→client request 要有明确 allowlist、数量/尺寸界限和响应，
  避免初始化等待未回应请求。进度可用于状态展示，不允许它获得文件/命令执行能力。
- 上游当前 capabilities 包含 document diagnostics provider；实现须记录**实际选定 server 版本**
  的协商结果，优先验证标准 pull。[上游能力源码][ra-capabilities] 不向 Rust 发送 TS 私有诊断命令。
- 诊断关联 session、URI、loadEpoch 和已同步的请求版本，覆盖未保存错误/修复/撤回。无版本 push
  不补盖当前版本；pull 的 resultId/相关文档也要受边界与过期检查。Cargo 的磁盘检查与未保存
  overlay 不是同一版本来源，未证明对应时分开呈现，不覆盖当前缓冲区诊断。
- Cargo/rustc 检查与 proc-macro 的完整体验在 R4 实施：取消/超时、输出上限、保存版本、构建产物
  目录、配置变更和子进程树都要有真实证据。只提供 rust-analyzer 原生诊断时必须明确范围。

## 6. 标准库和依赖源码

`String`、常见 crate 类型等目标通常不在当前 workspace catalog。R3 必须新增授权只读来源，
不能让用户以为外部跳转已完整实现，也不能将它们伪造成普通可写项目文件。

来源只接受已解析的 rust-src/sysroot、当前 Cargo 图中验证过的 registry/git dependency roots，
以及另获授权的路径依赖。用原生签发的 source handle 绑定项目/profile/工具链、规范路径和修订，
每次读取重验 containment/symlink/文件类型/大小。拒绝任意 HOME、服务器任意 file URI 和未知
`ra-macro` 等虚拟 URI。现有文件大小/编码界限继续生效，不静默截断后定位。

只读源码可以有受限的 hover/definition/reference 语义查询，但不能接受用户编辑、补全修改或保存。
明确区分“只读依赖源码”与历史/Diff/conflict：后几类不因这次扩展获得当前项目 overlay。
工具链、依赖图或源文件变化要撤销旧 handle；库内二次跳转也需要验收。

## 7. 分期、优先级与提交

| 阶段 | 优先级 | 交付与退出条件 |
| --- | --- | --- |
| R0 契约与探针 | P0 | 计划落档；冻结 profile/resource/SDK/最低宿主版本和 Rust 授权策略；记录工具链组件缺口；用可信 fixture 验证启动、实际能力、配置/子进程行为与诊断来源，不宣称功能已交付 |
| R1 宿主去 TS 特化 | P0 | 通用传输与 profile 分离；session/consent/启动锁包含 profile/策略；启动/停止一个服务不影响另一服务；同步所有校验、review、UI 文案；旧 TS/JS 和 Android 包回归通过；单独提交 |
| R2 Rust 项目内闭环 | P1 | 现有插件提供 Rust descriptor；可信组件发现、Cargo workspace 模型、加载状态、普通 Rust 编辑、定义/引用/hover/基础补全/原生诊断；真实未保存缓冲区与失效结果测试；宿主/插件各自提交 |
| R3 Rust 可用版 | P1 | 标准库/依赖授权只读源码和库内导航；本项目 `crates/`、`src-tauri/` 真实符号链路；TS/Rust 混合工作区与进程/授权生命周期；记录限制；签名安装与日志验收后才称本地可用 |
| R4 完整 Cargo 分析 | P2 | 显式策略开启的 Cargo/rustc 检查、构建脚本与 proc-macro；兼容工具链、取消/输出、产物目录、诊断来源与版本实测；不得隐式增加编辑/网络权限；另一个交付提交 |
| R5 扩展与平台 | P2 | Windows/Linux 原生证据；更多工具链/目标/features、独立文件或 rust-project 模型；内联预览、类型/实现跳转等按需求另行评审 |

R0–R3 是首个本地 Rust 可用版本的门槛；R2 仅为技术闭环。rename、WorkspaceEdit、自动 import、
formatting、macro 虚拟文档不靠“服务已经启动”顺带开启。R4 不阻塞受限可用版，但限制必须可见。
没有远端创建、push/tag/Release 授权；本次也不启动子智能体或实现工作。

## 8. 验收矩阵和资源

1. 真实 fixture：单 crate、虚拟 workspace、多 crate/嵌套根、工作树、缓存缺失、错误锁文件、
   工具链缺失和双语言项目；加载中/部分可用/失败都有可操作原因。
2. 导航：指针与旧光标不同、跨模块/跨 crate、多个定义/引用、空结果、库源码、脏目标、Unicode、
   索引中请求、编辑/切页/换项目后的迟到结果；真实 Chromium/WebKit 手势，再加原生宿主日志。
3. 生命周期：TS↔Rust 连续切换不少于 100 次，不互相杀进程；关闭 Rust 不停止 TS；刷新不反复
   授权；分别验证策略/工具链变化、显式禁用/卸载及迟到确认；所有 owned 子进程最终退出。
4. 诊断：未保存错误→修复→undo，旧版本与旧 Cargo run 不覆盖当前结果；关闭文档/换项目清理。
   不以模拟 descriptor 或只看到 provider=1 作为真实 Rust 验收。
   本项目首条固定链路为 `src-tauri/src/application/language_service.rs` 的
   `LanguageServiceProcess::start` → `crates/asterlyn-language-service/src/lib.rs`，再查引用返回
   该真实调用；另加普通 Rust crate 的未保存诊断，不用 Tauri 宏成功与否代替基础链路证据。
5. 敌对输入：工作区假 rust-analyzer/cargo/rustc、custom toolchain/path、wrapper、父目录配置、
   symlink/path dependency 逃逸、未知 URI、超大/迟到响应、server command/WorkspaceEdit 和自动下载。
   不能因为配置 off 就把有代码执行可能的 Cargo 加载标为“不执行代码”。
6. 资源：现有 2 MiB 文档、32 文档、64 outstanding、4 MiB frame、512 诊断/引用等界限先保留，
   审查双服务的总量，不能把每服务上限直接翻倍当作窗口预算。首批测量 cold load、热跳转 P50/P95、
   RSS/CPU/缓存磁盘、取消与退出；分别报告 App/RA/Cargo/proc-macro，不宣称硬 OS 内存上限。
7. 初始设计目标：2 个分析 worker、每 profile 一个服务、一次 Cargo 构建；交互请求仍有 10 秒
   界限，加载/索引独立状态与最多 120 秒的可取消等待，不能直接套插件 callback 的 30 秒隔离。
   中型 fixture 热查询 P95 目标 500 ms；本项目 RSS/加载目标在 R0 实测后冻结，超出需记录原因，
   不为了通过测试静默放宽阈值。这些是计划目标，不是已有性能承诺。
8. 质量/交付：合同/旧包与真实 helper 激活→桌面校验→registry→Rust 缓冲区→review 全链路，
   类型/构建/脚本、相关 Cargo 测试、fmt/Clippy；更新 canonical SDK/vendor 校验值及 licenses。
   原生交付继续严格签名、ZIP 备份、保留安装根身份、图标退出重开日志；只在代码实现阶段执行。

沿用现有结构化日志，为 profile 选择、工具链核验、授权复用/撤销、初始化、Cargo 加载/索引、
能力摘要、请求耗时/取消/截断及进程退出提供可区分的事件。仅记录固定原因、计数、时长和身份摘要；
不持久化源码、诊断原文、原始 Cargo/server stderr、完整路径、环境变量或凭据。验收通过日志串起
整条真实请求链路，避免只看截图或只看到 provider 注册成功。

## 9. 计划检查记录

### 实施契约 R0

采用 SDK 1.12.0、宿主 0.1.21、插件 0.2.0 作为首个双 profile 开发版本；仍不发布 Release。
Rust profile 固定工具链 1.98.1，包内 `servers/rust-analyzer/profile.json` 仅声明固定策略
`cargo-offline-no-build-v1`，宿主逐字段校验并核验资源摘要。Rust 初期不运行 build scripts、
proc-macro 或保存即 check；用户须先批准包含 Cargo 模型访问/执行可能性的 Rust 会话。
此 profile 与 TS 的进程、授权和版本时钟独立。先通过真实本项目导航，再覆盖安装供人工验收。

**最初规划时的检查记录（历史，不代表实施后的状态）：**
已审阅当时宿主/插件边界及 Rust 官方资料；只读查询了本机组件状态。当时的后续能力均未实现，
未安装/下载工具、未执行 Cargo 分析或构建脚本、未改变当前应用。实施前 R0 要固定实际 server
版本/摘要与协议探针证据；上游主分支文档只能说明方向，不能替代选定版本的验收。

[ra-binary]: https://rust-analyzer.github.io/book/rust_analyzer_binary.html
[ra-security]: https://rust-analyzer.github.io/book/security.html
[ra-config]: https://rust-analyzer.github.io/book/configuration.html
[ra-capabilities]: https://rust-lang.github.io/rust-analyzer/src/rust_analyzer/lsp/capabilities.rs.html
[rustup-env]: https://rust-lang.github.io/rustup/environment-variables.html
[cargo-config]: https://doc.rust-lang.org/cargo/reference/config.html

## 10. 本次实施结果

SDK 1.12.0 的精确开发制品已提交为 `0543766`。宿主 0.1.21 / 插件 0.2.0 已打通
Rust 固定工具链解析、独立 review/consent/session、Cargo 工作区导航、悬停、基础补全和版本化原生诊断。
纯 TS 的 0.1.0 旧包继续被新宿主接受；0.2.0 的最低宿主为 0.1.21。

实际探针还发现并修复两个不能靠 descriptor 测试发现的问题：关闭 Cargo autoreload 导致初始模型
不可用；点击时先清下划线会移除 Rust 语法 span，再做命中检测导致手势丢失。后者现在先命中再重绘，
并通过真实 Rust 源文件 + 真实服务器 + Chromium/WebKit Ctrl-click 验收。

诊断 profile 拆入独立模块，主 actor 负责通用版本/取消/生命周期；只投影固定状态和计数。
索引中的原生拒绝映射为专用 UI 状态，不再伪装为空定义。当前边界仍是工作区 catalog：
标准库/依赖的只读导航 R3、构建脚本/宏策略 R4、跨平台完整验收 R5 均未完成。

功能、性能/内存样本、已知限制和最终安装记录见
[实施验收](../benchmarks/2026-10-26-rust-language-services.md)。
