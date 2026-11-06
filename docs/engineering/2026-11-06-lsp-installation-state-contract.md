# LSP 安装状态与事务边界

本步为 F0.4/F0.5，延续[基础实施记录](2026-11-06-lsp-foundation-contract.md)。用户授权继续实施及分步本地提交；本步不选择上游、不安装真实服务、不发布远端。

## 所有权

`asterlyn-language-service::management` 是受管语言工具的原生状态所有者，与现有项目语言会话分开。目录声明不是安装回执，安装回执不是语义就绪或执行批准。插件仍无直接网络、文件系统或进程权限。

现有 `asterlyn-plugin-analysis::components::verify_component` 可在 F2 适配器中复用完整性/不可变文件校验；不能把其只读回执检查当作已有下载、原子提交或卸载事务。F0 定义存储和制品验证端口并用可丢弃夹具验证失败边界；真实下载、安全解包、持久化锁和 IPC 路由留给 F2。

## 本次实施范围

1. 原生定义精确服务/制品身份、持久索引 schema、瞬时任务/快照和固定错误类别；生成前端类型及严格运行时校验。版本、target、recipe/archive/content 摘要分别绑定，不在客户端传任意路径、URL、shell 或启动参数。
2. 原生管理审查绑定窗口激活代际、插件版本/包摘要、制品和索引 revision；有时限、单次使用。安装授权与现有项目执行批准分开，旧插件批准不能授权新制品。
3. 单个服务同时仅一个安装/删除任务；任务进度有序、失败/取消保留旧选择。新制品验证并成功提交索引后才显示已安装；更新保留旧选择为回退。
4. 使用租约保护实际服务制品。卸载先阻止新租约，等待旧租约释放，再提交移除；回退版本、外部工具不能由普通卸载删除。禁用/换包取消其安装工作，不提前释放仍可能被进程使用的租约。
5. 恢复索引时不恢复批准、任务或租约；制品先标记待验证，不能根据索引 JSON 直接标记可运行。存储错误、制品损坏、缺少安装事实与真正未安装必须区分。
6. 前端只组合经过验证的快照与目录候选来决定提示动作，不能根据空快照、偏好或执行失败猜测“未安装”。真实底部栏接线仍属于 F1。

## 初始数值界限

全局最多 64 个安装制品、64 个服务选择、8 个并发管理任务、32 个待确认审查、128 个使用租约；任务终态保留至多 16 个。审查有效期 5 分钟。索引/快照 revision 和字节数不超过 JavaScript 安全整数范围；下载计划最多 512 MiB、展开内容最多 2 GiB。超限返回固定错误而非静默截断或驱逐活动状态。

管理请求暂为原生内部 API；未来 `managedLanguageServers` / `host.managed-language-servers.manage` 是保留名称，本步不加入已支持 capability/permission 列表，不升级 SDK 1.15.0，也不让旧/新插件调用尚未完成的安装器。F2 接通实际端口和路由时再整体准入、生成 SDK 并验证旧宿主拒绝。

## 验证计划

原生测试覆盖审查过期/重放/换窗口/换包/禁用、并发重复、阶段跳跃、校验/存储失败、取消后的迟到完成、更新回退、多窗口租约、活动版本卸载、外部工具保护、恢复后重新校验、索引损坏和所有固定上限。前端以原生生成形状校验恶意/未知字段、安全整数和关联关系，再测试推荐决策。实际磁盘掉电恢复、真实服务器资源与 UI/无障碍验收不由本次内核夹具代替。

## F0.4 原生内核验收

实现位于 `crates/asterlyn-language-service/src/management/`，原生生成的安装索引/状态类型纳入现有 `protocol:native:check`。协议新增严格模式，不改变旧语言服务输出允许附加字段的兼容行为。Rust 验证制品 ID 与全部身份字段的哈希绑定；前端校验有界形状、枚举及关联关系，不在 WebView 重做制品哈希或磁盘完整性验证。

`protocol/fixtures/managed-language-installation.json` 的 41 例由 Rust 与前端共同消费（8 正例、33 反例）。新增 23 项原生测试，含共享语料、错误注入和边界状态；带 bindings 的原生库完整 62 项测试通过，Clippy `-D warnings` 通过。安装协议与旧协议专项脚本合计 48 项通过，类型检查及原生协议漂移检查通过。索引 revision 耗尽会终止任务且不写存储；当前版本已卸载时再次安装仍保留已有回退。

本步没有实际存储适配器、网络下载、进程启动、定时器或新增线程；只持有上述有界状态。原生单元测试耗时约 0.25 s，不将其当作磁盘事务、RSS 或真实服务器性能数据。没有 UI 变动或无障碍控件，本机应用/插件没有替换。真正的持久化、断电恢复、退出清理和进程租约接线必须在 F2 验收；`restore` 用于新宿主生命周期，不能在旧进程仍存活时丢弃其租约并重建状态。

原生内核及协议已提交于 `3969b7a`；边界文档先提交于 `9f5071e`。

## F0.5 安装事实与推荐判断

`ManagedInstallationFacts` 不发起 I/O；由未来桥接层持有。每次读取获得本地唯一请求凭据，旧请求、重复回包和其他实例的请求不能覆盖当前事实。读取期间为 checking，失败/非法输出/倒退 revision 为 unavailable；不以空数组代替错误。接受后复制并深层冻结。项目切换、插件激活代际或连接变化必须调用 `reset`，旧原生 epoch 不能跨连接自动延续。这一约束已有纯状态测试，真实事件接线仍待 F1/F2。

`recommendManagedInstallation` 合并目录选择、已验证事实、原生 target 与精确提供者的配方可用证据，返回显示判断：检查中、状态不可用、安装中、卸载中、待校验、已安装、可恢复或可安装。目录未选中时不推荐；未提供当前配方可用证据时没有安装入口。已有回退/未选择历史/外部内容进入检查或恢复，不自动选择；安装失败不抹掉当前版本。已安装不代表已批准执行或语义已就绪；管理历史错误仍保留在快照中供后续界面展示，不据此伪造缺失。

14 项专项测试覆盖推荐分支、跨插件身份、不可变输入、旧请求/代际隔离及失败状态。最终全量脚本测试 1,595 项、原生库 62 项通过，类型检查、生产构建、Clippy 与原生协议漂移检查通过。SDK 保持开发版 1.15.0，独立 LSP 插件未修改，也未增加 management capability。

合成基准可用 `node --expose-gc scripts/benchmark-managed-language-installation.mjs` 复现，原始结果见 [安装状态基准](../benchmarks/2026-11-06-lsp-installation.json)：macOS arm64 / Apple M2 Pro / Node 26.8.1，64 制品、64 选择、8 活动任务、16 终态、128 租约；3 轮各 300 次。快照校验/复制/冻结 p95 最高 0.642 ms，推荐判断 p95 最高 0.012 ms，GC 后堆增量最高 128,000 bytes（含 V8/JIT 噪声）。预算分别 25 ms、5 ms、16 MiB，全部通过；这些结果只测内存状态处理，不代表 WebView/RSS、下载、安全解包或实际语言服务消耗。

F0.5 本批次止于内部基础：当时没有真实安装按钮、下载/存储适配器、IPC、恢复命令、可执行 profile 或实际进程租约接线，不能以单元测试代替 F1 的底部栏与键盘/无障碍验收、F2 的真实事务验收。后续 F0.6 已冻结命令/运行预算，F1.2 与下述 F2.1 已补只读接线和持久索引基础；真实管理事务边界仍保持关闭。

## F2.1 私有索引与只读恢复路径

`5d24193` 增加 `ManagedInstallationIndexStore`。索引固定为应用私有 `managed-language-tools-v1/installation-index-v1.json`，上限 256 KiB；未知字段、损坏 JSON、越界模型、非普通文件、符号链接根目录/索引均失败关闭。Unix 专用目录权限收敛到 `0700`，读取使用 no-follow；写入在同目录暂存、刷盘、原子替换并同步目录，Windows 使用 replace-existing/write-through。提交必须在锁内重新读取 durable revision，并且只接受 `expected + 1`，旧 revision 返回 `state-changed`，不能覆盖更新状态。

该 store 只拥有权威索引的读取与 CAS，故意没有冒充完整 `ManagedInstallationStorage`：真实安装适配器仍须先安全发布已经校验的不可变内容，卸载须先把旧内容隔离到唯一 tombstone，再调用索引提交。缺少内容事务时不开放安装/卸载管理命令。

`e00e0f3` 在桌面宿主启动时只创建一次协调器，从私有索引恢复选择，并为当前进程生成新 epoch；批准、任务、验证和租约不会跨进程恢复。宿主只接受目录已定义的六种 OS/架构组合，并映射到精确 target；未知组合拒绝。索引/平台初始化失败被隔离为“受管安装事实不可用”，只读命令返回固定错误，但不阻断应用、基础编辑或 Git 启动。只读环境命令不扩大插件权限，前端收到的快照仍把恢复制品标为待校验。

持久索引 3 项专项测试覆盖缺失初始化、CAS/持久化、损坏/超限及符号链接；原生语言库完整 65 项通过，桌面 target 映射测试通过。当前尚未执行真实掉电/多进程竞争、内容目录发布、下载/摘要/解包、tombstone 清理、管理审查/IPC 或卸载恢复验收，F2 未完成。

## F2.2 不可变内容发布与卸载恢复

`ManagedInstallationContentStore` 将权威索引和应用私有内容目录组成一个事务边界。它只接收“已经由后续安全解包层产出的目录”，先复制到同一文件系统的私有 `content-staging-v1`，再重新计算 `managed-language-content-v1` 树摘要。摘要按排序后的 UTF-8 相对路径绑定目录类型、文件类型、文件长度、内容及可执行位；复制和复验均拒绝符号链接、非普通文件、非法/过深路径、超过 65,536 个文件及超过计划/全局上限的展开内容。发布后的文件权限在 Unix 收敛为所有者可读写及必要的所有者可执行，内容目录不可由客户端指定。

安装提交在同一进程锁内重新读取 durable revision，将精确 staging 原子改名为按制品 ID 命名的不可变目录并同步目录，随后才 CAS 写索引；旧 revision 甚至不会发布内容。索引写失败且复读确认旧 revision 时回滚改名；若无法确认替换是否落盘，则不做可能造成反向不一致的危险回滚，当前会话失败关闭并保留可由启动恢复判定的目录状态。卸载只接受索引中的受管制品且要求下一索引已移除该 ID，先将内容改名到唯一 `content-tombstones-v1` 隔离并同步，再按相同规则提交索引；成功后回收 tombstone。回退版本和外部制品仍由协调器原有规则保护，不进入普通删除路径。

桌面宿主启动现在调用 `load_and_recover`，在协调器和前端快照可见前清理废弃 staging、恢复索引仍引用但中断于 tombstone 的内容，并通过同样的隔离路径清理索引不再引用的孤儿目录。目录中出现符号链接、普通文件或非法制品名时失败关闭，应用仍按既有隔离策略仅把受管安装事实标记为不可用，不阻断基础编辑与 Git。

5 项内容存储测试和 1 项不确定索引提交测试覆盖发布/删除、二次校验、文件变更、空目录与可执行位、符号链接、展开上限、旧 revision、孤儿/staging 清理、中断卸载恢复，以及无法确认索引落盘结果时不做危险回滚。完整语言库 71 项、桌面库 180 项通过（另有 3 项既有 ignored），相关 Clippy `-D warnings` 与原生协议漂移检查通过。测试使用可丢弃目录，没有触碰本机真实服务内容。

F2.2 本身仍不是可用安装器：该提交时网络获取、来源/重定向校验、归档摘要、安全解包、跨进程/掉电注入、管理 capability/IPC、进度/取消、真实执行 profile 和进程租约接线均未开放。目录导入 API 只用于受控夹具/内部来源，不能把任意插件路径或项目目录直接传入；紧随其后的 F2.3 关闭了精确归档到私有 staging 的解包边界。

## F2.3 受控归档校验与解包

`ManagedArchiveExtraction` 是暂未进入 IPC 的原生配方片段，只允许三种固定布局：保留目录结构的 tar.gz、保留目录结构的 ZIP，以及写入一个固定相对路径的 gzip 单文件。归档必须是应用拥有路径中的普通文件；Unix 使用 no-follow 打开。解压前先检查计划中的精确下载字节数并在同一文件句柄上计算 SHA-256，与 `ManagedArtifact.archive_digest` 一致后才回到文件头开始解码。ZIP 依赖固定为 `zip 9.4.1`、关闭默认功能且只启用 flate2 deflate；store 可直接读取，未准入其他压缩算法、加密或多种动态解码器。

所有归档路径必须是 UTF-8 相对路径。绝对路径、Windows drive/prefix、反斜杠、空/`.`/`..` 组件、控制字符、超过 64 层、16,384 字节总长或 255 字节组件均拒绝；路径以大小写无关身份去重，隐式父目录与显式条目也不能发生文件/目录冲突。tar 只接受普通文件和目录；ZIP 同时检查条目类型并拒绝符号链接；hard link、设备、FIFO 和其他特殊项都不能落盘。归档条目及最终唯一内容项各自最多 65,536 个，读取时持续执行展开字节上限，不能依赖未可信 header 阻止压缩炸弹。

输出直接写入 F2.2 的同盘私有 staging，文件使用 `create_new`，Unix 权限规范化为 `0600` 或必要的 `0700`，目录为 `0700`；文件和目录同步完成后再次计算规范内容树摘要。只有摘要与 `ManagedArtifact.content_digest` 精确一致才进入待提交集合，任何摘要/大小/格式/内容失败都会清理该 stage。gzip 的输出路径和可执行位必须来自未来准入的原生配方，不能由插件请求提供。

4 项归档测试覆盖三种正常格式、可执行位、路径穿越、tar/ZIP 链接、大小写冲突、错误摘要/大小、损坏压缩流、展开超限、符号链接归档文件、内容摘要不匹配和失败清理。完整语言库 75 项、桌面库 180 项通过（另有 3 项既有 ignored），相关 Clippy `-D warnings` 与原生协议漂移检查通过。

F2.3 提交时 F2 仍缺下载暂存、可信来源/重定向/传输上限、取消与进度、跨进程锁/真实掉电注入、管理 capability/IPC、许可回执、执行 profile 和进程租约。该步只关闭“已获得精确归档后如何安全进入不可变内容事务”的边界，不允许插件或 WebView 提交本地路径、URL、输出名或任意解包选项；紧随其后的 F2.4 继续补上来源策略和私有流式暂存内核。

## F2.4 来源策略与私有流式暂存内核

`ManagedDownloadPolicy` 是不可序列化的原生配方策略。它固定一个精确 HTTPS 初始 URL，并可列出最多 8 个（包含初始来源）准许的 HTTPS origin；重定向链必须以精确初始 URL 开始、最多 5 跳、无重复 URL，且每一跳都属于准许 origin。URL 拒绝用户名/密码、fragment、IP literal、`localhost`/`.localhost`/`.local`，允许已批准 CDN 最终 URL 使用 query。允许列表只接受纯 origin，不接受借路径伪装的范围。插件/renderer 仍不能提交 URL 或修改允许列表。

`stage_archive_stream` 接收未来原生 HTTP adapter 提供的 `Read` 字节流，不接收客户端路径。它在应用私有 `download-staging-v1` 中以 `0600` 临时文件流式写入，持续执行计划下载上限、精确最终长度和 `ManagedArtifact.archive_digest`，并在每个块前后检查取消、只报告单调累计字节。文件刷盘后立即进入 F2.3 的二次归档长度/摘要校验和内容解包；作用域结束删除下载文件，失败、取消、超长/截短/摘要不符均不会留下可提交内容。启动恢复也清理崩溃遗留的普通下载文件，对符号链接或非普通项失败关闭。

2 项来源策略测试覆盖允许 CDN、query、HTTP 降级、凭据、fragment、IP/本地域名、跨 origin 和重定向循环；2 项流式暂存测试覆盖单调进度、成功进入内容 stage、取消、超长输入及下载/内容临时目录清理，既有启动恢复测试追加废弃下载文件。完整语言库 79 项、桌面库 180 项通过（另有 3 项既有 ignored），相关 Clippy `-D warnings` 通过；F2.4 没有改变原生生成协议。

这一批次仍没有发起网络请求。真实 adapter 必须关闭透明内容解码，校验成功状态/`Content-Length`、TLS、响应超时与读取超时，在每次重定向前应用上述策略，并对 DNS 解析结果执行公网地址约束；取消还需能中断阻塞中的网络读取。完成这些以及管理审查/IPC、许可回执、跨进程锁、执行 profile 和进程租约接线后，F2 才可能退出。

## F2.5 受限原生 HTTP/TLS 下载适配器

`download_and_stage_managed_archive_blocking` 把 F2.4 的不可序列化来源策略接到平台原生 TLS transport，并继续保持为未进入 IPC 的原生内部入口。客户端只接受原生配方生成的 `ManagedArtifact`、`ManagedArchiveExtraction` 与 `ManagedDownloadPolicy`；插件和 renderer 仍不能提交 URL、允许域名、摘要、输出路径、代理或任意请求头。依赖固定为 `reqwest 0.13.5` 的 blocking/native-tls 最小特性，避免引入捆绑的 Rust TLS 加密后端；实际证书根和 TLS 实现由当前平台提供。

请求只允许 HTTPS，最低 TLS 1.2，忽略系统代理配置，关闭 referrer、重试及 gzip/brotli/deflate/zstd 透明解码，并固定 HTTP/1 和 `Accept-Encoding: identity`。所有准许 origin 在发起请求前解析，每个域名最多接受 16 个去重地址；任一地址属于未指定、loopback、私网、link-local、文档、benchmark、multicast、保留 IPv4/IPv6 或嵌入式私有 IPv4 时整项失败。同一域名不能在一份策略中混用端口。解析结果固定到 HTTP client，重定向每一跳都重新执行 F2.4 的精确 URL/origin/循环/次数策略；最终连接 peer 必须仍为公网地址且属于最终响应域名自身的固定集合，不能借另一个已准许域名的地址通过校验。

响应只接受 `200 OK`、与配方完全相同的 `Content-Length` 以及缺省或精确 `identity` 的 `Content-Encoding`，之后直接流式进入 F2.4 私有暂存、摘要、解包及内容身份链。连接超时为 15 秒，整次请求上限为 10 分钟；调用方必须放在状态所有者和 UI 线程之外，并把协调器票据的取消与进度闭包传入。取消会在请求前、响应头后和每次流读取边界生效，但当前 blocking API 不能立即打断正在进行的系统 DNS、connect 或单次读取；这些操作最终仍受连接/请求超时约束，系统 DNS 本身尚无独立超时。

3 项专项测试覆盖所有准许域名解析和固定、私网/特殊/IPv4 嵌入式 IPv6/过多结果/同域多端口拒绝，以及状态码、长度、编码、缺失 peer、私网 peer、跨域固定地址冒用。完整语言库 82 项、桌面库 180 项通过（另有 3 项既有 ignored），相关 Clippy `-D warnings` 与原生协议漂移检查通过。验证在当前 macOS 完成且没有访问公网，不代表 Windows/Linux 构建或真实 CDN/TLS 行为已验收。

F2.5 仍未开放管理命令或产生可点击的安装闭环。后续必须把配方准入、许可回执、管理审查/IPC、协调器 ticket、后台任务、提交/失败/取消终态、跨进程锁和真实掉电注入接成一个事务，再进行受控真实下载与多平台验证；执行 profile、实际服务租约及 F3 上游选型也仍在后续阶段。

## F2.6 已确认票据的内部事务执行器

`ManagedInstallationExecutor` 现在统一拥有应用私有根目录和进程内共享协调器。`open` 在任何快照可见前执行 F2.2 启动恢复；桌面 `ManagedLanguageInstallationState` 不再分别持有协调器和空闲 store，只通过执行器读取同形状环境事实。执行器可安全克隆给未来的有界 blocking worker，并提供原生内部的准备、确认、取消、安装和卸载入口，但本批次没有把这些入口注册为 Tauri 命令或插件 capability。

确认 job 新增经审查的展开字节绑定。执行安装前，执行器重新比对票据指针身份、install kind/phase、完整 `ManagedArtifact`、精确下载字节和展开上限；任一不一致在发起 acquisition 前进入固定失败终态。每个任务创建独立 `ManagedInstallationContentStore`，因此网络/解包阶段不长期占有协调器锁，也不把不同服务的暂存强制串行；最终内容发布与索引提交仍由全局 durable CAS 串行化。每个下载块只在更新进度时短暂持锁，到达精确总长度后同一次锁定切换到 `verifying`，后续归档摘要、解包、内容摘要和二次树复验失败都会保留旧索引并记录失败。只有 sealed `VerifiedManagedArtifact` 才能进入 F2.2 原子发布和索引提交；取消标记在网络、进度、验证和提交边界持续生效，迟到结果不能把 cancelled 改回 completed。

已确认卸载也由同一执行器创建私有 store 并进入 tombstone/index 事务。没有使用租约时完成隔离删除和索引提交；仍在使用时返回 `in-use` 且保持 `waiting-for-uses`，供未来任务调度器在租约释放后重试，不把正常等待误记为失败。

3 项执行器专项测试覆盖完整 gzip 流式安装→验证→持久提交→事务卸载、验证期获取失败保留空索引、审查尺寸不一致时 acquisition 不启动，以及取消终态不被迟到执行覆盖。测试期间发现并修复错误分支二次获取协调器锁的自死锁。完整语言库 85 项、桌面库 180 项通过（另有 3 项既有 ignored），相关 Clippy `-D warnings` 与原生协议漂移检查通过；没有访问公网或修改本机真实服务内容。

F2.6 仍不是用户可调用的安装器：尚缺受信任目录到原生配方的解析/摘要绑定、许可回执、后台任务注册与进度事件、管理审查界面和 IPC/capability、跨进程锁/掉电故障注入，以及真实 HTTPS/CDN 和多平台验证。执行 profile、会话租约接线及 F3 上游选择保持关闭。

## F2.7 跨进程内容与索引事务锁

`ManagedInstallationIndexStore` 在原有进程内 mutex 外增加应用私有 `installation-index-v1.lock` 的 OS 排他锁。Unix 使用 `flock`，Windows 使用 `LockFileEx`，没有为了锁再引入第三方依赖或要求高于项目 Rust 1.88 的标准库 API。锁文件只以 no-follow/open-reparse-point 方式打开，必须是普通文件；Unix 权限每次收敛为 `0600`。锁句柄随作用域和进程退出释放，不删除锁文件，因此进程崩溃不会留下需要猜测清理的“锁存在即占用”假状态，也不增加常驻线程、轮询或内存状态。

普通索引读取和 `compare_and_swap_transaction` 先取得进程锁再取得 OS 锁。后者继续把 durable revision 复读、内容发布/隔离、索引原子替换和可确认回滚全部包在同一排他区间。`ManagedInstallationContentStore::load_and_recover` 也改为在同一锁内读取索引并完成 download/content staging 清理、tombstone 恢复和孤儿隔离；另一个 Asterlyn 进程不能在恢复依据旧索引清理内容的同时提交新索引。锁只覆盖有界磁盘恢复/提交，不覆盖网络下载、解包或普通快照读取。

新增 1 项 OS 锁测试，由独立子进程分别验证持锁时拒绝和释放后成功，既有符号链接测试追加锁文件攻击，内容恢复/不确定提交等原测试继续覆盖锁内路径。完整语言库 86 项、桌面库 180 项通过（另有 3 项既有 ignored），Clippy `-D warnings`、原生协议漂移检查及 `x86_64-pc-windows-gnu` 语言服务目标编译通过。子进程测试在 macOS 运行；Windows 仅完成交叉编译，尚未执行两个完整应用进程同时恢复/提交、Windows 运行或掉电测试。

当前锁获取是阻塞式且没有独立超时/取消，但持锁区不包含 HTTP 或解压；后续仍需真实双应用进程竞争、进程强杀/掉电故障注入和异常慢磁盘验证，再决定是否增加有界等待与明确 busy 终态。管理 IPC/capability、任务事件、许可/配方准入和真实上游仍保持关闭。

## F2.8 原生规范安装配方与摘要绑定

`ManagedInstallRecipeSpec` 定义宿主原生目录适配器必须提供的 schema 1 配方输入；它和准入后的 `ManagedInstallRecipe` 都没有 serde/前端绑定，不能作为插件或 renderer 的管理请求反序列化。规范摘要使用独立 `managed-language-install-recipe-v1` domain，按长度前缀绑定插件/服务 ID、版本、target、归档/内容 SHA-256、规范化初始 HTTPS URL、排序去重后的全部允许 origin、归档格式、gzip 固定输出路径/执行位、下载/展开上限，以及许可身份。来源与 origin 继续复用 F2.4 的 HTTPS/域名/凭据/本地地址边界；相同 origin 的输入顺序或重复初始 origin 不会产生伪差异。

许可身份包含最长 256 字符且可由 `spdx 0.10` 解析的表达式、经过相同公网 HTTPS 规则规范化的 notice URL，以及 exact notice 文本的 SHA-256。摘要变化会使旧 `recipeDigest` 准入失败；当前只绑定“未来受信任目录适配器声明并保留的 notice 身份”，尚未实现 notice 内容运输、展示或用户许可回执，不能把一个未核对内容的摘要当成已完成许可审查。

`calculated_digest` 供受信任目录构建工具生成候选摘要，`admit` 始终重新计算并与声明值比较；成功后只暴露只读 artifact/extraction/policy/license 视图及精确 `ManagedInstallPlan`。`ManagedInstallationExecutor::prepare_install` 和生产 HTTP 执行入口已改为只接受 sealed recipe；确认 job 仍在联网前重新绑定由该 recipe 派生的完整 artifact、下载量与展开上限。因此来源、重定向范围、解包方式或许可身份不能在审查后作为松散参数替换，即使最终调用者仍处于原生进程内。

4 项配方专项测试覆盖完整绑定、origin 顺序/冗余规范化、来源/格式/大小/SPDX/notice 任一替换导致摘要不匹配，以及 HTTP、本地/非法许可和 schema 拒绝。完整语言库 90 项、桌面库 180 项通过（另有 3 项既有 ignored），Clippy `-D warnings`、原生协议漂移检查及 Windows x86_64 语言服务目标编译通过；测试没有加入真实服务配方、访问网络或修改插件目录 schema。

下一步仍需设计宿主拥有的准入配方注册表，把已批准服务/target/版本映射到 sealed recipe，并验证/保留 notice 内容；随后管理审查和 IPC 只能提交稳定服务/配方引用，不能提交这些底层字段。用户尚未选择任何真实上游，因此本批次不把示例 recipe 加入默认目录或显示安装动作。

## F2.9 宿主原生配方注册表

`ManagedRecipeRegistry` 是非序列化、不可变的宿主原生注册表。输入 `ManagedRecipeCatalogEntry` 除 F2.8 spec 外必须携带精确插件版本、插件包 SHA-256 和将来展示给用户的 UTF-8 notice 原文。注册表重新执行 recipe 准入，并计算 notice 原文字节的 SHA-256 与 recipe 中已绑定的 `noticeDigest` 比较；空 notice、NUL/非换行类控制字符、单项超过 128 KiB、总计超过 1 MiB 或超过 64 个 recipe 均失败关闭。notice 以共享不可变字符串持有，空注册表不占用 notice 内容内存。

注册槽由插件 ID、插件版本、包摘要、server ID 和 target 组成；同槽只允许一个 recipe。查询使用 `ManagedRecipeReference` 再绑定完整 server、target 和 recipe digest，旧界面或旧任务持有的摘要在同槽变化时返回 `state-changed`，不能静默升级。列表摘要只披露审查所需的版本、来源、下载/展开量、归档/内容摘要和许可身份，不包含输出路径、允许重定向或可变请求参数。

解析还要求当前 `ManagementAuthority` 的窗口/activation 形状有效、插件已启用且具有管理资格，并且插件 ID、版本和包摘要与注册 entry 完全一致。`ManagedInstallationExecutor::prepare_install` 和生产下载入口进一步只接受 `ManagedRegisteredRecipe`，并在准备和执行两个边界重新检查 authority；原生调用者不能再绕过注册表，把一个自行构造的 sealed recipe 直接交给宿主执行器。

3 项专项测试覆盖精确包解析和 notice 保留、过期 recipe/换版本/换包/禁用拒绝，以及重复槽、notice 内容/控制字符、64 项上限。完整语言库 93 项、桌面库 180 项通过（另有 3 项既有 ignored），Clippy `-D warnings` 和 Windows x86_64 语言服务目标编译通过。注册表仍没有接入桌面状态或插件包 schema，所有测试条目均为内存夹具；当前产品注册表事实仍为空。

下一步建立只传稳定 reference 的管理协议与宿主任务注册表。配方注册表替换必须与插件 activation 代际协调：撤销/换包时取消未完成 review/job，已经发布的不可变制品继续由索引和租约管理。未完成这一生命周期接线前不开放 capability 或安装按钮。

## F2.10 Review、Ticket 与单次后台工作句柄

`ManagedInstallationTaskRegistry` 将 F2.9 immutable recipe registry 与 F2.6 executor 组合成原生任务所有者。准备安装只接收精确 `ManagedRecipeReference` 和当前 `ManagementAuthority`，解析后同时保存 registered recipe、authority 与 5 分钟 deadline；对外 review details 由协调器 review、受限 recipe summary 和与注册 entry 共享的 `Arc<str>` notice 组成，不复制最大 128 KiB 的许可原文。pending review 继续受 32 项上限约束，过期项在新准备和确认失败时清除。

确认必须使用与准备阶段逐字段相同的窗口、activation、插件 ID/版本/包摘要及权限事实。成功后 coordinator ticket、registered recipe 和 authority 进入最多 8 项的 active map，并返回字段私有的 `ManagedConfirmedInstall`；公开 operation ID 只用于查找和展示，无法重新构造 ticket 的 `Arc` 身份或工作句柄。blocking 执行会先把该句柄原子标记为 running，只允许消费一次，再走 F2.9→F2.6→F2.5 的完整链，终态后移除 active binding。

取消先以 operation ID 找到原生 ticket，再检查完整 authority，其他窗口或换包请求返回 permission denied。若宿主确认后未能把工作入队，可显式 `abandon_install`；即使调用方直接丢弃未消费句柄，`Drop` 也会先记录取消再删除 binding。整个 task registry 因插件撤销/换包而释放时，会按插件/窗口撤销 coordinator 中尚未确认的 review 和未完成 job；已发布内容、索引和真实使用租约不由这层提前删除。

3 项专项测试覆盖精确 authority 的准备→确认→取消→迟到执行、过期 review 清理与确认工作 abandon，以及 registry drop 撤销未确认 review。完整语言库 96 项、桌面库 180 项通过（另有 3 项既有 ignored），Clippy `-D warnings`、原生协议漂移检查和 Windows x86_64 语言服务目标编译通过；测试没有访问网络，成功下载/提交仍由 F2.6 本地归档夹具覆盖。

当前 task registry 仍是语言服务库内部构件：桌面尚未拥有它，也没有 bounded `spawn_blocking` 调度、终态/进度事件或 renderer/plugin 命令。下一步先把空 recipe registry 与任务所有者接入 `ManagedLanguageInstallationState`，再定义只含 summary/reference/review ID/operation ID 的管理协议；在没有真实注册 recipe 时所有列表保持空且安装准备返回 not found。
