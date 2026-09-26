# DSH 0.1.7-rc.2 适配核对

核对日期：2026-09-26。插件原版 `0.5.5` 声明 `^0.1.0-rc.6` 依赖；本次 `0.6.0` 精确面向 `0.1.7-rc.2`，不维持旧版 Harness 兼容。上游仓库已经拉取到 `dsh-v0.1.7-rc.2`（`477b4f4205`），该标签与当时的 `origin/master` 一致。对应 npm 右侧栏包 `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.7-rc.2` 已发布。

## 与插件直接相关的变化

| 上游变化 | 核对结果与本项目动作 |
|---|---|
| 0.1.5 起模型与图片链路变化，0.1.7 默认目录为 `deepseek-flash`（显示名 DeepSeek-V41-Flash，声明 `text,image`）和 `deepseek-v4-pro`（只声明文字）。自定义或未入目录的路由也可能仅支持文字。 | 默认 `visionMode=multimodal`，截图前按当前会话路由的 `inputModalities` 检查图片输入。`text` 只保留给声明图片能力的图像转译包装路由；直连纯文本路由不接收截图。 |
| Web 右侧栏建立了正式的会话级页签接口 `sidebarRightTabs`、`sidebar.right.pane.tab`、`ctx.sidebarRight.openTab()`；`keepMounted` 可保留 iframe，布局按会话保存。左侧 `sidebar.panellist` 是全局面板入口。 | 移除 `shell.overlay` 自行定位、拖动、分屏、浮窗的实现，注册专属 `dsh-with-pencil` 页签和本地化标题。DSH 负责停靠、尺寸、浮窗与布局恢复；插件按页签所属 `sessionId` 绑定工作区。重复页签只挂载一个编辑器。 |
| 客户端 Session 可以多实例共存，旧主视图留存计数不适合作为画布归属依据。 | 不再从 `retainedBy.mainView` 猜测当前画布；右侧栏槽注入的 `sessionId` 和 `useSessions` 决定绑定目标。切换会话由 DSH 的会话级右侧栏处理。 |
| 插件配置改为 Profile 支持的实时更新字段和插件管理页的 `plugins.row.config`。 | `visionMode` 使用 Host `Config.volatile()`；Web 配置卡在插件行中，保存后下一次截图立即生效；移除旧设置页适配和模型提供者占位配置。 |
| 插件可运行时卸载，安装时检查 DSH peer 兼容性。 | 精确锁定 `0.1.7-rc.2` peer 和 profile 模板；Web 槽、页签定义、关闭处理器及 Host 工具注册都有释放路径。关闭画布页签先保存再解绑，保存失败保持页签开启。 |
| Web 新增空白会话输入栏扩展槽及会话页头动作；工具可在进行中会话动态更新。 | 保留 `conversation.input.right` 的空白会话入口和 `conversation.session.header.actions` 的普通入口；两者调用官方 `openTab('dsh-with-pencil')`。工具继续由 `ctx.tools.register` 注册并在卸载时注销。 |
| 附件历史只从声明的事件内容发现；Remote 文件读取迁到 `readBytes`；`agent/session-start` 变为 `agent/created`。 | 截图返回声明的 ImageBlock 附件，聊天原图从 `agent/pre-step` 的消息内容采集；插件不使用旧 Remote 文件读取或 `agent/session-start`，无需迁移这些接口。 |

## 核对来源

- [DSH 0.1.5-rc.1 跨版本发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [DSH 0.1.7-rc.1 跨版本发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)
- [DSH 0.1.7-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)
- [右侧栏扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-sidebar-right/README.md)
- [默认 DeepSeek 模型目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/llm/llm-deepseek/src/models.ts)
- [插件配置页扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-plugin-manager/README.md)

## 验证

- `npm test`：静态检查、打包内容、Client 右侧栏注册/绑定/关闭检查、Host/画布集成测试通过。
- `git diff --check`：通过。
- 复用已有的 `0.1.7-rc.2` 开发 Profile 和本地编辑器缓存，在隔离 `DSH_HOME` 启动真实 DSH Web；Host 注册了 9 个 Pencil 工具。浏览器确认画布按钮打开官方右侧栏的 `pen.dev 画布` 页签和编辑器 iframe，插件配置页默认选中“原生视觉模型”。这次复测未安装或下载依赖，也未覆盖现有 `web` Profile。
- 在应用内浏览器复测“新建 .pen 文件”时发现原生 `prompt()` 不受支持；改为插件页面内输入对话框，并统一用于另存为、重命名和删除确认。复测新建操作后，右侧栏切到空白画布，隔离工作区磁盘立即出现 schema `2.14` 的 `.pen` 文件；同名新建返回冲突。`npm test` 全部通过，复测过程未下载依赖。
- 在独立测试页打开新文件，绘制矩形后确认磁盘文档包含一个图层；关闭官方右侧栏页签再从会话入口重开，文件路径与矩形图层均恢复。另存为和重命名均在浏览器与磁盘上成功，删除确认表单正常显示后取消。该人工验收不依赖模型 API Key。
