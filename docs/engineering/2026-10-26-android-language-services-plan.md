# Android / JVM 语言服务兼容计划

- 日期：2026-10-26；状态：**实施已获授权；A0 探针已执行，上线闸门未通过；A1 通用前置分步推进**。
- 基线：宿主 `d9dfffd`，已安装代码 `96c73fe` / Asterlyn 0.1.21；SDK 1.12.0；LSP 插件 0.2.0 / `2237b3d`。
- 目标：为真实 Android Gradle 项目提供 Kotlin、Java、Groovy 和构建脚本的语义服务，复用既有编辑、导航、日志和插件边界。
- 原规划回合未执行工具/Gradle；后续用户已授权实施。当前执行与失败闸门见 [A0 记录](../benchmarks/2026-10-26-android-jvm-a0.md)。未通过真实语义闸门的 profile 不进入 SDK/插件；不发布远端。
- 插件侧执行计划：[android-support-plan.md](../../../asterlyn-plugin-lsp/docs/android-support-plan.md)。规范边界仍为 [ADR-0034](../architecture/decisions/0034-plugin-language-services.md)。

## 1. 决策与首版范围

沿用 `dev.asterlyn.lsp`，按实际后端能力增加宿主认识的 JVM profile。Android/Gradle 插件继续负责 Run、Tasks、Devices 和 Android 语义选择；不把语言请求塞入其任务扫描回调，不新增插件间 RPC，也不依赖 Android Studio 私有协议。

先验证引擎和真实 Android 模型，再补宿主 JVM / 项目导入基础，随后依次交付 Java、Kotlin 和构建脚本。Kotlin 与 Java 的候选验证在 A0 同时进行；Java 的较小闭环先交付，不表示放弃 Kotlin 或双语言项目。若 A0 证明单一后端能合法、独立、完整处理两种语言，应优先减少重复索引，而不是机械地启动两个 JVM。

首个可用闭环包括：项目内和跨模块 Ctrl/Command-click、F12、引用选择、纯文本 hover、当前文件基础补全、当前版本诊断。Android SDK / 依赖源码读取是完整 Android 验收的前置能力；仅完成项目内 Java 跳转时必须标为局部里程碑。

XML 布局、Manifest 和资源引用另设 Android 资源阶段；TOML 版本目录、properties、NDK/C++、调试器、Compose 预览、重构和自动 import 不隐含在前三种语言接入中。

## 2. 上游候选与尚未通过的闸门

以下是查询当天的调查结果，不是已经选择并安装的发行版。A0 必须冻结具体版本、资产 URL、SHA-256、许可证/NOTICE、运行要求、压缩/解压体积和实测协议。

| 用途 | 优先调查的独立上游 | 本次确认 / A0 的关键验证 |
| --- | --- | --- |
| Java | [Eclipse JDT LS][jdtls] | 上游声明 Gradle 与实验性 Android 导入，README 要求至少 Java 21；实际所选版本的运行要求仍需核验。验证 AGP 8.13.2、AAR、变体、source attachment 和无源码状态 |
| Kotlin | [JetBrains Kotlin LSP][kotlin] | 官方项目仍为 Alpha，包含闭源部分，Android 导入为实验性。仓库的 Apache-2.0 文件不能代替独立二进制及其附带组件的条款检查 |
| 普通 Groovy / buildSrc | [GroovyLanguageServer][groovy] | 公布 stdio、定义/引用/补全和 classpath 配置；不能据此认定其自动理解 Android Gradle DSL。核验 Groovy/JDK 版本和维护、分发情况 |
| Groovy Gradle DSL | [Microsoft Gradle for Java 的服务器部分][gradle-ls] | 有脚本 classpath、DSL 补全和诊断能力描述。必须证明服务器能独立于 VS Code 客户端使用，不能照搬扩展 UI/命令协议 |
| Kotlin Gradle DSL | Kotlin / Gradle 候选的实际脚本模型 | `.gradle.kts` 的 Gradle 访问器、插件和脚本依赖单独验证；`.kt` 支持不等于脚本语义支持 |

[Kotlin 发布说明][kotlin-releases]列有 `263.6379.0`，并说明这些是周更 pre-alpha 构建；只作探针候选。新版启动入口改为 `bin/intellij-server`、运行要求 JDK 25；官方客户端还出现地区/数据选项。必须实测独立服务的启动及隐私选择，不能默认同意、伪造地区或把 VS Code 专用行为当通用 LSP。

[Gradle 扩展变更记录][gradle-ls-changes]显示服务器合并与本地 pipe/socket 传输演进。因此 A0 需分别确认 LSP 通道、构建模型通道及生命周期；当前宿主只有 stdio 基础，不能把所有渠道都假定为 stdio。确需本地 IPC 时，应另审宿主拥有的私有通道、访问控制和清理，不能给插件任意 socket 地址权限。

备选社区实现须另做同样探针。不自动替换后端，不用 Android Studio 安装目录中的 JAR、索引、图标或插件补缺口。若某候选与仓库依赖政策、独立分发或运行条件不符，记录失败原因后比较替代方案，不提前绕过要求。

## 3. 本机验收目标与版本矩阵

只读检查 wrapper / 根构建文件 / 版本目录，并用 `fd` 统计非忽略、非 build 源文件，得到以下规划样本。没有执行 Gradle；字面版本不是已经成功导入的证据，分支或 worktree 变化后需重采样。

| 项目 | Gradle wrapper | 观察到的 AGP / Kotlin 字面量 | 非忽略 Kotlin / Java 文件 | 用途 |
| --- | --- | --- | --- | --- |
| `boostCleaner` | 8.13 | AGP 8.13.2 / Kotlin 2.2.0 | 902 / 3,670 | 首个大型混合语言 Android 验收 |
| `FilesRecovery` | 8.13 | 版本目录 AGP 8.13.2；Kotlin 精确值在 A0 解析 | 943 / 1 | Kotlin 为主、多模块和多 flavor 验收 |
| `dbloodSugar_vestbag` | 8.13 | AGP 8.13.2 / Kotlin 2.2.0 | 486 / 486 | 双语言回归、不同项目和独立缓存 |

三个项目均发现 Groovy 根构建文件；已有脚本数量不代表语义支持。还要补最小 `.gradle.kts`、`buildSrc` / convention plugin、included build、缺依赖、无 SDK、纯 Java、纯 Kotlin 和两个 worktree 的测试夹具。

必须区分：**LSP 运行 JDK、Gradle daemon JDK、源码/编译 toolchain、Android boot classpath**。官方兼容表中，JDK 25 运行 Gradle 从 9.1 起受到支持，不能把 Kotlin 服务的 JDK 25 直接用于这些 8.13 项目。[Gradle 兼容表][gradle-compat]、[Android JDK 说明][android-jdks]

不为适配语言服务器擅自升级项目 wrapper、AGP、Kotlin 或 source/targetCompatibility。先明确每个进程的实际 Java 路径和版本；缺少兼容 JDK 时显示原因，不反复下载或启动失败循环。

## 4. 宿主基础与所有权

### 4.1 Profile、语言路由和协议

当前 SDK/校验只承认 TypeScript 和 Rust；语言路由、原生 `document_language`、包资源与 review 都仍有固定分支。新增 JVM profile 前统一 profile 描述、选择、启动策略、诊断和日志接口，避免继续扩张 App 或通用 actor。

| 文件类别 | 计划中的唯一主提供者 | 规则 |
| --- | --- | --- |
| `.java` | 已验收 Java 后端，或经 A0 证明的统一 JVM 后端 | 不能与另一个 Java 服务同时拥有文档 |
| `.kt` | 已验收 Kotlin 后端 | Android source set / 语言版本来自模型 |
| 普通 `.kts` | 经验证的 Kotlin script 能力 | 不因 `.kt` 支持而默认宣称可用 |
| `.groovy` | 普通 Groovy 后端 | 与 Gradle 嵌入 Groovy 的版本区分 |
| `.gradle` | Gradle Groovy DSL 后端 | 不落到普通 Groovy 后就宣称完整支持 |
| `.gradle.kts` | Gradle Kotlin DSL 的已验收后端 | 复合后缀优先于 `.kts`，无支持时明确降级 |

宿主使用确定的最长后缀 / 已知文件类别路由，不接受插件任意正则或任意优先级抢占。SDK、native package/helper 投影、desktop validator、registry、编辑器和执行 review 必须同步验收；只改扩展名列表不算接入。拟用增量 SDK minor（1.13 或后续实际版本）；编号、profile ID 和资源布局由 A0 冻结，本计划不 bump。

JVM 启动器固定已验证的真实 Java / server 资产、平台配置、参数、环境和可写缓存目录；区分 JDT LS 数据目录与只读分发配置。每个窗口/worktree 的未保存状态独立，不能共享可变 JDT workspace 或 server 索引目录。

按选定引擎逐项实现有界 `workspace/configuration`、progress、能力登记或必要的只读扩展请求；不把所有 server requests 一律开放。变更文件、任意 executeCommand、rename、WorkspaceEdit 和资源操作仍按现有规则拒绝。未知或不支持的能力有明确状态，不导致整个 LSP 插件被隔离。

### 4.2 Gradle / Android build context

新增宿主拥有的构建上下文协调器：管理导入工作、模型身份、取消、缓存状态和向多个语言适配器的有界投影；不让每个插件分别猜 classpath。Android 插件可贡献模块/变体语义选择，LSP 插件不直接读取另一个插件的状态；经宿主的只读契约沟通。禁用 Run/Tasks 插件不应导致普通代码编辑失效。

模型至少要分清 build root、module、选定 variant、main/test/androidTest 与 flavor source sets、模块依赖、Java/Kotlin 语言设置、Android SDK / boot classpath、JAR/AAR、已存在生成源码和脚本 classpath。**任务列表和 assemble/install 名称不能替代模型**。以所选 AGP 支持的模型/接口获取语义，不把 AGP 内部 task 名作为稳定 API。[Tooling API][gradle-tooling]、[AGP 扩展说明][agp]

共享构建身份不代表上游一定能消费同一份外部 JSON 模型。A0 必须证明各后端接受哪些模型/导入接口；若必须各自导入，则统一调度、约束并发并验证变体一致，记录重复成本，不能声称已完成“一次同步服务所有引擎”。不先建设无法被服务器消费的庞大中间模型。

长导入使用异步 job ID、进度、订阅和取消；不占用 isolated plugin callback 锁，不把 10/30 秒的文档请求 deadline 全局拉长。模型持久化为原子、版本化缓存，分页/引用传输大 classpath；结果截断或超限必须标为不完整，不用无限扩大 activation evidence / result payload。

| 身份 | 应包含 | 不能误用 |
| --- | --- | --- |
| 执行信任 | canonical project/build root、wrapper/工具/服务器与策略身份 | 普通文件编辑、每次索引 generation 不触发重复授权 |
| 导入缓存 | 构建/设置/版本目录指纹、工具链、选定变体、适配器版本 | task cache、mtime 或项目显示名不能作完整模型身份 |
| 进程/索引 | window、worktree、workspace activation、server profile、模型上下文 | 两个 worktree 或窗口的可变索引不混用 |
| 请求/诊断 | session、URI、文档版本、model generation；跨语言 overlay 状态 | 变体切换后旧结果、另一个文档的未保存依赖变化不能误作当前结果 |

变体必须来自验证模型，选择可记忆但重新校验；不盲选 `debug`，也不把设备选择视为语义变体。切换时保留编辑/撤销，撤销旧诊断和在途结果；根外 included build 需要单独授权的来源，不偷偷扩大工作区编辑范围。

### 4.3 依赖、SDK 与跨语言未保存内容

先补通用只读来源能力，供 Android 和后续 Rust R3 共同使用：已验证 JDK/Android SDK sources、模型关联的 source JAR、工作区生成文件和受控的服务虚拟文档。来源 token 绑定 owner/root/model/依赖身份，验证 archive entry、路径、大小、编码和行号；不把 `jar:`、`jdt:` 或 server 返回的任意 URI 直接交给文件系统。

外部源码编辑器只读，不能保存、重命名或自动加入项目；缺少源码时解释状态，不静默联网下载。还要补只读源码中的继续导航能力，因为当前 read-only 会关闭语义 overlay。反编译、source attachment 和 SDK 源码映射按实际后端协议单独验收。

混合 Kotlin/Java 的难点必须前置：JDT LS 不会因为 Kotlin server 同时启动就天然拥有 Kotlin light classes / 源码映射；双向定义、引用和未保存依赖解析需实证。后端如需同窗口其他语言 overlay，只镜像经批准文档并保持唯一编辑所有者，不把 dirty 内容写到磁盘供另一服务读取。无映射时不得用符号名搜索伪造精确跳转。做不到的方向明确标为部分支持。

## 5. 执行、生成代码与资源预算

Gradle 项目导入会配置项目并执行构建逻辑；离线或 dry-run 不等于只读/不执行。复用宿主项目信任设计，但新增明确的模型导入语义操作与固定适配器，不借“扫描 tasks”权限携带任意 init script 或参数。review 要说明 Gradle、构建插件、缓存/输出写入、已有 init/config 和可能的网络访问。

默认不构建 APK、不运行测试、不隐式执行 KAPT/KSP、annotation processor、编译器插件或源码生成任务。仅索引已有生成物；模型导入自身仍可能执行配置逻辑，这与“不派发生成 task”分别说明。缺依赖时先显示部分可用；依赖下载、SDK/源码安装和额外构建各走明确的用户动作及策略。不要让 LSP 自动构建和 Android Run 相互争抢。

取消只影响本次导入及自己拥有的进程/通道，不执行全局 `gradlew --stop`、`pkill java`，不停止 Android Studio 或其他项目的 daemon。A0 比较独立分析 daemon/缓存与复用策略，证明所有权与取消边界后再落实现；关闭服务不代表有权杀掉所有共享 daemon。

按需启动打开文件所需的引擎，初始建议最多同时保有两个 JVM 语言后端、一个重导入 job；实际 JVM heap、总预算、空闲回收和超时由 A0 实测冻结。JVM heap 上限不是进程 RSS 上限，记录 server、Gradle、索引/缓存和子进程的峰值；不能把当前全局 8 会话计数当 Android 内存预算。回收后保留仍有效的会话授权，避免每次切文件重复弹窗。

## 6. 分阶段实施与提交

每阶段先冻结契约，再做小提交；通过则交付，失败则保留证据和能力降级，不将服务器启动/descriptor 注册视为语义功能通过。

| 阶段 / 优先级 | 交付与责任 | 完成标准 |
| --- | --- | --- |
| A0 / P0 选型探针 | 宿主与 LSP 仓库：Java/Kotlin/Groovy/Gradle 候选、发行/条款、JDK 矩阵、真实协议、模型与 variant 接口 | 至少一个真实 Android import + Kotlin/Java 双向可行性报告；冻结发行摘要、进程关系、已知失败项及后续能力范围 |
| A1 / P0 JVM 宿主基础 | 宿主：profile 策略、JDK 分工、唯一文档路由、有界 JVM 数据目录/启动、长 job、必要 client requests、状态/日志 | missing JDK、拒绝授权、过期结果、关闭/取消、双 worktree/窗口、TS/Rust 回归；契约改动对应 SDK + native/desktop 全链路测试 |
| A2 / P0 Android 构建上下文与来源 | 宿主为主，Android 插件参与语义契约：模型、变体、模块/依赖、只读来源、导入调度/缓存 | 真实项目 selected variant 一致，AAR/SDK/多模块有效，缺依赖与过期缓存可见；任务扫描/Run 不回退 |
| A3 / P1 Java Android 闭环 | LSP descriptor + 宿主 Java 适配 | boostCleaner 的真实 Java 跨模块/依赖/SDK 导航、引用、hover、基础补全和未保存诊断；索引/部分可用状态准确 |
| A4 / P1 Kotlin Android / 混合语言 | LSP descriptor + 宿主 Kotlin/overlay 适配 | FilesRecovery 与混合夹具；Kotlin↔Java 两方向及 dirty overlay、语言版本、变体切换；不能只以普通 JVM demo 验收 Android |
| A5 / P2 Groovy 与 Gradle DSL | 普通 Groovy 和两种 Gradle DSL 分别接入 | buildSrc/convention plugin；`.gradle` 的插件 DSL 与脚本 classpath；`.gradle.kts` 的访问器单列探针/验收，缺失则显式部分支持 |
| A6 / P2 Android 资源与生成代码 | 独立资源适配及显式生成策略 | Manifest/layout/strings/XML 与 R/BuildConfig/Binding/Compose/KAPT/KSP 分项；资源导航不能由通用 XML 或语法高亮冒充 |
| A7 / 每个可用阶段收口 | 两仓库包验收、宿主签名和本地安装；最终性能/平台矩阵 | inspector→helper→validator→registry→真实 buffer→真实服务→真实鼠标/键盘→原生日志；兼容/回滚、安装图标重开和用户验收 |

交付优先级不把 Kotlin/Java 双语可行性推迟到 A4 才发现：若 A0 已发现阻塞，先调整后端/能力范围再建设公共协议。A3/A4 可分别形成可验收版本；未通过 A4 时不宣称整个混合项目已完整兼容。

## 7. 必须保留的验收矩阵

- Ctrl/Command-click、F12、单结果直接跳转、多结果筛选/键盘选择、Escape、焦点返回；覆盖有语法高亮的 token、中文路径、BOM/CRLF、非 BMP 字符。
- 同/跨模块、Kotlin→Java 与 Java→Kotlin、重载/扩展函数/顶层声明、同名类不同 source set；已保存和未保存依赖变更，源/目标 dirty buffer 均不覆盖磁盘。
- SDK 类型和 AAR/source JAR；没有 sources、生成物不存在、版本不匹配、根外路径、恶意 archive entry、无效位置和过大诊断有确定结果。
- flavor/debug/release/test/androidTest、included build、外部工作区根、worktree、切项目/变体/服务更新、disable/uninstall、只读依赖继续导航与撤销。
- 索引中不显示“没有定义”；冷导入进度、取消、失败重试有界；语法诊断、类型诊断和 Gradle/构建失败有不同来源，不能冒充完整编译结果。
- 并存 TS/Rust；一个 JVM 后端崩溃只影响相应能力；冷/热跳转和导入 p50/p95、取消耗时、idle CPU、峰值 RSS、索引磁盘、重复切换后的保留内存都有日志证据。A0 测量后冻结预算，暖跳转目标暂定 p95 ≤ 500 ms，不作为当前已达成结果。
- 不改目标项目构建文件来迁就 server。探针优先使用可恢复测试 worktree；记录 Git 状态、生成/缓存写入、网络与项目脚本副作用，不能只断言源文件内容没变。

## 8. 日志、失败回退与本次检查

复用结构化日志，串联 project/build root hash、profile、operation/session、model generation、阶段、variant 标识摘要、计数、耗时、请求丢弃/取消原因及资源样本；只持久化固定 reason code。server 的原始 classpath、URI、诊断正文、Gradle stdout/stderr、仓库凭据、环境和源码不落常规日志；必要输出先过滤、限长并单独受控导出。

UI 分清缺工具、等待授权、同步中、索引中、可用、部分可用、需要同步、失败。构建文件变更使模型过期，不反复启动整个插件；模型旧结果不能覆盖新变体。已有缓存需标注 stale，在支持明确一致性前不能当当前权威。

原规划回合已完成 CodeGraph→定点源码/文档检查、官方候选文档核对和三个本机项目的只读版本/文件类型采样。尚未运行任何 JVM LSP、Android 语义请求或 Gradle 导入探针；不存在 Android 实现、性能达标或安装验收结论。本次文档检查仅做 diff/链接校验，不为文档变更重新打包应用。

[jdtls]: https://github.com/eclipse-jdtls/eclipse.jdt.ls
[kotlin]: https://github.com/Kotlin/kotlin-lsp
[kotlin-releases]: https://github.com/Kotlin/kotlin-lsp/blob/main/RELEASES.md
[groovy]: https://github.com/GroovyLanguageServer/groovy-language-server
[gradle-ls]: https://github.com/microsoft/vscode-gradle
[gradle-ls-changes]: https://github.com/microsoft/vscode-gradle/blob/develop/CHANGELOG.md
[gradle-compat]: https://docs.gradle.org/current/userguide/compatibility.html
[gradle-tooling]: https://docs.gradle.org/current/userguide/tooling_api.html
[android-jdks]: https://developer.android.com/build/jdks
[agp]: https://developer.android.com/build/extend-agp

## 9. 实施记录（2026-10-26）

A0 已完成独立发行下载核验、JDT/JDK 启动、boostCleaner 测试 worktree 导入/实际定义/dirty 诊断与 Kotlin 候选启动探针。结果与原规划回合的只读调查分开，见 [A0 证据](../benchmarks/2026-10-26-android-jvm-a0.md)。当前结论为上线闸门未通过，不把 Java/Kotlin/Groovy 注册成可用 provider。先交付可重复失败探针和不依赖后端选择的有界传输基础；A2 模型与 Kotlin 后端问题仍需解决。

A1a 已实现 reader/初始化缓冲的固定槽状态合并、严格普通事件容量和非阻塞终止投递；现有 TS/Rust 实际 transport / actor 回归通过。见 [A1a 记录](../benchmarks/2026-10-26-jvm-transport-foundation.md)。A1 的 JVM/JDK 绑定、客户端请求与启动取消仍未完成。

## 10. 职责修订（2026-10-27）

后续实施以 [插件模型协作计划](2026-10-27-plugin-build-model-cooperation-plan.md) 和 ADR-0035 为准：Android 插件拥有 AGP/变体/依赖模型，LSP 插件拥有后端适配，宿主只补通用运行基础。用户确认 LSP 整体启用时 Android 插件不可关闭，先交付通用强依赖门禁。此前 A0/A1a 证据仍有效，不表示 Android LSP 已可用。
