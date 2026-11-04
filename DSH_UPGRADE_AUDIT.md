# DSH 升级适配核对

## DSH 0.2.1-rc.5 — 2026-11-04

核对 npm dist-tags：`latest`、`next` 均为 `0.2.1-rc.5`，npm 发布于
2026-10-29；GitHub 同名 Release 仍标记为 Pre-release。`0.2.2-alpha.3`
属于 alpha 发行线。本次插件 `0.8.0` 对齐默认发行线，不包含 alpha 适配，
不继续声明旧 Harness 的兼容性。

上游已拉取标签，比较 `dsh-v0.2.0-rc.2` 与 `dsh-v0.2.1-rc.5`
（`b830ec950faba0a46dda564be3e2d854afed94f1`），覆盖 `0.2.1` 的 alpha
和 RC 累积更新。验收复用已有依赖缓存，仅单独补齐缺少的新运行模块。

| 与 Pencil 有关的变化 | 适配结果 |
|---|---|
| 插件更新/热重载、发现页和安装诊断改进；插件配置新增周边扩展槽。 | 保留 `plugins.row.config` 和带 revision 的表单更新接口；安装仍声明精确的 DSH peers，卸载时释放注册。 |
| 右侧栏完善多页签、引导页、快捷键和焦点恢复。 | 核对 `mounted`、`openTabs`、`openTab`、`registerCloseHandler`、`keepMounted` 及页签槽，插件使用的公共接口保留。引导页扩展无需替代现有会话入口。 |
| 新增独立的 `workingDirectory` 服务和 `working_directory` 工具。会话投影存放执行目录，`header.cwd` 继续标识原工程，沙箱授权边界独立保留。 | Pencil 继续绑定原始会话工程，模型路径说明和中英文文档明确这个语义；切换执行目录不重绑定画布或迁移现有文档。 |
| 系统提示上下文支持 `interpolate: false`，并可在请求准入时刷新已注册的动态事实。 | 画布选区上下文设置 `interpolate: false`，保持节点名中的 `{{...}}` 原文；增加回归断言。 |
| 图片请求目标、尺寸/字节投影和目录能力处理改进。 | `attachments.saveImage/readImage` 与 `llm.resolveModelInfo` 接口保留，截图仍返回 ImageBlock，并按实际路由检查图片能力。Flash 仍声明图片输入，Pro 未声明；默认继续为原生视觉。 |
| 新增会话记录接口；移除运行时 invariant 子插件及其导出；输入区统计扩展拆分。 | 本插件未使用这些旧诊断入口、统计槽或内部记录接口，无需迁移。 |
| Node、Cordis 和 schema 依赖随发行线更新。 | Node 要求仍为 `^22.19.0 || >=24.0.0`；Host 仍使用公开 Config API，现有 `~3.18.4` 范围允许上游的 `3.18.5`。 |

源码核对与契约测试不等同于真实 Web 运行验收；本次不复用此前
`0.2.0-rc.2` 的截图作为 `0.2.1-rc.5` 的验收证据。

验证记录：

- npm 中五个目标 DSH peer 的 `0.2.1-rc.5` 均已存在；插件 `0.8.0` 的发布包使用这一精确目标。
- Node `24.12.0`：从 Git 源码快照建立不含 `node_modules` 的临时目录，
  禁用 npm 网络访问，运行 `npm test`，13 项检查全部通过。
- 新增选区中的 `{{selection_name}}` 原文和 `interpolate: false` 回归断言。
- 打包检查仍为 23 个文件，依赖、测试、Profile 和编辑器缓存未进入 npm 包。
- 临时测试目录与 npm 缓存均位于外置 SSD，并已清理；既有用户 Profile 未改动。
- 按用户要求补做简单真实 Web 验收：运行官方 `0.2.1-rc.5` 编译产物，
  从已拉取源码构建对应 Cordis `4.0.5`、schemastery `3.18.5` 等 vendor；
  复用现有第三方依赖、CLI `0.3.0` 和编辑器 `0.1.94` 缓存。
- 仅补齐本机缺少的 DSH 程序/原生模块，以及新运行模块 Temporal 和 jsbi；
  未执行依赖安装，未重新下载已有依赖。全部临时运行文件放在外置 SSD。
- 真实 Web 标准模式会话中，待发布 tarball 注册 9 个 Pencil 工具；
  在临时工作区通过 UI 新建 `designs/smoke-080.pen`，确认 schema `2.14` 文件立即落盘。
  原生右侧栏加载官方编辑器；关闭页签后重开，恢复同一文件并建立新绑定。
- 配置页显示 `0.8.0`，默认原生视觉；切换图像转译配置保存成功且立即生效，
  重置后恢复原生视觉。未发送模型请求。
- 缓存环境中的 pi-ai、OTel 和 office-to-pdf 未加载；本次仅验证 Pencil Web 路径。
  临时服务已停止，验收标签页已关闭，保留一张忽略入库的验收截图。

来源：

- [默认 npm 发行线](https://registry.npmjs.org/@deepseek-ai%2fdsh)
- [0.2.1 首个 RC 的累积发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)
- [0.2.1-rc.5 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.5)
- [工作目录服务](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/session/working-directory/README.md)
- [侧边栏契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/client/ui-sidebar-right/README.md)
- [上下文渲染接口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.5/packages/core/system-prompt/src/index.ts)

## DSH 0.2.0-rc.2 — 2026-10-10

插件 `0.7.0` 精确面向默认发行线 `0.2.0-rc.2`。本次比较上游标签 `dsh-v0.1.7-rc.2` 与 `dsh-v0.2.0-rc.2`（`639ed015397290b3745d163aafe02ffee4aa3f84`），覆盖两次 `0.2.0` RC 更新。所有 DSH peer、开发 Profile、开发安装器使用的目标版本和中英文安装命令均对齐 `0.2.0-rc.2`。

| 与插件有关的更新 | 本项目核对结果 |
|---|---|
| 右侧栏导航改为对当前屏幕会话的 adopted store 操作；`mounted` 在 React 渲染之前随会话选择更新。移除内部 `SidebarRightBinding` 导出。 | 插件通过 `mounted` 订阅判断入口是否可用，并使用 `openTab`、`openTabs`、`registerCloseHandler`、`keepMounted` 和官方页签槽。未使用已移除的绑定接口；按槽传入的 `sessionId` 管理画布和关闭保存。 |
| 插件管理器改进安装状态、刷新提示和保存交互。 | `plugins.row.config` 的键、配置表单 `state` 和带 revision 的 `mutate` 接口保留，现有 `visionMode` 配置无需迁移。 |
| 会话输入草稿和提交流程调整。 | `conversation.session.header.actions` 和 `conversation.input.right` 保留；插件未调用草稿编辑器内部接口。 |
| 工具调用恢复和 DeepSeek 过期图片重新上传。 | `defineTool`、工具参数及结果声明、`attachments.saveImage/readImage`、`ImageBlock` 和模型图片能力查询接口保留，截图与聊天原图插入继续使用这些公共接口。 |
| 桌面登录 Shell 环境继承、内置 DSH CLI 和主题按钮改进。 | 这些行为由 Harness 提供；插件继续使用 subprocess 服务和成对的主题按钮颜色。 |

默认视觉模式继续为 `multimodal`。目标版本的默认 `deepseek-flash` 模型声明文字和图片输入；`deepseek-v4-pro` 未声明图片输入，截图仍按实际路由能力检查。此次不引入 `0.2.1-alpha` 的工作目录、反向代理路径前缀或字体接口。

核对来源：

- [DSH 0.2.0-rc.1 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)
- [DSH 0.2.0-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)
- [目标版本右侧栏扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-sidebar-right/README.md)
- [目标版本插件配置扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-plugin-manager/README.md)
- [目标版本默认模型目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/llm/llm-deepseek/src/models.ts)

验证记录：

- `npm test`：13 项检查全部通过，包括客户端配置/侧栏契约夹具、Host 画布保存与路由、文档切换、聊天图片、资源导入、开发打包和发布文件检查。
- npm 包共 23 个文件，包含全部运行模块和必要文档，没有打入依赖、官方编辑器、Profile、测试目录或本地缓存。
- `git diff --check`：通过；`node_modules`、锁文件、开发 tarball 和测试缓存继续排除在 Git/发行包之外。
- 自动回归阶段复用本机 `dsh-tools@0.1.7-rc.2` 和 `schemastery@3.18.4`，未安装或重新下载依赖。上述公共接口文件已与目标标签逐文件核对一致；客户端侧栏检查使用契约夹具。
- 按用户要求补做简单真实 Web 验收：隔离 `DSH_HOME` 使用官方 `0.2.0-rc.2` npm 运行产物，获取本机缺少的 Harness 运行模块，并复用已有第三方依赖、Pencil CLI 和编辑器缓存。待发布 tarball 的插件快照成功注册 9 个 Pencil 工具。
- 浏览器确认会话入口打开官方右侧栏的画布和编辑器；在外置 SSD 工作区新建 `designs/smoke-070.pen`，磁盘立即出现 schema `2.14` 的文件。关闭画布后重开，恢复相同文件并建立新的绑定。
- 插件配置页显示 `v0.7.0` 且默认选中“原生视觉模型”；切换图像转译选项保存成功，再重置回原生视觉。未发起模型请求。
- 复用依赖的临时环境有 OTel 与 office-to-pdf 未加载的提示，不影响上述 Pencil 验收；本轮没有扩展到这些组件或完整 DSH 功能矩阵。
- 临时运行环境、测试目录及 npm 缓存均放在外置 SSD，验收服务已停止；收尾时清理临时目录，保留一张忽略入库的验收截图。既有用户 Profile 未改动。

## DSH 0.1.7-rc.2 — 2026-09-26

核对日期：2026-09-26。插件原版 `0.5.5` 声明 `^0.1.0-rc.6` 依赖；本次 `0.6.0` 精确面向 `0.1.7-rc.2`，不维持旧版 Harness 兼容。上游仓库已经拉取到 `dsh-v0.1.7-rc.2`（`477b4f4205`），该标签与当时的 `origin/master` 一致。对应 npm 右侧栏包 `@deepseek-ai/dsh-client-ui-sidebar-right@0.1.7-rc.2` 已发布。

### 与插件直接相关的变化

| 上游变化 | 核对结果与本项目动作 |
|---|---|
| 0.1.5 起模型与图片链路变化，0.1.7 默认目录为 `deepseek-flash`（显示名 DeepSeek-V41-Flash，声明 `text,image`）和 `deepseek-v4-pro`（只声明文字）。自定义或未入目录的路由也可能仅支持文字。 | 默认 `visionMode=multimodal`，截图前按当前会话路由的 `inputModalities` 检查图片输入。`text` 只保留给声明图片能力的图像转译包装路由；直连纯文本路由不接收截图。 |
| Web 右侧栏建立了正式的会话级页签接口 `sidebarRightTabs`、`sidebar.right.pane.tab`、`ctx.sidebarRight.openTab()`；`keepMounted` 可保留 iframe，布局按会话保存。左侧 `sidebar.panellist` 是全局面板入口。 | 移除 `shell.overlay` 自行定位、拖动、分屏、浮窗的实现，注册专属 `dsh-with-pencil` 页签和本地化标题。DSH 负责停靠、尺寸、浮窗与布局恢复；插件按页签所属 `sessionId` 绑定工作区。重复页签只挂载一个编辑器。 |
| 客户端 Session 可以多实例共存，旧主视图留存计数不适合作为画布归属依据。 | 不再从 `retainedBy.mainView` 猜测当前画布；右侧栏槽注入的 `sessionId` 和 `useSessions` 决定绑定目标。切换会话由 DSH 的会话级右侧栏处理。 |
| 插件配置改为 Profile 支持的实时更新字段和插件管理页的 `plugins.row.config`。 | `visionMode` 使用 Host `Config.volatile()`；Web 配置卡在插件行中，保存后下一次截图立即生效；移除旧设置页适配和模型提供者占位配置。 |
| 插件可运行时卸载，安装时检查 DSH peer 兼容性。 | 精确锁定 `0.1.7-rc.2` peer 和 profile 模板；Web 槽、页签定义、关闭处理器及 Host 工具注册都有释放路径。关闭画布页签先保存再解绑，保存失败保持页签开启。 |
| Web 新增空白会话输入栏扩展槽及会话页头动作；工具可在进行中会话动态更新。 | 保留 `conversation.input.right` 的空白会话入口和 `conversation.session.header.actions` 的普通入口；两者调用官方 `openTab('dsh-with-pencil')`。工具继续由 `ctx.tools.register` 注册并在卸载时注销。 |
| 附件历史只从声明的事件内容发现；Remote 文件读取迁到 `readBytes`；`agent/session-start` 变为 `agent/created`。 | 截图返回声明的 ImageBlock 附件，聊天原图从 `agent/pre-step` 的消息内容采集；插件不使用旧 Remote 文件读取或 `agent/session-start`，无需迁移这些接口。 |

### 核对来源

- [DSH 0.1.5-rc.1 跨版本发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [DSH 0.1.7-rc.1 跨版本发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)
- [DSH 0.1.7-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)
- [右侧栏扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-sidebar-right/README.md)
- [默认 DeepSeek 模型目录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/llm/llm-deepseek/src/models.ts)
- [插件配置页扩展契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/client/ui-plugin-manager/README.md)

### 验证

- `npm test`：静态检查、打包内容、Client 右侧栏注册/绑定/关闭检查、Host/画布集成测试通过。
- `git diff --check`：通过。
- 复用已有的 `0.1.7-rc.2` 开发 Profile 和本地编辑器缓存，在隔离 `DSH_HOME` 启动真实 DSH Web；Host 注册了 9 个 Pencil 工具。浏览器确认画布按钮打开官方右侧栏的 `pen.dev 画布` 页签和编辑器 iframe，插件配置页默认选中“原生视觉模型”。这次复测未安装或下载依赖，也未覆盖现有 `web` Profile。
- 在应用内浏览器复测“新建 .pen 文件”时发现原生 `prompt()` 不受支持；改为插件页面内输入对话框，并统一用于另存为、重命名和删除确认。复测新建操作后，右侧栏切到空白画布，隔离工作区磁盘立即出现 schema `2.14` 的 `.pen` 文件；同名新建返回冲突。`npm test` 全部通过，复测过程未下载依赖。
- 在独立测试页打开新文件，绘制矩形后确认磁盘文档包含一个图层；关闭官方右侧栏页签再从会话入口重开，文件路径与矩形图层均恢复。另存为和重命名均在浏览器与磁盘上成功，删除确认表单正常显示后取消。该人工验收不依赖模型 API Key。
