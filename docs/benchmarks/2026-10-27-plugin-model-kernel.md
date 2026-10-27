# 模型任务内核 C2a 及真实模型路径证据

日期：2026-10-27。宿主 C1 提交 `03a7a5f`，LSP 依赖声明提交 `c3afed5`。

`asterlyn-plugin-models` 是无文件系统/进程/Android/框架依赖的通用元数据核；C2b 原生附属程序和受控制品存储、C2c SDK 能力尚未接通。
不在启动路径分配模型正文、启动 JVM 或运行 Gradle；当前应用不使用这一内核提供新的语言 profile。

## 已验证

- 8 项测试覆盖已验证包/服务/依赖关系、身份/工作区/变体、两个消费者共享和独立取消、旧结果与引用拒绝、超时/故障/Drop、job/lease/单制品和聚合预算。
- 每窗口/工作区代次/生产者/服务/构建根的分析意图在输入、工具或选择变化时失效。正文不经过回调；内核只接受原生适配器计算的 digest/bytes。
- 16 个任务、64 个租约、单正文 8 MiB、聚合正文 32 MiB、任务 5 分钟；这是协议元数据预算，尚不是真实进程内存/磁盘监督实现。
- 相关 crate Clippy 全目标 `-D warnings` 通过。release 元数据样本 10,000 次 request/join/publish/resolve/release：73,979 微秒，剩余任务 0；macOS `/usr/bin/time -l` 最大 RSS 1,474,560 B。单次 CLI 观测，非 Gradle/模型正文/生产应用资源数据。

## AGP 实测

使用 boostCleaner HEAD `baa4e696e` 的独立 detached worktree，仅复制 SDK 与 flavor 选择；私有 Maven 凭据只转交内存环境。未修改原始项目、wrapper、AGP、Kotlin 或用户分支。
Gradle 8.13、AGP 8.13.2、JBR 17.0.14。阶段记录从 build-model/basic-model/variant-dependencies 到 serialize，
`:common / cleanx100Debug` 获得 8 个源码根、1 个 boot classpath、56 个实际存在的编译依赖，未解析依赖 0。
Android 插件仓库可重复的开发探针完成规范化模型 9,952 B，耗时 5,073 ms；没有安排编译/生成 task，运行选择来自实际 AGP variant。

前轮 180 秒未返回不能据此归因为 AGP API 不可用。新探针先遇到了测试副本缺少 Maven 身份、缺少 flavor 选择，以及错误假设库模块存在名为 debug 的变体；补齐输入并选择真实变体后成功。
这不证明前轮超时的唯一原因，也不证明应用已经消费模型。C3a 探针/契约在 Android 插件，仍为开发工具。

## 保留闸门

尚未交付模型工作到原生通道/SDK、持久化缓存及受控制品文件、依赖模块实际变体解析、生成源码/SDK/AAR 来源、独立 worktree 的端到端运行和实际 Java 后端消费。
Kotlin 发行/授权及混合 dirty overlays 闸门仍保留；不把模拟引用或模型解析测试称为 Android LSP 可用。

Re-run with the committed-source probe: 7,997 ms, 9,952 bytes, identical module/path/artifact counts. These two samples are not a performance distribution.
