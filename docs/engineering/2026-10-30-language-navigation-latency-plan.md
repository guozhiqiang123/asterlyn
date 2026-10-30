# 声明点击与引用选择延迟优化

日期：2026-10-30。目标是降低真实请求耗时，保持完整语义结果和版本正确性。

复现：boostCleaner 的 `common/src/main/java/com/swiftcleaner/lib/storage/GlobalConfigNew.kt`，Command+点击 `object GlobalConfigNew` 的名称。用户体验约 2–3 秒才出现引用选择。

| 阶段 | 工作 | 验收 | 状态 |
| --- | --- | --- | --- |
| N0 | 同位置分解定义、引用、Java/Kotlin 查询和界面总耗时 | 使用独立进程与日志，不写业务源码；记录首查和连续查询 | 已完成 |
| N1 | 按瓶颈消除重复工作、并行独立查询；必要时优化候选发现 | 不跳过跨语言或模块结果，不以同名文本代替语义确认；有取消和版本边界 | 已实施 |
| N2 | 增加可定位延迟的分阶段调试日志与回归 | 默认不开明细；记录耗时/计数，禁止源码或符号正文；无修改与有修改场景 | 回归通过 |
| N3 | 插件包联调、真实位置前后对照、签名覆盖安装 | 结果集合一致，类型/方法和跨语言回归通过；严格验签及两次图标启动 | 已完成 |

宿主保持通用；Android 查询优化留在 LSP 插件。缓存只可绑定当前模型、分析 revision 和文档版本，有数量/空间/时效上限；不持久缓存引用结果。冷 JVM 与热查询分别记录，不承诺尚未测得的延迟。已有 hover 移除改动单独保留。

## 实施与当前证据

插件 `df82c0c` 将 selected module 依赖闭包的语义准备移至 indexing，在既有 JVM 预算内完成；.4 Kotlin 组件对共享 BindingContext 去重。Java/Kotlin 引用查询并行，失败取消并排空；当前编译器快照可直接提供简单类声明的名称范围，避免额外启动模块 JVM。定义交接、Java 声明锚点查询有代际/版本/容量/取消边界，不持久缓存引用。宿主只更新打包插件及现有功能入口测试。

- 指定 GlobalConfigNew 对象：原生旧客户端定义 33ms、引用 4765ms，重复引用 806ms；返回 69 个引用。
- 接受的 0.3.10 解包运行：索引就绪后首次定义加引用 437ms，重复 187/142/134ms；四次 URI/范围集合摘要完全一致，69 个引用，源码未写入。进程树峰值约 1.83 GiB。该轮总准备 167.7 秒含 KAPT 冷工作，不能等同于热启动时长。
- 语义准备本机样本 18.9 秒，工作提前到 ready 前，不是消除了分析成本；切模块、编辑、依赖变化或 JVM 重启仍可能触发新的分析。
- 包 SHA-256 `129016416a6f887df16a44d51ae5d2eea3b01e7694b58908a3aec340e52defc7`，4,662,317 字节；组件 .4 两次构建完全一致，摘要 `5ca0323ccef08625a87dba1155482617c7c5018e52975ef2ec8074e1d48e9f0d`，无新增依赖。
- 插件 22 项单测、接受包 14 项完整语义及 9 项增量/引用回归、宿主 1366 项脚本、类型检查和真实包激活通过。
- 新原生 app 已构建、完整 ad-hoc 签名并严格验签。macOS 锁屏，尚未进行新客户端真实点击、原生 smoke 及覆盖安装；安装客户端仍为先前已验收版本，不提前标记交付完成。

证据：`/tmp/asterlyn-navigation-accepted-performance.json`、`/tmp/asterlyn-navigation-packaged-semantics.json`、`/tmp/asterlyn-navigation-packaged-incremental.json`；永久探针位于插件 `scripts/test-android-navigation.mjs`。

## N3 原生完成记录

用户解锁后完成真实 Command+单击：源码第 6 行 GlobalConfigNew 名称（LSP 第 5 行 character 14），首次定义 22ms、引用 585ms，连续定义 11ms、引用 327ms；两次弹窗均为 69 个引用，未编辑源码。新原生程序的 0.3.10/0.6.3 精确插件包 knownGood；语言服务无错误。进程树后段采样峰值 1,985,840 KiB，KAPT 最多 2、Kotlin JVM 最多 2。历史无效最近项目路径的 `existing_project_directories` 两条既有错误仍不属于语言服务故障。

严格签名、完整 ZIP CRC/SHA、标准安装器覆盖均通过。`/Applications/Asterlyn.app` device/inode 16777234/203606126 保持不变，只保留 ZIP 备份；两次 icon-bookmark 启动均 frontendReady。最终安装客户端自动恢复到语言服务 ready，调试明细事件为 0、语言错误为 0，严格验签及可执行文件摘要一致。可执行文件 SHA-256 `0154c1be12a1f3329ea7e22804be51ca684a978d786a2ce5cb491101bb7b0e29`。

本地验收归档 `/Users/gzq/PrivateProjects/asterlyn/target/release/bundle/macos/Asterlyn-0.1.22-navigation-latency-macos.app.zip`，25,295,707 字节，SHA-256 `2ae05d1b7a372bd23b8d388e6f890dde0d49dea71e3052a3fde66b0daaab3739`。

追加证据：`/tmp/asterlyn-navigation-native-health.json`、`/tmp/asterlyn-navigation-native-clicks.json`、`/tmp/asterlyn-navigation-native-resources.json`、`/tmp/asterlyn-navigation-install/installation.json`。本轮交付完成；新进程需要语义准备、未打开模块/源码或依赖变化仍可触发分析，这些冷路径不承诺同样延迟。
