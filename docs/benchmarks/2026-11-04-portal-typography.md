# 索引弹窗字体审查与修复

日期：2026-11-04。状态：自动检查、原生交付和最终集成人工验收通过，按功能分步提交。

## 定位

审查 P0 前基线 `3defc013` 至 P1 `1215b5c` 的前端改动；在隔离目录重建基线，使用同一依赖比较实际生产包。主界面、提交列表、标签、按钮及设置的已有字号 / 字体一致，应用默认字号仍为 13px。引用选择弹窗挂到 `document.body`，原有应用字号只设置在 `.app-shell`，因此引用标题 / 列表 / 路径等回落到 body 默认 16px；这项旧继承隐患在此次审查中一并修正。P1 新增项目符号弹窗同样挂到 body，标题还硬编码 18px，辅助信息固定 12px，没有跟随应用字号。

定向渲染测试在修复前准确失败：Chromium 引用弹窗实际继承 16px，预期应用默认 13px。修复 body 继承后，WebKit 的原生 searchfield 又暴露 11px 系统控件字体，独立最小夹具确认仅设置 font / font-size inherit 无效，关闭原生 appearance 后正确采用 13px 与 UI 字体族。测试没有读写用户的字号偏好。

## 修复与验证

- 在 body 设置 `--ui-font-size`，统一 body portal 和主界面的继承链；不改变 html 字号 / rem 布局或编辑器字体设置。
- 项目符号标题采用应用字号 +2px，辅助文本采用应用字号 -1px / 最小 10px；引用弹窗及符号弹窗的搜索框关闭原生 searchfield appearance 并显式继承字体。
- 新增 `npm run test:typography:rendered`，实际创建两个 body 弹窗，在 Chromium / WebKit、明暗主题、11/13/16px 下检查正文、搜索框、列表、按钮和标题的 computed style；独立 20px 编辑器及 1rem=16px 均保持原值。24 组场景通过。CI 接入并保存结构化结果，未触发远端执行。
- 1438 项脚本测试、类型检查通过；现有真实修饰键定义 / 引用、符号选择、Find 树渲染与键盘 / 清理回归通过。没有新增依赖或运行时日志 / 后台工作。

完整 `.app` ad-hoc 签名与严格校验通过，精确 Android Gradle 0.6.3 / LSP 0.3.13 启动健康检查通过。安装可执行 SHA-256 `3c11bdcb31b574135ee89e57d1cdc2465a8e0444b8137e57af89887dba2a17da`；ZIP 25,600,128 字节，SHA-256 `48567e335e1b0c719d61843e9c0acd1a7bc3d0127d462caf8b3a72b94b1e38db`。canonical installer 保留 `/Applications/Asterlyn.app` 根 inode `203606126`，旧包保存在已校验 ZIP 中；两次图标书签重开 PID 82803 / 82903 均记录新 buildId 和 frontend_ready。

实际 boostCleaner 客户端复验：符号弹窗 `GlobalConfigNew` 两个候选、822/822 文件缓存复用；引用弹窗默认排除 import 后保持 54 个可见结果。标题、搜索框、列表与主界面字体目视一致，退出弹窗、选择与导航正常；测试未编辑源码，已返回原编辑标签。定量字号断言来自 WebKit / Chromium 的 computed-style 夹具，原生截图只作补充目视验收。现有最近项目路径无效错误仍有日志，本次没有将其冒充字体问题或声称全部日志零错误。

结构化结果见 [字体验收回执](2026-11-04-portal-typography.json)。最终集成人工验收通过，随所属功能提交。
