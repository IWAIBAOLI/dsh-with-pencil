# dsh-with-pencil

[![Awesome DSH Plugin](https://beancookie.github.io/awesome-dsh-plugin/badge.svg)](https://beancookie.github.io/awesome-dsh-plugin)

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
- Workspace-safe file opening, creation, Save As, live PNG/PDF export, imports,
  generated images, design libraries, external-change reloads, and conflict
  resolution.
- A native DSH right-Sidebar tab with the built-in split, resize, float, and
  session layout restoration controls.

The plugin registers nine core model tools:

- `pencil_mcp_open`
- `pencil_mcp_get_app_state`
- `pencil_mcp_batch_get`
- `pencil_mcp_get_guidelines`
- `pencil_mcp_execute`
- `pencil_mcp_get_screenshot`
- `pencil_mcp_export_html`
- `pencil_mcp_export_nodes`
- `pencil_mcp_insert_image`

### Create a Pencil Agent preset

Send this prompt once in a normal Harness conversation:

> Create and validate a Harness Agent Preset named **Pencil Designer**; do not
> merely explain the steps. Base it on the standard coding preset and retain the
> fixed official tools.
>
> Assign these Pencil design tools to the preset, and no other design tools:
> `pencil_mcp_open`, `pencil_mcp_get_app_state`, `pencil_mcp_batch_get`,
> `pencil_mcp_get_guidelines`, `pencil_mcp_execute`,
> `pencil_mcp_get_screenshot`, `pencil_mcp_export_html`,
> `pencil_mcp_export_nodes`, and `pencil_mcp_insert_image`. Bind Harness
> `read_image` if available for local image files. With DeepSeek-V4.1-Flash,
> the model can inspect screenshot attachments directly.
>
> The persona must tell the Agent to complete `.pen` design tasks directly using
> only the tools assigned to this preset. Before calling a
> tool, read its own description and parameter definitions in the Agent's
> available-tools list; those descriptions are the complete usage reference —
> do not search for, probe, or verify usage anywhere else.
>
> The persona must require the Agent, when starting a new design, to first use
> `pencil_mcp_open` to create a `.pen` file inside the workspace, then edit, take
> screenshots, and visually verify it until it is saved. Verify visually with
> `pencil_mcp_get_screenshot` (a visual-fidelity spot check: colors, font
> rendering, alignment/spacing, layout positions). Verify text and property content with
> `pencil_mcp_batch_get` (node reads). Use
> `pencil_mcp_export_nodes` only for deliverable files. Do not use unspecified
> design tools or inspect any source code or repository to find tools or study
> their usage. Prefer the assigned design tools for `.pen` edits; do not treat
> direct JSON editing as the default.
>
> When finished, report the preset name/path and how to
> select the preset. Do not modify any other preset.

Five legacy one-shot CLI helpers are hidden by default to avoid duplicated
capabilities and irrelevant model context. Set `DSH_PEN_LEGACY_TOOLS=1` only
when compatibility requires `status`, `login`, `workspaces`, `design`, and
`export`.

### Model tools

- `pencil_mcp_open` — open/switch the conversation's `.pen` file; call FIRST
  for any design work.
- `pencil_mcp_get_app_state` — current document state; `include_schema: true`
  returns the `.pen` schema.
- `pencil_mcp_batch_get` — read node data (text content, properties) by ID or
  pattern — the authoritative way to verify text and attribute values.
- `pencil_mcp_get_guidelines` — design guides and styles.
- `pencil_mcp_execute` — edit the document with a JS snippet
  (`Update`/`Insert`/`Copy`/`Delete`/`Move`/`Set`/`Replace`).
- `pencil_mcp_get_screenshot` — visual-fidelity spot check (colors, fonts,
  alignment). The default native-vision path uses Pencil's native screenshot;
  the vision-translation mode uses high-resolution export for large nodes and
  whole documents when the canvas is open.
- `pencil_mcp_export_html` — export nodes to HTML.
- `pencil_mcp_export_nodes` — export nodes to image files (deliverables).
- `pencil_mcp_insert_image` — place an image onto the canvas using pen.dev's
  official image-fill: writes the image into `images/` next to the `.pen` and
  inserts a `frame` whose `fill` is `{type:"image", url, mode}`. Accepts a chat
  image as `latest`, `recent:N` (`recent:1` = latest), an exact attachment id,
  or a local image file path; optional `parentId` / `width` / `height` / `x` /
  `y` / `mode` (fit|fill|stretch). Width/height default to 400×300 when omitted
  (the engine cannot auto-size an image-fill node).

Harness's native `read_image` and this tool have separate jobs: `read_image`
loads pixels into an image-capable model's context, while
`pencil_mcp_insert_image` copies the original attachment into the `.pen`
workspace and places it on the canvas. This plugin does not replace or register
`read_image`.

### Configuration

`visionMode` (Plugins → dsh-with-pencil → Configure, default `multimodal`):

- `multimodal` — native screenshots for an image-capable model. The default
  Harness `deepseek-flash` entry is DeepSeek-V4.1-Flash and declares image
  input. No separate image-transcription plugin is needed for this route.
- `text` — high-resolution screenshots and a visual-fidelity instruction for
  an image-capable *vision-translation wrapper* (for example,
  `dsh-vision-proxy` or a `dsh-vision-router` wrapper). This plugin does not
  translate images itself. A direct text-only Harness route cannot consume
  screenshot attachments, even with this setting.

The plugin checks the active session route's declared image input before each
screenshot. The setting takes effect immediately after saving. If a profile
already has an explicit `text` override, use **Reset to default** to select
native vision. The default `deepseek-v4-pro` entry is text-only, so it cannot
consume screenshots. Custom model catalog entries must declare image input
themselves.

### Install

Version `0.7.0` targets Harness `0.2.0-rc.2` only. Existing `0.6.0`
`visionMode` settings continue to work. When migrating from `0.5.x` or older,
configure `visionMode` again in the Plugins page.

Install the npm bundle into a DeepSeek Harness
`0.2.0-rc.2` Web profile:

```bash
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add dsh-with-pencil@0.7.0
```

Restart DSH Web after installation (`Ctrl-C` the running process first):

```bash
npx @deepseek-ai/dsh@0.2.0-rc.2 web
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
npm run dev:install -- --profile web
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

`dev:install` runs the complete test suite, packs the exact publishable files
into `.dev-builds/` with a content hash in the tarball name, installs that
unique snapshot, and verifies the installed files. This avoids pnpm reusing an
old same-version `file:` snapshot and avoids the duplicate native libraries a
source `link:` can load. Stop the running DSH process before installation and
restart it afterward. Use `npm run dev:pack` only when an install is not needed.

When migrating from an older development build, remove `pen-dev-bridge-bundle`
and `pen-dev-bridge` first so the same canvas routes are not registered twice.

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

- The conversation button opens a `pen.dev Canvas` tab in DSH's right Sidebar.
  DSH owns tab placement, split, resize, float, and per-session layout recovery.
  Reopening the canvas focuses its existing tab.
- The canvas chrome and Pencil editor follow the active Harness/system light or
  dark theme automatically; the plugin adds no separate theme control.
- The toolbar contains workspace, `.pen` file, and export controls. DSH provides
  the tab and layout controls. Plugin-owned controls follow the active Harness
  language; the official Pencil editor keeps its upstream English interface.
- Closing the tab saves pending canvas edits before releasing the live editor.
  If saving fails, the tab stays open and shows the error for a retry.
- The iframe container stays mounted within its conversation. Switching `.pen`
  files saves the previous document and reloads the official editor with the new
  file URI; its internal resource base is fixed at initialization. This resets
  transient selection/undo state for the newly opened document.
- Manual edits autosave every six seconds; Agent edits await a save after every
  successful operation.
- Save As writes a new `.pen` inside the workspace, never overwrites an existing
  target, switches the canvas to the copy, and leaves the source unchanged. The
  official serializer rebases resource URLs for the destination; assets remain
  in their existing locations. Cross-directory moves require opening the source
  in the canvas first so the same serializer can preserve its resources.
- Export uses the live editor state: it writes the selected nodes, or every
  top-level node when nothing is selected, as 2× PNG files or a PDF under
  `exports/<document-name>/`. The result menu can open that folder directly.
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

The integration's `lib/session-file.js` owns the conversation's current `.pen`
path, encoded file URI, directory, and switch revision. The canvas, resource
imports, and headless fallback all use that identity; closing a renderer does
not clear it. A dropped image travels through the official editor's binary
import request → host writes to the current `.pen`'s `images/` → relative URL
returned → editor resolves it against that same file URI → host reads bytes →
official image fill renders. Late messages from a previous document revision
are rejected. `pencil_mcp_insert_image` also refuses a mismatched `filePath` or a
document switch during asset preparation; call `pencil_mcp_open` first to select
a different file. No official editor source or bundle is patched.

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
- 在会话工作区边界内提供文件打开、新建、另存为、实时 PNG/PDF 导出、资源导入、
  生成图片、设计库、外部修改重载和冲突处理。
- 使用 DSH 原生右侧栏标签页，支持内置分屏、调整宽度、浮窗和按会话恢复布局。

插件默认注册 9 个核心模型工具：

- `pencil_mcp_open`
- `pencil_mcp_get_app_state`
- `pencil_mcp_batch_get`
- `pencil_mcp_get_guidelines`
- `pencil_mcp_execute`
- `pencil_mcp_get_screenshot`
- `pencil_mcp_export_html`
- `pencil_mcp_export_nodes`
- `pencil_mcp_insert_image`

### 创建 Pencil Agent Preset

在普通 Harness 会话中发送一次以下提示词：

> 请实际创建并验证一个名为「Pencil 设计」的 Harness Agent Preset，不要只说明步骤。
> 基于标准编码 Preset，保留官方固定工具。
>
> 为该 Preset 指定以下 Pencil 设计工具：`pencil_mcp_open`、
> `pencil_mcp_get_app_state`、`pencil_mcp_batch_get`、`pencil_mcp_get_guidelines`、
> `pencil_mcp_execute`、`pencil_mcp_get_screenshot`、
> `pencil_mcp_export_html`、`pencil_mcp_export_nodes`、
> `pencil_mcp_insert_image`，不再指定其他设计工具。
> 如有 Harness `read_image`，可绑定它读取本地图片。DeepSeek-V4.1-Flash 可直接查看
> 截图工具返回的图片附件。
>
> Persona 应要求 Agent 直接完成 `.pen` 设计任务，只使用该 Preset 指定的工具。
> 调用前查看 Agent 可用工具列表中这些工具自带的说明和参数定义；这些说明即完整
> 用法，不得再去其他地方查找、试探测或验证用法。
>
> Persona 应要求 Agent 在新建设计时，先用 `pencil_mcp_open` 创建工作区内的 `.pen`
> 文件，再使用指定工具编辑、截图并进行视觉验证，直至保存完成。视觉验证使用
> `pencil_mcp_get_screenshot` 做视觉保真抽查（颜色、字体渲染、对齐/间距、布局
> 位置）。文字与属性内容用
> `pencil_mcp_batch_get` 按节点读取验证。`pencil_mcp_export_nodes` 仅用于交付
> 文件产物。不得使用未指定的设计工具，不得通过翻查任何源码或仓库来寻找工具、研究
> 用法。编辑 `.pen` 时优先使用指定设计工具，不把直接修改 JSON 作为默认方式。
>
> 创建完成后，报告 Preset 名称或路径及选择方法；不要修改其他 Preset。

为避免重复能力和无关上下文，5 个旧的一次性 CLI 助手默认隐藏。仅在兼容需要时设置
`DSH_PEN_LEGACY_TOOLS=1`，恢复 `status`、`login`、`workspaces`、`design` 和
`export`。

### 模型工具

- `pencil_mcp_open` — 打开/切换会话的 `.pen` 文件；任何设计任务先调用它。
- `pencil_mcp_get_app_state` — 当前文档状态；`include_schema: true` 返回 `.pen` schema。
- `pencil_mcp_batch_get` — 按节点 ID/模式读取节点数据（文字内容、属性）——验证文字与
  属性值的权威方式。
- `pencil_mcp_get_guidelines` — 设计指南与样式。
- `pencil_mcp_execute` — 用 JS 片段编辑文档（`Update`/`Insert`/`Copy`/`Delete`/
  `Move`/`Set`/`Replace`）。
- `pencil_mcp_get_screenshot` — 视觉保真抽查（颜色、字体、对齐）。默认的原生视觉
  路径使用 Pencil 原生截图；图像转译模式在画布打开时对大节点和整文档使用高清导出。
- `pencil_mcp_export_html` — 导出节点为 HTML。
- `pencil_mcp_export_nodes` — 导出节点为图片文件（交付物）。
- `pencil_mcp_insert_image` — 用 pen.dev 官方 image-fill 把图片放进画布：把图片写入
  `.pen` 旁的 `images/` 并插入一个 `fill:{type:"image",url,mode}` 的 frame。接受
  `latest`、`recent:N`（`recent:1` 即最新图片）、准确附件 id 或本地图片路径；可选
  `parentId`/`width`/`height`/`x`/`y`/`mode`（fit|fill|stretch）。未指定尺寸时默认
  400×300（引擎无法对 image-fill 节点自动算尺寸）。

Harness 原生 `read_image` 与本工具职责不同：`read_image` 把像素送入具备图片能力的
模型上下文，`pencil_mcp_insert_image` 则把原始附件复制到 `.pen` 工作区并放进画布。
本插件不会替换或注册 `read_image`。

### 配置

`visionMode`（插件 → dsh-with-pencil → 配置，默认 `multimodal`）：

- `multimodal` — 适用于支持图片输入的模型，使用原生截图。Harness 默认的
  `deepseek-flash` 条目对应 DeepSeek-V4.1-Flash，已声明图片输入；这条路由不需要
  额外的图片转译插件。
- `text` — 仅供支持图片输入的**图像转译包装路由**使用，提供高清截图及视觉保真
  提示；例如 `dsh-vision-proxy` 或 `dsh-vision-router` 的包装路由。本插件本身不做
  图片转译。Harness 直连纯文本路由即使选择此模式，也无法消费截图附件。

插件在每次截图前检查当前会话路由是否声明图片输入。配置保存后立即生效；如果
Profile 已显式保存 `text`，请点**重置为默认**切回原生视觉。自定义模型目录条目须
自行声明图片输入。默认的 `deepseek-v4-pro` 条目仅支持文字，因此不能消费截图。

### 安装

`0.7.0` 仅支持 Harness `0.2.0-rc.2`。已有的 `0.6.0` `visionMode` 配置继续有效。
从 `0.5.x` 或更早的插件版本升级时，请在插件页重新设置 `visionMode`。

在已有 DeepSeek Harness `0.2.0-rc.2` Web profile 中安装 npm Bundle：

```bash
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add dsh-with-pencil@0.7.0
```

安装完成后重启 DSH Web（先用 `Ctrl-C` 停止正在运行的进程）：

```bash
npx @deepseek-ai/dsh@0.2.0-rc.2 web
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
npm run dev:install -- --profile web
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

`dev:install` 会先运行完整测试，再把实际可发布文件打成文件名带内容哈希的唯一 tarball，
安装该快照并核对安装文件。这样既不会命中 pnpm 的同版本 `file:` 旧快照，也不会像源码
`link:` 一样加载重复的原生库。安装前先停止 DSH，安装后重新启动。只需要构建、不安装时
使用 `npm run dev:pack`。从旧开发版迁移时，先移除 `pen-dev-bridge-bundle` 和
`pen-dev-bridge`，避免相同画布路由被注册两次。

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

- 会话按钮会在 DSH 右侧栏打开 `pen.dev 画布` 标签页。DSH 负责标签页位置、
  分屏、调整宽度、浮窗和按会话恢复布局；再次打开会定位到已有标签页。
- 画布外框和 Pencil editor 自动跟随 Harness/系统的明暗主题；插件不增加单独的主题开关。
- 画布顶栏提供工作区、`.pen` 文件和导出操作；标签页与布局操作由 DSH 提供。
  插件自有控件跟随当前 Harness 语言；官方 Pencil editor 保持其上游英文界面。
- 关闭标签页前会先保存待写入的画布修改，再释放在线编辑器；若保存失败，标签页会保留并显示错误，供重试。
- iframe 容器在当前会话中保持挂载。切换 `.pen` 时先保存旧文档，再以新文件 URI
  重新初始化官方 editor，因为它的资源基准路径在初始化时固定；新打开文档的选区和撤销历史会重置。
- 用户手工编辑每 6 秒触发保存；Agent 编辑逐次等待保存确认。
- “另存为”在工作区内创建新的 `.pen`，拒绝覆盖已有文件，自动切换到副本并保持原文件不变。
  由官方序列化接口按目标位置转换资源相对路径，素材保留在原位置；跨目录移动需先在画布打开源文件。
- 导出直接读取当前可见 editor：有选区时导出选区，否则导出全部顶层元素；可输出 2× PNG
  或 PDF 到 `exports/<文档名>/`，并从结果菜单直接打开该文件夹。
- 导入和生成的图片保存到设计旁的 `images/`；SVG 由官方 editor 转换成节点。
- 工作区 `*.lib.pen` 和官方 CLI 随附的只读库会出现在 editor 设计库列表中。
- 外部冲突和保存失败会一直显示在顶栏，不会静默覆盖脏文档。
- 插件退出时会在释放会话前冲洗仍有修改的画布。
- 固定版本 editor 只在首次打开画布时下载；下载、校验、解压或兼容性错误会在空白 iframe
  打开前明确显示。
- 尚未交付 editor 的取消请求会从队列删除；已交付的请求要求先检查画布状态再重试。

接入层的 `lib/session-file.js` 统一管理会话当前 `.pen` 的绝对路径、编码后的文件 URI、
所在目录及切换版本。画布、图片导入与无界面引擎都使用这份身份；关闭渲染器不会清空当前文件。
拖图链路为：官方 editor 发送图片字节 → 宿主存入当前 `.pen` 旁的 `images/` → 返回相对路径
→ editor 基于同一个文件 URI 解析 → 宿主读取图片字节 → 官方图片填充渲染。
旧文档版本的迟到消息会被拒绝；`pencil_mcp_insert_image` 也会拒绝与当前文件不一致的
`filePath` 或准备图片期间的文件切换。要操作其他文件，请先调用 `pencil_mcp_open`。
整个过程不修改官方 editor 源码或打包文件。

本对接代码采用 MIT 许可；官方 pen.dev 与 DeepSeek 组件不属于该许可，详见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
