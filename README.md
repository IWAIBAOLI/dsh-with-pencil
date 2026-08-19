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
- A responsive 42% split view with pointer-safe resizing and an optional
  floating layout.

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
> `pencil_mcp_open`, `pencil_mcp_get_app_state`,
> `pencil_mcp_get_guidelines`, `pencil_mcp_execute`,
> `pencil_mcp_get_screenshot`, `pencil_mcp_export_html`,
> `pencil_mcp_export_nodes`, and `pencil_mcp_insert_image`. Also bind one
> available vision tool and put its
> exact name in the persona; if none is available, ask the user.
>
> The persona must tell the Agent to complete `.pen` design tasks directly using
> only the design and vision tools assigned to this preset. Before calling a
> tool, read its own description and parameter definitions in the Agent's
> available-tools list; those descriptions are the complete usage reference —
> do not search for, probe, or verify usage anywhere else.
>
> The persona must require the Agent, when starting a new design, to first use
> `pencil_mcp_open` to create a `.pen` file inside the workspace, then edit, take
> screenshots, and visually verify it until it is saved. Verify visually with
> `pencil_mcp_get_screenshot` (a visual-fidelity spot check: colors, font
> rendering, alignment/spacing, layout positions; large nodes render at high
> resolution automatically). Verify text and property content with
> `pencil_mcp_batch_get` (node reads). Use
> `pencil_mcp_export_nodes` only for deliverable files. Do not use unspecified
> design tools or inspect any source code or repository to find tools or study
> their usage. Prefer the assigned design tools for `.pen` edits; do not treat
> direct JSON editing as the default.
>
> When finished, report the preset name/path, the bound vision tool, and how to
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
  alignment). Large nodes and whole documents render at high resolution
  automatically; with the canvas closed you get a compressed screenshot and a
  hint to open the canvas.
- `pencil_mcp_export_html` — export nodes to HTML.
- `pencil_mcp_export_nodes` — export nodes to image files (deliverables).
- `pencil_mcp_insert_image` — place an image onto the canvas using pen.dev's
  official image-fill: writes the image into `images/` next to the `.pen` and
  inserts a `frame` whose `fill` is `{type:"image", url, mode}`. Accepts a chat
  image attachment id (from an image uploaded in this conversation) or a local
  image file path; optional `parentId` / `width` / `height` / `x` / `y` / `mode`
  (fit|fill|stretch). Width/height default to 400×300 when omitted (the engine
  cannot auto-size an image-fill node).

### Configuration

`visionMode` (Settings → Plugins → dsh-with-pencil, default `text`):

- `text` — for DeepSeek and other non-multimodal models. Screenshots route to
  high-resolution rendering so image transcription stays reliable. Image
  transcription itself is **not provided by this plugin**: it depends on the
  deployment's vision plugin (e.g. `dsh-vision-proxy`). Without one, images
  reach the model only as markers.
- `multimodal` — native screenshots; the model sees the pixels itself.

The setting card lives in **Settings → Plugins → dsh-with-pencil** and takes
effect immediately after saving. First installs default to `text`.

For implementation details see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Install

With a working DeepSeek Harness Web profile, install the npm bundle:

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-with-pencil
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
- The canvas chrome and Pencil editor follow the active Harness/system light or
  dark theme automatically; the plugin adds no separate theme control.
- The toolbar contains workspace, `.pen` file, export, layout, and close
  controls. These plugin-owned controls follow the active Harness language;
  the official Pencil editor keeps its upstream English interface.
- The editor iframe stays mounted within its conversation, including when the
  Agent changes the active file.
- Manual edits autosave every six seconds; Agent edits await a save after every
  successful operation.
- Save As writes a new `.pen` inside the workspace, never overwrites an existing
  target, switches the canvas to the copy, and leaves the source unchanged.
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

Maintainers: see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
runtime design and [`docs/RELEASING.md`](docs/RELEASING.md) for release gates.
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
- 默认 42% 的响应式右侧分屏，拖动过程中保持指针控制，也可切成浮动窗口。

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
> `pencil_mcp_get_app_state`、`pencil_mcp_get_guidelines`、
> `pencil_mcp_execute`、`pencil_mcp_get_screenshot`、
> `pencil_mcp_export_html`、`pencil_mcp_export_nodes`、
> `pencil_mcp_insert_image`，不再指定其他设计工具。
> 同时绑定一个可用的视觉工具，并把准确工具名写入 Persona；没有视觉工具则询问用户。
>
> Persona 应要求 Agent 直接完成 `.pen` 设计任务，只使用该 Preset 指定的设计工具和视觉
> 工具。调用前查看 Agent 可用工具列表中这些工具自带的说明和参数定义；这些说明即完整
> 用法，不得再去其他地方查找、试探测或验证用法。
>
> Persona 应要求 Agent 在新建设计时，先用 `pencil_mcp_open` 创建工作区内的 `.pen`
> 文件，再使用指定工具编辑、截图并进行视觉验证，直至保存完成。视觉验证使用
> `pencil_mcp_get_screenshot` 做视觉保真抽查（颜色、字体渲染、对齐/间距、布局
> 位置；大节点与整文档自动走高清渲染）。文字与属性内容用
> `pencil_mcp_batch_get` 按节点读取验证。`pencil_mcp_export_nodes` 仅用于交付
> 文件产物。不得使用未指定的设计工具，不得通过翻查任何源码或仓库来寻找工具、研究
> 用法。编辑 `.pen` 时优先使用指定设计工具，不把直接修改 JSON 作为默认方式。
>
> 创建完成后，报告 Preset 名称或路径、绑定的视觉工具和选择方法；不要修改其他 Preset。

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
- `pencil_mcp_get_screenshot` — 视觉保真抽查（颜色、字体、对齐）。大节点与整文档自动
  走高清渲染；画布未打开时返回压缩截图并提示打开画布。
- `pencil_mcp_export_html` — 导出节点为 HTML。
- `pencil_mcp_export_nodes` — 导出节点为图片文件（交付物）。
- `pencil_mcp_insert_image` — 用 pen.dev 官方 image-fill 把图片放进画布：把图片写入
  `.pen` 旁的 `images/` 并插入一个 `fill:{type:"image",url,mode}` 的 frame。接受
  聊天图片附件 id 或本地图片路径；可选 `parentId`/`width`/`height`/`x`/`y`/`mode`
  （fit|fill|stretch）。未指定尺寸时默认 400×300（引擎无法对 image-fill 节点自动算尺寸）。

### 配置

`visionMode`（设置 → 插件 → dsh-with-pencil，默认 `text`）：

- `text` — 适用于 DeepSeek 等非多模态模型。截图自动走高清渲染，保证图片转译的可靠性。
  **本插件不提供图片转译模块**：转译依赖部署方的视觉插件（如 `dsh-vision-proxy`）；
  没有视觉插件时，图片对模型只显示为标记。
- `multimodal` — 使用原生截图，模型自己看像素。

配置卡片位于 **设置 → 插件 → dsh-with-pencil**，保存后立即生效；首次安装默认
`text`。

实现细节见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

### 安装

在已有可用 DeepSeek Harness Web profile 的前提下，安装 npm Bundle：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-with-pencil
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
- 画布外框和 Pencil editor 自动跟随 Harness/系统的明暗主题；插件不增加单独的主题开关。
- 顶栏提供工作区、`.pen` 文件、导出、布局和关闭操作。这些插件自有控件跟随当前 Harness
  语言；官方 Pencil editor 保持其上游英文界面。
- editor iframe 在当前会话中保持挂载，Agent 切换文件时不会因重建 iframe 丢失引擎。
- 用户手工编辑每 6 秒触发保存；Agent 编辑逐次等待保存确认。
- “另存为”在工作区内创建新的 `.pen`，拒绝覆盖已有文件，自动切换到副本并保持原文件不变。
- 导出直接读取当前可见 editor：有选区时导出选区，否则导出全部顶层元素；可输出 2× PNG
  或 PDF 到 `exports/<文档名>/`，并从结果菜单直接打开该文件夹。
- 导入和生成的图片保存到设计旁的 `images/`；SVG 由官方 editor 转换成节点。
- 工作区 `*.lib.pen` 和官方 CLI 随附的只读库会出现在 editor 设计库列表中。
- 外部冲突和保存失败会一直显示在顶栏，不会静默覆盖脏文档。
- 插件退出时会在释放会话前冲洗仍有修改的画布。
- 固定版本 editor 只在首次打开画布时下载；下载、校验、解压或兼容性错误会在空白 iframe
  打开前明确显示。
- 尚未交付 editor 的取消请求会从队列删除；已交付的请求要求先检查画布状态再重试。

维护者请参阅 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（运行时设计）和
[`docs/RELEASING.md`](docs/RELEASING.md)（发布门槛）。本对接代码采用 MIT 许可；
官方 pen.dev 与 DeepSeek 组件不属于该许可，详见
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
