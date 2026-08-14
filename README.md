# pen-dev-bridge

把官方 pen.dev（Pencil）的编辑能力接入 DeepSeek Harness。DeepSeek 仍然是设计 Agent；
Bridge 只负责把模型工具、当前会话和用户看到的 Pencil 画布连接起来。

默认注册 7 个核心工具：`pencil_mcp_open`、`get_app_state`、`execute`、
`get_guidelines`、`get_screenshot`、`export_html` 和 `export_nodes`。旧的一次性 CLI 助手
默认不再暴露给模型，避免重复能力和无关上下文；确有兼容需求时可设置
`DSH_PEN_LEGACY_TOOLS=1`，恢复 `status`、`login`、`workspaces`、`design`、`export` 5 个工具。

## 组成与边界

这不是 Pencil 的重写版，也没有替换官方引擎：

- `@pen.dev/cli@0.3.0` 是官方包，提供 headless 引擎和 MCP server。
- editor `0.1.94` 是官方浏览器编辑器 bundle，负责画布渲染和交互。
- 本仓库的 Bridge 是自定义对接层，负责 Harness 工具注册、会话/工作区绑定、Browser UI、
  editor IPC、保存确认和截图附件。
- 当前实现不依赖 Antigravity/Pencil Desktop 扩展外壳；只有显式设置
  `DSH_PEN_MCP_APP` 时才连接外部 Pencil app。

`.pen` schema 被固定为 `2.14`。升级 CLI 或 editor 前必须先验证两边 schema 和 IPC 兼容，
否则可能出现文件打不开或保存覆盖。

## 工作方式

- Harness 启动时不选择工作区，也不默认打开画布。
- 用户在会话内点击“pen.dev 画布”后，Host 根据 Harness 的真实 session 绑定该会话工作区；
  浏览器提交的任意路径不能替代 session 工作区。
- 切换到其他会话时画布隐藏；返回原会话后恢复。会话被移除时会先保存再解绑。
- 画布打开时，MCP 编辑直接进入该会话的可见 editor IPC，修改实时渲染，并在工具返回成功前
  等待 `save-resource` 落盘、重新解析磁盘 JSON。
- 画布未打开时，Bridge 才启动官方 headless 引擎。现有文件使用
  `interactive --in <file> --out <file>`，每次编辑后发送 `save()`，只有收到保存回执并验证
  磁盘文档后才返回成功。
- 官方 CLI 共用全局 `pencil-cli.sock`；所有 headless 操作与引擎交接串行执行。不同会话的
  live canvas 各自排队，不需要互相阻塞。

模型输入、浏览器 IPC、导入和导出路径都被限制在所属会话工作区内，并检查符号链接逃逸。
浏览器登录态使用原子替换写入且权限为 `0600`。

画布选区会在下一轮 Agent 启动时作为动态上下文注入，包含当前 `.pen` 文件和节点 ID；没有选区时
不增加上下文。外部修改当前 `.pen` 文件时，干净画布会实时重载；存在未保存修改时会暂停保存并
要求用户选择磁盘版本或画布版本。Script 引用文件也通过 editor 的 `watch-file` 协议实时刷新。

## 目录结构

```text
packages/pen-dev-bridge/
  lib/index.js              依赖解析与三个运行边界的启动编排
  lib/headless-runtime.js   官方 CLI/MCP 引擎生命周期
  lib/model-tools.js        7 个核心模型工具与截图附件输出
  lib/canvas-host.js        会话绑定、文档保存、editor IPC 路由
  lib/canvas-transport.js   请求队列、长轮询、取消和响应配对
  lib/editor-assets.js      官方 editor dist 定位、注入与静态响应
  lib/ipc-binary.js         浏览器 IPC 中 ArrayBuffer 的无损传输
  lib/session-store.js      Browser/CLI 登录态复用与安全落盘
  lib/workspace-resources.js 图片导入、生成图、文件监听与设计库
  lib/workspace-path.js     session 工作区与路径边界
  lib/legacy-tools.js       可选的一次性 CLI 工具
  lib/client.js             Harness Browser 分屏/浮动画布
bundles/pen-dev-bridge-bundle/
  cordis.patch.yml          Host 服务注入
profiles/pen-dev-bridge-template/
  package.json              开发用示例 profile
tests/
  live-canvas.test.mjs      真实协议形状的 Agent/Canvas 模拟
  host-components.test.mjs  editor 资源注入与登录态权限
  workspace-path.test.mjs   路径与符号链接边界
  workspace-resources.test.mjs 资源导入、二进制 IPC、监听与设计库
scripts/verify.cjs          包结构和关键约束检查
```

## 当前安装方式

目前是测试版开发安装，还不是可发布的一键插件：三个 package 都是 `private`，Bundle 与示例
profile 使用仓库内的相对 `file:` 依赖；把 profile 目录单独复制出去会破坏这些路径。

在本仓库测试时，先准备官方 editor bundle：

1. 从 pen.dev 官方版本接口取得 `editor-bundle-v0.1.94.zip` 并解压。
2. 将 `DSH_PEN_EDITOR_DIR` 指向解压目录中的 `out`（该目录内应有 `index.html`）。
3. 在目标 DSH profile 中以绝对 `file:` 路径安装本仓库的
   `bundles/pen-dev-bridge-bundle`，并把 `pen-dev-bridge-bundle` 加入
   `dsh.profile.bundles`。
4. 重新安装 profile 依赖并重启 DSH。Bundle 会继续拉入本仓库 Bridge，Bridge 再安装固定版本
   的官方 `@pen.dev/cli`。

也可以直接在仓库内安装示例 profile 的依赖进行开发验证，但不要把下面命令理解为发行安装器：

```bash
cd profiles/pen-dev-bridge-template
pnpm install
```

后续正式安装器应完成四件事：安装 Bridge/Bundle、安装固定版本官方 CLI、从官方地址下载并
校验 editor bundle、修改目标 profile 配置。editor bundle 是否可随插件再分发，需要先确认
pen.dev 的授权，因此目前不会把官方 dist 直接提交进本仓库。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_PEN_EDITOR_DIR` | 官方 editor 的 `out` 目录；与会话工作区无关 |
| `DSH_PEN_FILE` | 会话首次打开的 `.pen` 相对路径，默认 `designs/design.pen` |
| `DSH_PEN_CLI_BIN` / `DSH_PEN_MCP_BIN` | 覆盖官方 CLI/MCP 路径；通常无需设置 |
| `DSH_PEN_MCP_APP` | 显式连接外部 Pencil app；默认不自动探测 |
| `DSH_PEN_LEGACY_TOOLS` | 设为 `1` 时注册 5 个旧 CLI 助手 |
| `PEN_CLI_KEY` / `PENCIL_CLI_KEY` | pen.dev 组织 CLI key |
| `DSH_PEN_STATE_FILE` | Browser 登录态文件，默认 `~/.dsh/pen-dev-bridge/state.json` |

## 画布行为

- 首次打开为 42% 右侧分屏；左边缘拖动后按视口比例保存，也可切成浮动窗口。
- 顶栏仅显示工作区、`.pen` 文件、布局和关闭操作；菜单可打开系统文件夹、新建或切换工作区内
  的 `.pen` 文件。
- editor iframe 在当前会话中保持挂载，Agent 切换文件时不会因 React 重建 iframe 而丢引擎。
- 用户手工编辑每 6 秒触发保存；Agent 编辑则逐次等待保存确认。
- 从画布导入的图片和 Figma 内嵌图片保存到当前设计旁的 `images/`；SVG 由官方 editor 转成节点；
  生成图片同样持久化到 `images/`，不会只存在于引擎内存。
- 工作区内的 `*.lib.pen` 和官方 CLI 随附的只读设计库会出现在 editor 的设计库列表；当前普通
  `.pen` 文件也可通过官方 editor 菜单转换为不覆盖已有文件的 `.lib.pen`。
- 外部文件冲突会在顶栏显示“磁盘冲突”，自动保存与 editor 主动保存都会暂停，直到明确选择版本。
- 截图会保存为 Harness attachment，并向模型返回真正的 image block，而不是 base64 文本提示。
- 工具取消后，尚未交付 editor 的请求会从队列删除；已经交付的请求会明确提示先检查画布状态，
  避免盲目重试造成重复编辑。

## 验证

```bash
node scripts/verify.cjs
node tests/host-components.test.mjs
node tests/workspace-path.test.mjs
node tests/workspace-resources.test.mjs
node tests/live-canvas.test.mjs
```

`live-canvas.test.mjs` 模拟真实 Agent 工具调用和官方 editor IPC：连续编辑、选区上下文、原子保存、
外部热重载与两种冲突决议、切换并重开文件、截图附件、取消请求和解绑会话，并确认整个 live
canvas 路径没有启动 headless 子进程。`workspace-resources.test.mjs` 另外覆盖图片/SVG/Figma 资源
落盘、生成图片、Script 文件监听、工作区/内置设计库和嵌套二进制 IPC。
