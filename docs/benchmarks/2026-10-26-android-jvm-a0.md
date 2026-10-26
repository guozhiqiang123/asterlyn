# Android / JVM A0：独立发行与真实导入探针

日期：2026-10-26。用户已授权按计划实施并分步提交。**A0 已获得失败证据，Android 上线闸门未通过**；不能据此注册 Java/Kotlin/Groovy provider。宿主可先完成不依赖后端选择的有界传输基础。

## 环境、所有权与副作用

使用 `boostCleaner` 的 detached 测试 worktree，原始提交 `663ac36aac2ba786c0d02f20e68cddc625b4b06b`；同时准备 `FilesRecovery` worktree（`d9ca5dc4834680c299618364164868c422f1d6de`），后者尚无语义验收结果。未更改原项目源码、wrapper、AGP、Kotlin 或分支。临时 worktree 只复制 SDK 和 flavor 选择，不复制私有 Maven 凭据；一次探针启动所需凭据只在内存环境转交，不写证据。

工具和状态位于临时开发目录，**不是产品组件安装**。Gradle 使用独立 user-home 的 daemon/registry；wrapper 与依赖 caches 指向已有缓存。原用户 Gradle daemon 不属于本次工作。JDT 导入确实在测试 worktree 生成了 `.project`、`.classpath`、`.settings` 与缓存，不能把它称为只读扫描。offline 设置仍触发 JDT 自身的 wrapper checksum HTTP 查询；离线配置不等于网络隔离。

JDT 实际运行 JDK 为 Temurin 25.0.5+8；Gradle 为本机 JBR 17.0.14，项目保持 Gradle 8.13 / AGP 8.13.2 / Kotlin 2.2.0。最初注册 JDK 清单只有 JBR 17，后续另发现 SDKMAN 管理的 8/11/17/21；因此不能把 `java_home -V` 当完整工具链发现结果。

## 独立发行清单

下列 SHA-256 覆盖下载的完整归档；没有把组件打进插件或应用。上游校验值和自行计算的观察摘要分别说明，下载后自行哈希不等于正式安装信任。

| 候选 | 完整归档字节 | SHA-256 | 结果 / 依赖政策 |
| --- | ---: | --- | --- |
| [JDT LS 1.62.0 / 202610131109](https://download.eclipse.org/jdtls/milestones/1.62.0/jdt-language-server-1.62.0-202610131109.tar.gz) | 51,488,555 | `f587dafd8410633c2c2bf005e853a2bbb03cddee88933d49bfe6d9cb1cf09342` | 与发布方 `.sha256` 一致；EPL-2.0，组件 NOTICE/许可证须在产品接入时完整保留；当前仅评估 |
| [Temurin 21.0.13+9 arm64](https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.13%2B9) | 199,754,598 | `bf036b35b071bfb2f54f2c0af8ee8d88afa95ee6eb3dce02c0f94cfc2524d04a` | 与 Adoptium 元数据一致；实测不能启动此 JDT 发行的平台组件 |
| [Temurin 25.0.5+8 arm64](https://github.com/adoptium/temurin25-binaries/releases/tag/jdk-25.0.5%2B8) | 136,446,056 | `36dc14d797aaff6d89aab302cd053fdba6207dfdcf772052fa7b023a94b0e857` | 与 Adoptium 元数据一致；JDT 启动成功；不得替换项目 Gradle JDK |
| [官方 Kotlin 263.6379.0 arm64](https://download.jetbrains.com/language-server/kotlin-server/263.6379.0/kotlin-server-263.6379.0-aarch64.sit) | 360,170,749 | `ebef2e13cd4adc4ec9e04084b848000a3ec7a9d2917c64f269574ce2efe9ecad` | 发布方摘要核验；`--help` 成功，`--show-eula` 明确报 bundled EULA.txt 缺失；未伪造同意或地区 |
| [官方 Kotlin 262.9593.0 arm64](https://download.jetbrains.com/language-server/kotlin-server/262.9593.0/kotlin-server-262.9593.0-aarch64.sit) | 387,618,228 | `6ba6021a706b21e64cef33f7e2b79f187c0910320722bb2d3ed05ad1115ec43f` | 发布方摘要核验；独立配置/状态下实际 stdio 启动 1.65 秒后 exit 7：构建已过期 |
| [fwcd Kotlin LS 1.3.13](https://github.com/fwcd/kotlin-language-server/releases/tag/1.3.13) | 87,291,855 | `4fe7d71d087b307c7869036171bd9d8c6a4284cd7c25b89098b0a24eb2d9b6d2` | 从发布资产自行计算观察摘要；MIT，附带依赖许可证另审；包含 Kotlin compiler 2.1.0，不能推定兼容目标 2.2.0；真实项目 initialize 90 秒超时 |

Temurin 发行含 GPLv2 + Classpath Exception 等许可，产品如分发须逐项保留上游说明。官方 Kotlin [README](https://github.com/Kotlin/kotlin-lsp) 明确含闭源部分；不能用源码仓库 Apache 文件代替独立分发条款，也不满足当前仓库“独立开源依赖”的直接采用前提。现阶段只调查，没有产品采用决策。较新 `263.7084.0` 只检查了 ZIP 目录，未做完整下载/执行，不列为已验收候选。没有从 Android Studio 复制 JAR、索引或资产。

压缩体积本身已经说明不能把 JDK/多套服务器简单并入当前约 4.6 MB 的 LSP 插件包。安装方案、完整解压体积、许可清单、常驻 RSS/峰值、索引磁盘及并行预算在正式组件准入前仍必须补全；本次没有得到可用后端，不能声称这些预算已达标。

## JDT LS：启动和导入不等于 Android 语义可用

1. 用 JDK 21 启动时 exit 13。Equinox 日志明确指出 `org.eclipse.core.filesystem` 需要 JavaSE 25，继而多组件不能解析。这与 [README 当前写的最低 21](https://github.com/eclipse-jdtls/eclipse.jdt.ls#requirements) 不一致；以实际固定发行组件为准。
2. JDK 25 可启动，stdio 帧解析正常。控制组未正确启用 Android 支持时，返回 50 个项目节点；首轮 initialize 3.48 秒、导入约 21.57 秒。一次导入发出 329 条 `language/progressReport`、299 条 `language/status`。宿主现有 16 条普通事件队列不能照搬处理这类状态洪峰。
3. 控制组 `.classpath` 只有 JRE 与 Buildship container，没有 Android source entries。真实 `RecommendConfig.java → SharedPref`、`AppModel.java → SpellUtils`、`Drawable` 定义均为空。追加内存语法错误会产生诊断，但 **push 无 version**，且包含文件不在 classpath 的警告。这不是可用语言服务。
4. 根据实际发行的 Preferences 和内置脚本，改用真实配置 `java.jdt.ls.androidSupport.enabled=true`；此前尝试的 `java.import.gradle.androidSupport.enabled` 不受支持。正确启用后导入失败，项目数为 0。错误来自该发行 `gradle/android/init.gradle:147` 的 `setCanBeResolved(true)`：Gradle 8.13 的 `:app:testApi` 是创建时锁定用途的 Dependency Scope，不能改成 resolvable。
5. 内置脚本还注册编译/生成的 synchronization tasks，并把多个 source set 混合处理。即使修掉上述异常，也不能直接作为我们“指定变体、默认不执行生成 task”的模型方案。不能通过修改用户 wrapper/AGP 或默默 patch 上游安装文件交付。
6. 另做 AGP 8.13.2 V2 Tooling API 模型原型；首轮在 180 秒内未返回模型，未获得有效 classpath，不计通过。原型仍在临时目录；未把未验证的提取器放进生产代码。

## 后续实现约束

- A1 的公共前置：可替换的进度状态单独有界合并，响应、诊断、服务器请求保持严格容量与顺序；启动缓冲同样受控；不能单纯调大队列或超时。
- A2：独立于 JDT 旧脚本的 AGP 变体/源码/依赖模型，明确取消、网络、生成任务、模块图和只读 source attachment，再证明后端实际使用模型。
- Java 诊断：有序的当前版本校验或可证明的 pull/barrier 适配。严禁把无 version 的 push 直接盖上当前文档版本。
- Kotlin：继续比较可独立分发且符合仓库政策的后端；官方发行包启动/条款问题解决前，不新增承诺可用的 descriptor。旧版过期不通过修改时钟或替换组件绕过。
- Groovy、Gradle Groovy DSL、Kotlin DSL 尚未执行语义探针，仍未通过；不是顺带已经支持。

## 可重复验收

开发工具见 [probe README](../../scripts/probes/README.md)；有界 stdio 客户端与通用探针均不被应用引用。输出只保留元数据，真实目标必须匹配才能 exit 0；无版本的 dirty diagnostics 不通过一致性闸门。回归覆盖 UTF-8 分帧、重复/超限头、混合 JSON-RPC、spawn 失败回收、日志正文脱敏和“50 节点 + ServiceReady + 空定义仍判失败”。

提交前用当前通用探针再次运行正确 Android 配置，14.60 秒完成，项目数 0、实际定义不匹配，按预期 exit 1；[脱敏机器摘要](2026-10-26-android-jvm-a0-evidence.json)。4 项探针回归测试通过。

本阶段没有编辑器功能、键盘/可访问性或原生安装验收，没有打包/覆盖现有应用；本机仍为已经验收的 TS/JS/Rust 版本。验收摘要不能替代失败的功能证据。
