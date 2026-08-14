# pen-dev-bridge — pen.dev (pencil.dev) 桥接 Bundle

把官方 pen.dev（pencil.dev）的设计能力接入 DeepSeek Harness。**DeepSeek 就是设计 agent**：
插件在 Host 半自持 pen.dev 的本地 headless 编辑器引擎（来自 `@pen.dev/cli`），并注册
12 个 `pencil_*` 动态模型工具 —— 官方 Pencil MCP 工具（`get_app_state` / `execute` /
`export_html` / `export_nodes` / `get_screenshot` / `get_guidelines`）+ 一键 `pen` CLI 助手
（`status` / `login` / `workspaces` / `design` / `export`）。

这是会话内动态插件 `pencil-6` 与 `penin-1` 的**可安装持久化形态**：重启不丢，任何 profile 可装。

插件带 **Browser 半（Client）**：用户在会话内主动触发后，才把该会话及其工作区绑定到
pen.dev 画布。画布可使用右侧 42% 响应式分屏（左缘拖动调宽）或浮动窗口，由 Host 半的
`/pen-editor` 静态路由与 `/pen-host` IPC 桥驱动，6 秒自动保存回该会话工作区的 `.pen`
文件。切换会话时隐藏，返回时恢复；各会话分别保存打开状态、模式、宽度和浮动位置。

## 目录结构

```text
pen-dev-bridge/
├── packages/
│   └── pen-dev-bridge/              # 真实 Node Host 插件（ESM，导出 Cordis 插件）
│       ├── package.json             #   dependencies: @pen.dev/cli；dsh.client: web
│       ├── lib/index.js             #   引擎生命周期 + 12 个工具注册 + 画布 UI Host 路由
│       └── lib/client.js            #   Browser 半：分屏/浮动画布面板（__ModuleLoader__ wrap）
├── bundles/
│   └── pen-dev-bridge-bundle/       # Bundle：dsh.bundle.patch → cordis.patch.yml
│       ├── package.json
│       └── cordis.patch.yml         #   insert: - id: pen-dev-bridge / name: 'pen-dev-bridge'
├── profiles/
│   └── pen-dev-bridge-template/     # 示例 Profile：dsh-base + dsh-web-app + bridge
└── scripts/
    └── verify.cjs                   # 静态验证（无需运行 DSH）
```

## 安装

### 方式 A：作为独立 Profile

```bash
cp -R pen-dev-bridge/profiles/pen-dev-bridge-template "$DSH_HOME/profiles/pen-dev-bridge"
cd "$DSH_HOME/profiles/pen-dev-bridge"
pnpm install        # 会拉入 @pen.dev/cli（约 700MB，含 headless 引擎与 MCP server）
dsh --profile pen-dev-bridge
```

独立 Profile 同时包含 `@deepseek-ai/dsh-web-app`，因为 bridge 的 Browser 半和
`/pen-editor`、`/pen-host` 路由需要 `webServer` 服务。

### 方式 B：挂到现有 profile

在 profile 的 `package.json` 的 `dsh.profile.bundles` 追加 `"pen-dev-bridge-bundle"`，
并在 `dependencies` 声明 `"pen-dev-bridge-bundle": "file:<本目录>/bundles/pen-dev-bridge-bundle"`，
重新 `pnpm install` 后重启 DSH。

## 使用前

1. **登录 pen.dev**：让 agent 调用 `pencil_login`（邮箱 OTP 流程），或在终端 `pen login`；
   登录态存于 `~/.pencil/session-cli.json`（子进程自动读取）。也可设 `PEN_CLI_KEY`。
2. **开始设计**：对 agent 说“用 pen.dev 设计一个登录页”，agent 会走
   `pencil_mcp_open` → `get_app_state`（学 schema）→ `execute`（建节点）→
   `get_screenshot`（验证）→ `export_html` / `export_nodes`（落地代码/图片）。

插件将 `@pen.dev/cli` 精确锁定在 `0.3.0`：它与官方公开的 editor `0.1.94` 都使用 `.pen`
schema `2.14`。升级任一侧前必须先确认两者 schema 一致，否则新文件只能被其中一侧打开。
Bridge 会读取 MCP `tools/list`，把现行 `get_app_state` / `execute` 自动映射到 0.3.0 的
`get_editor_state` / `batch_design`，上层 `pencil_mcp_*` 工具名保持不变。

## 引擎坐席

- 默认：插件自持 **headless 引擎**（`pen interactive --out <file>`，stdin 保持打开，
  每次 `execute` 后自动 `save()` 落盘）。
- 官方 CLI 固定使用全局 `pencil-cli.sock`，因此 Bridge 会串行执行 MCP 调用，并在会话文件间
  安全切换唯一的活动引擎；启动前只会删除确认无人监听的残留 socket。
- 备选：检测到运行中的 **Pencil Desktop / IDE（Antigravity 等）** 时自动连 `--app <name>`
  （同时校验 `~/.pencil/apps` 中的 PID 与 socket，忽略残留记录），可用 `DSH_PEN_MCP_APP` 覆盖。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_PEN_CLI_BIN` / `DSH_PEN_MCP_BIN` | 覆盖 pen CLI / MCP server 二进制路径（默认从 `@pen.dev/cli` 解析） |
| `DSH_PEN_MCP_APP` | 外部引擎 app 名（默认自动检测，兜底 `desktop`） |
| `PEN_CLI_KEY` / `PENCIL_CLI_KEY` | pen.dev 组织级 CLI key（优先于会话登录） |
| `DSH_PEN_EDITOR_DIR` | 浏览器画布编辑器 dist 目录；它与会话工作区无关（开发树会尝试使用同级 `pen-editor/out`） |
| `DSH_PEN_FILE` | 每个会话画布的初始 `.pen` 文件（相对路径按对应会话工作区解析，默认 `designs/design.pen`） |
| `DSH_PEN_STATE_FILE` | pen.dev 浏览器登录态文件（默认 `~/.dsh/pen-dev-bridge/state.json`，不写入项目工作区） |

## 画布（Browser 半）

- 启动时不选择工作区、也不自动打开画布。点击会话头部按钮后才绑定该会话工作区；
  切换会话时隐藏，返回原会话时恢复。
- 尚未发送消息的新会话没有会话头，此时从输入框右侧的 ✏ 按钮手动打开。
- 首次打开默认采用 42% 右侧分屏，拖动左缘手柄可调宽（400px 起）；拖动后的宽度按
  视口比例保存，浏览器变宽或变窄时会同步缩放。
- 顶部工具栏只保留当前会话工作区、当前 `.pen` 文件、布局和关闭操作；工作区菜单可在
  系统文件管理器中打开目录，文件菜单只列出当前工作区内的 `.pen` 文件并支持新建、切换。
- 标题栏可切换 **浮动窗口**（按住标题拖动），✕ 关闭后可从会话头部
  「✏ pen.dev 画布」按钮重新打开。
- 每 6 秒宿主向编辑器推 `save-document`，编辑器回 `save-resource` 内容落盘到
  当前 `.pen` 文件；会话 token 读 `~/.pencil/session-cli.json`，浏览器登录态存于
  `~/.dsh/pen-dev-bridge/state.json` 并由同一 profile 的所有会话共享，不会污染项目工作区。
- 编辑器初始化后，宿主会主动推送当前文件的 `file-update`；`.pen` 内容通过二进制 IPC 读取；
  推送前会校验文件版本与内置编辑器一致，自动保存只有在当前文件成功通过校验（或确认是新文件）后才
  启用；切换文件时会丢弃旧保存队列并设置冷却闸门，落盘使用同目录临时文件原子替换，避免旧画布、
  空白编辑器或中断写入覆盖已有设计。
- 分屏打开期间产品「详情」列被隐藏（`visibility: hidden`），不会叠在画布下面。

## 验证

```bash
node pen-dev-bridge/scripts/verify.cjs
```

该检查同时约束 Harness `defineTool` 的参数格式：最外层直接写属性映射，必填项在对应
属性上声明 `required: true`，不能传入带 `type` / `properties` / `required: []` 的完整
JSON Schema 根对象。

## 后续（未包含在本 Bundle）

- 画布编辑器 dist（`pen-editor/out`）不在 Bundle 内：首次使用前需从
  `api.pen.dev/public/versions` 下载 `editor-bundle-v0.1.94.zip`，并通过
  `DSH_PEN_EDITOR_DIR` 指向解压后的 `pen-editor/out`。
- 编辑器与宿主之间的私有 IPC 协议（`get-session` / `save-document` / `save-resource` 等）
  随 pen.dev 官方 webview 版本演进，升级 dist 时需同步核对 `lib/index.js` 的
  `handleIpc` 分支。
