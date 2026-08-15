# dsh-with-pencil

[English](#english) · [简体中文](#简体中文)

## English

Use the official pen.dev Pencil editing capabilities inside DeepSeek Harness.
DeepSeek remains the design agent; this community DSH plugin makes its model
tools, the active conversation, and the Pencil canvas work together.

This is not a Pencil rewrite or a standalone design product. It integrates the
official `@pen.dev/cli` headless engine and a compatible official browser editor
with DSH. It is independent and is not endorsed by pen.dev or DeepSeek.

### What it provides

- An on-demand Pencil canvas that does not open when Harness starts.
- Conversation-bound workspaces: the canvas hides when you switch conversations
  and returns with its original editor session when you switch back.
- Live Agent edits through the visible editor IPC, with immediate rendering and
  acknowledged, atomic disk saves.
- A serialized official headless fallback when the browser canvas is closed.
- Selection context injection for the next Agent turn, plus real image
  attachments from Pencil screenshots.
- Workspace-safe file opening, creation, Save As, imports, generated images,
  design libraries, external-change reloads, and conflict resolution.
- A responsive 42% split view with pointer-safe resizing and an optional
  floating layout.

The plugin registers seven core model tools:

- `pencil_mcp_open`
- `pencil_mcp_get_app_state`
- `pencil_mcp_get_guidelines`
- `pencil_mcp_execute`
- `pencil_mcp_get_screenshot`
- `pencil_mcp_export_html`
- `pencil_mcp_export_nodes`

Five legacy one-shot CLI helpers are hidden by default to avoid duplicated
capabilities and irrelevant model context. Set `DSH_PEN_LEGACY_TOOLS=1` only
when compatibility requires `status`, `login`, `workspaces`, `design`, and
`export`.

### Runtime boundaries

- `@pen.dev/cli@0.3.0` is the official package that supplies the headless engine
  and MCP server.
- Editor `0.1.94` is the compatible official browser editor bundle used for
  canvas rendering and interaction.
- This repository supplies the DSH tool registration, conversation/workspace
  binding, Browser UI, editor IPC, save verification, and screenshot attachment
  integration.
- An external Pencil app is never auto-detected. It is used only when
  `DSH_PEN_MCP_APP` is explicitly configured.

The `.pen` schema is pinned to `2.14`. Do not upgrade the CLI or editor without
testing schema and IPC compatibility on both sides; incompatible combinations
can fail to open files or overwrite them incorrectly.

### How it works

- Harness startup neither selects a workspace nor opens the canvas.
- The first in-conversation canvas action binds to the workspace of the real
  Harness session. A browser-supplied path cannot replace that boundary.
- With the canvas open, MCP edits run through that conversation's visible
  editor. A tool succeeds only after `save-resource` reaches disk and the saved
  JSON is parsed again.
- With the canvas closed, the plugin starts the official headless engine. It
  opens existing files with `interactive --in <file> --out <file>`, sends
  `save()` after edits, waits for the acknowledgement, and verifies the file.
- The official CLI shares a global `pencil-cli.sock`, so headless operations and
  engine handoffs are serialized. Independent live canvases keep separate
  queues.

Model paths, browser IPC paths, imports, and exports are restricted to the
owning conversation workspace, including symlink-aware escape checks. Browser
credentials are atomically persisted with mode `0600`.

Selected nodes are injected into the next Agent turn with the current `.pen`
file and node IDs. Clean canvases reload external file changes automatically;
dirty canvases stop saving and ask which version to keep. Script references are
refreshed through the editor's `watch-file` protocol.

### Install the beta

With a working DeepSeek Harness Web profile, install the npm bundle:

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-with-pencil@beta
```

Restart DSH Web after installation (`Ctrl-C` the running process first):

```bash
npx @deepseek-ai/dsh web
```

That is the complete normal installation. The npm bundle installs the pinned
official `@pen.dev/cli`. The first time you open a canvas, the plugin downloads
editor `0.1.94` directly from the official pen.dev release source, verifies its
pinned SHA-256 checksum, and atomically caches it under
`~/.dsh/dsh-with-pencil/editor/0.1.94/`. Harness startup does not download or
open anything, and subsequent canvas opens use the verified cache.

The browser editor is not copied into or redistributed through this npm
package. For offline use, download and extract the same official bundle ahead
of time and point `DSH_PEN_EDITOR_DIR` to its `out` directory.

For local development from this checkout:

```bash
npx @deepseek-ai/dsh plugin --profile web add file:/absolute/path/to/dsh-with-pencil
```

Use `file:` rather than `link:` so the target profile receives a complete
dependency tree. When migrating from an older development build, remove
`pen-dev-bridge-bundle` and `pen-dev-bridge` first so the same canvas routes are
not registered twice.

The development-only profile fixture is available at
`profiles/dsh-with-pencil-template/`.

### Environment variables

| Variable | Purpose |
|---|---|
| `DSH_PEN_EDITOR_DIR` | Optional offline/development override for an official editor `out` directory |
| `DSH_PEN_EDITOR_CACHE_DIR` | Override the automatic editor cache root; defaults to `~/.dsh/dsh-with-pencil/editor` |
| `DSH_PEN_FILE` | Initial workspace-relative `.pen` path; defaults to `designs/design.pen` |
| `DSH_PEN_CLI_BIN` / `DSH_PEN_MCP_BIN` | Override official CLI/MCP paths; normally unnecessary |
| `DSH_PEN_MCP_APP` | Explicitly connect an external Pencil app; no automatic probing |
| `DSH_PEN_LEGACY_TOOLS` | Set to `1` to register five legacy CLI helpers |
| `PEN_CLI_KEY` / `PENCIL_CLI_KEY` | pen.dev organization CLI key |
| `DSH_PEN_STATE_FILE` | Browser session file; defaults to `~/.dsh/dsh-with-pencil/state.json` and reads the old location for compatibility |

### Canvas behavior

- The first open uses a 42% right split. Resizing persists as a viewport ratio;
  the canvas can also float.
- The toolbar contains workspace, `.pen` file, layout, and close controls.
- The editor iframe stays mounted within its conversation, including when the
  Agent changes the active file.
- Manual edits autosave every six seconds; Agent edits await a save after every
  successful operation.
- Save As writes a new `.pen` inside the workspace, never overwrites an existing
  target, switches the canvas to the copy, and leaves the source unchanged.
- Imported and generated images are persisted to an adjacent `images/`
  directory. SVG is converted into nodes by the official editor.
- Workspace `*.lib.pen` files and read-only libraries shipped with the official
  CLI appear in the editor library list.
- External conflicts and save failures remain visible in the toolbar and never
  silently overwrite a dirty document.
- Shutdown flushes dirty canvases before releasing their sessions.
- The pinned editor downloads only on the first canvas open; download,
  checksum, extraction, or compatibility failures appear before an empty
  iframe opens.
- Cancelled requests that have not reached the editor are removed from its
  queue; delivered requests require a canvas-state check before retrying.

### Source layout

```text
lib/index.js                 Runtime composition and dependency resolution
lib/headless-runtime.js      Official CLI/MCP engine lifecycle
lib/model-tools.js           Seven model tools and screenshot attachments
lib/canvas-host.js           Session binding, persistence, and editor IPC routes
lib/canvas-transport.js      Request queues, polling, cancellation, responses
lib/editor-assets.js         Official editor discovery, injection, static files
lib/editor-installer.js      Pinned download, verification, safe extraction, cache
lib/ipc-binary.js            Lossless binary values over JSON browser IPC
lib/session-store.js         Browser/CLI login reuse and secure persistence
lib/workspace-resources.js   Imports, generated images, watchers, libraries
lib/workspace-path.js        Session workspace and path boundaries
lib/legacy-tools.js          Optional one-shot CLI helpers
lib/client.js                Harness split/floating canvas UI
cordis.patch.yml             DSH Bundle and Host service injection
profiles/dsh-with-pencil-template/  Development profile fixture
tests/                       Protocol, persistence, path, and resource tests
```

### Verification and licensing

```bash
npm test
npm run release:check
```

Tests simulate real Agent calls and official editor IPC, including live edits,
selection context, atomic saves, external reloads, conflicts, Save As,
screenshots, cancellation, imports, generated assets, libraries, and binary IPC.
CI covers Node 22 and 24 on macOS and Linux.

See [`docs/RELEASING.md`](docs/RELEASING.md) for release gates and rollback.
This integration is MIT licensed; official pen.dev and DeepSeek components are
not. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

---

## 简体中文

让 DeepSeek Harness 使用官方 pen.dev（Pencil）的编辑能力。DeepSeek 仍然是设计 Agent；
这个社区 DSH 插件只负责让模型工具、当前会话和 Pencil 画布协同工作。

它不是 Pencil 的重写版，也不是独立设计产品。插件对接官方 `@pen.dev/cli` headless
引擎和兼容的官方浏览器编辑器，项目独立维护，未获得 pen.dev 或 DeepSeek 的背书。

### 提供的能力

- 按需打开 Pencil 画布，Harness 启动时不会自动显示。
- 画布绑定所属会话：切换到其他会话时隐藏，返回后恢复原来的 editor session。
- Agent 编辑直接进入可见 editor IPC，实时渲染，并等待确认后的原子磁盘保存。
- 画布关闭时使用串行化的官方 headless 引擎。
- 将画布选区注入下一轮 Agent 上下文，并把 Pencil 截图作为真正的图片附件返回。
- 在会话工作区边界内提供文件打开、新建、另存为、资源导入、生成图片、设计库、
  外部修改重载和冲突处理。
- 默认 42% 的响应式右侧分屏，拖动过程中保持指针控制，也可切成浮动窗口。

插件默认注册 7 个核心模型工具：

- `pencil_mcp_open`
- `pencil_mcp_get_app_state`
- `pencil_mcp_get_guidelines`
- `pencil_mcp_execute`
- `pencil_mcp_get_screenshot`
- `pencil_mcp_export_html`
- `pencil_mcp_export_nodes`

为避免重复能力和无关上下文，5 个旧的一次性 CLI 助手默认隐藏。仅在兼容需要时设置
`DSH_PEN_LEGACY_TOOLS=1`，恢复 `status`、`login`、`workspaces`、`design` 和
`export`。

### 组成与边界

- `@pen.dev/cli@0.3.0` 是官方包，提供 headless 引擎和 MCP server。
- editor `0.1.94` 是兼容的官方浏览器 editor bundle，负责画布渲染和交互。
- 本仓库负责 DSH 工具注册、会话/工作区绑定、Browser UI、editor IPC、保存确认和截图附件。
- 默认不会探测外部 Pencil app；只有显式设置 `DSH_PEN_MCP_APP` 才会连接。

`.pen` schema 固定为 `2.14`。升级 CLI 或 editor 前必须验证双方的 schema 和 IPC 兼容性，
否则可能无法打开文件或错误覆盖文件。

### 工作方式

- Harness 启动时不选择工作区，也不默认打开画布。
- 用户首次在会话内触发画布后，Host 绑定 Harness 真实 session 的工作区；浏览器传入的路径
  不能替代这个边界。
- 画布打开时，MCP 编辑进入该会话可见的 editor。工具只有在 `save-resource` 落盘并重新解析
  保存后的 JSON 后才返回成功。
- 画布关闭时，插件启动官方 headless 引擎。已有文件通过
  `interactive --in <file> --out <file>` 打开；编辑后发送 `save()`、等待回执并验证磁盘文件。
- 官方 CLI 共用全局 `pencil-cli.sock`，因此 headless 操作和引擎交接串行执行；不同 live
  canvas 使用各自的队列。

模型、浏览器 IPC、导入和导出路径都被限制在所属会话工作区内，并检查符号链接逃逸。
浏览器凭据使用原子替换保存，权限为 `0600`。

画布选区会在下一轮 Agent 启动时作为动态上下文注入，包含当前 `.pen` 文件和节点 ID。
外部修改文件时，干净画布自动重载；存在未保存修改时暂停保存并要求选择磁盘或画布版本。
Script 引用文件通过 editor 的 `watch-file` 协议实时刷新。

### 安装 beta

在已有可用 DeepSeek Harness Web profile 的前提下，安装 npm Bundle：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-with-pencil@beta
```

安装完成后重启 DSH Web（先用 `Ctrl-C` 停止正在运行的进程）：

```bash
npx @deepseek-ai/dsh web
```

这就是正常情况下的完整安装步骤。npm Bundle 会安装固定版本的官方 `@pen.dev/cli`。
用户第一次打开画布时，插件才会从 pen.dev 官方发行源直接下载 editor `0.1.94`，核对
固定的 SHA-256 校验值，并原子缓存到
`~/.dsh/dsh-with-pencil/editor/0.1.94/`。Harness 启动时不会下载或打开画布，之后再次
打开会直接使用已验证缓存。

npm 包本身不复制或再分发 browser editor。离线环境可以预先下载并解压相同的官方版本，
再用 `DSH_PEN_EDITOR_DIR` 指向它的 `out` 目录。

从本仓库进行本地开发安装：

```bash
npx @deepseek-ai/dsh plugin --profile web add file:/absolute/path/to/dsh-with-pencil
```

这里使用 `file:` 而不是 `link:`，让目标 profile 得到完整依赖树。从旧开发版迁移时，先移除
`pen-dev-bridge-bundle` 和 `pen-dev-bridge`，避免相同画布路由被注册两次。

开发用 profile 模板位于 `profiles/dsh-with-pencil-template/`。

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_PEN_EDITOR_DIR` | 可选的离线/开发覆盖项，指向官方 editor 的 `out` 目录 |
| `DSH_PEN_EDITOR_CACHE_DIR` | 覆盖自动下载缓存根目录；默认 `~/.dsh/dsh-with-pencil/editor` |
| `DSH_PEN_FILE` | 会话首次打开的 `.pen` 相对路径，默认 `designs/design.pen` |
| `DSH_PEN_CLI_BIN` / `DSH_PEN_MCP_BIN` | 覆盖官方 CLI/MCP 路径；通常无需设置 |
| `DSH_PEN_MCP_APP` | 显式连接外部 Pencil app；默认不自动探测 |
| `DSH_PEN_LEGACY_TOOLS` | 设为 `1` 时注册 5 个旧 CLI 助手 |
| `PEN_CLI_KEY` / `PENCIL_CLI_KEY` | pen.dev 组织 CLI key |
| `DSH_PEN_STATE_FILE` | Browser 登录态文件，默认 `~/.dsh/dsh-with-pencil/state.json`，并兼容读取旧路径 |

### 画布行为

- 首次打开为 42% 右侧分屏；拖动后按视口比例保存，也可切成浮动窗口。
- 顶栏提供工作区、`.pen` 文件、布局和关闭操作。
- editor iframe 在当前会话中保持挂载，Agent 切换文件时不会因重建 iframe 丢失引擎。
- 用户手工编辑每 6 秒触发保存；Agent 编辑逐次等待保存确认。
- “另存为”在工作区内创建新的 `.pen`，拒绝覆盖已有文件，自动切换到副本并保持原文件不变。
- 导入和生成的图片保存到设计旁的 `images/`；SVG 由官方 editor 转换成节点。
- 工作区 `*.lib.pen` 和官方 CLI 随附的只读库会出现在 editor 设计库列表中。
- 外部冲突和保存失败会一直显示在顶栏，不会静默覆盖脏文档。
- 插件退出时会在释放会话前冲洗仍有修改的画布。
- 固定版本 editor 只在首次打开画布时下载；下载、校验、解压或兼容性错误会在空白 iframe
  打开前明确显示。
- 尚未交付 editor 的取消请求会从队列删除；已交付的请求要求先检查画布状态再重试。

### 源码结构

```text
lib/index.js                 运行边界编排与依赖解析
lib/headless-runtime.js      官方 CLI/MCP 引擎生命周期
lib/model-tools.js           7 个模型工具与截图附件
lib/canvas-host.js           会话绑定、磁盘保存与 editor IPC 路由
lib/canvas-transport.js      请求队列、轮询、取消和响应
lib/editor-assets.js         官方 editor 定位、注入与静态资源
lib/editor-installer.js      固定版本下载、校验、安全解压与缓存
lib/ipc-binary.js            JSON Browser IPC 中的无损二进制传输
lib/session-store.js         Browser/CLI 登录态复用与安全保存
lib/workspace-resources.js   导入、生成图片、文件监听与设计库
lib/workspace-path.js        session 工作区和路径边界
lib/legacy-tools.js          可选的一次性 CLI 助手
lib/client.js                Harness 分屏/浮动画布 UI
cordis.patch.yml             DSH Bundle 与 Host 服务注入
profiles/dsh-with-pencil-template/  开发 profile 模板
tests/                       协议、保存、路径和资源测试
```

### 验证与许可

```bash
npm test
npm run release:check
```

测试模拟真实 Agent 调用和官方 editor IPC，覆盖实时编辑、选区上下文、原子保存、外部重载、
冲突、另存为、截图、取消、资源导入、生成图片、设计库和二进制 IPC。CI 在 macOS 与 Linux
上覆盖 Node 22/24。

发布门槛和回滚步骤见 [`docs/RELEASING.md`](docs/RELEASING.md)。本对接代码采用 MIT 许可；
官方 pen.dev 与 DeepSeek 组件不属于该许可，详见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
