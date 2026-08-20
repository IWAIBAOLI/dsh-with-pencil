# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/); prereleases are published under the
`beta` npm dist-tag.

## Unreleased

- Support Harness conversation image aliases (`latest` and `recent:N`) in
  `pencil_mcp_insert_image`, while preserving exact attachment-id and local-file
  inputs.
- Capture raw ImageBlocks before downstream vision wrappers translate them,
  clear the session registry on disposal, validate image node inputs, and remove
  orphaned assets when an insert is definitively rejected.
- Clarify that Harness `read_image` reads pixels for image-capable routes while
  `pencil_mcp_insert_image` places the original image asset on the Pencil canvas.
- Clarify `.pen` paths as relative to the exact session workspace (`cwd`) to
  prevent duplicated directory prefixes.

## 0.5.2 - 2026-08-20

- Add `pencil_mcp_insert_image`: place an image onto the `.pen` canvas using
  pen.dev's official image-fill. It writes the image into `images/` next to the
  `.pen` and inserts a `frame` with `fill: {type:"image", url, mode}`. Sources
  an image either from a chat attachment id (tracked from the conversation's
  durable image blocks) or a local file path. Optional `parentId` / `width` /
  `height` / `x` / `y` / `mode`.
- Internally track chat image attachments (`session-images`) so the tool can
  resolve "that image from the chat" by attachment id; the capture only records
  refs and never rewrites or strips content.

## 0.5.1 - 2026-08-18

- Fix plugin activation on Harness 0.1.0-rc.7, which keys the
  `settings.plugin.item` card slot by settings namespace: the card now
  registers with `key: 'pencil'` (its settings namespace), matching the new
  keyed slot contract while keeping `id` for older list-based hosts.

## 0.5.0 - 2026-08-18

- First stable release. Webview-first exports with shared session-file state:
  live-canvas edits/state/exports, headless CLI as fallback.
- Settings → Plugins → dsh-with-pencil card for the vision mode
  (text / multimodal), exposed through the llm configurable-provider
  directory (Harness settings-seam limitation; the Models-page entry is an
  annotated placeholder until the harness opens third-party settings).
- pencil_mcp_batch_get as the authoritative node/text read path.
- Screenshot fixes: workspace-scoped temp exports, whole-document screenshots
  via the webview global export (not the export_nodes tool), and 3x
  same-path export retries.

## 0.5.0-beta.6 - 2026-08-16

- Surface the `visionMode` setting as a real card in Settings → Plugins →
  dsh-with-pencil (radio options instead of a dropdown). The Harness settings
  seam only exposes allowlisted namespaces, so the card is served through the
  llm configurable-provider directory; the Models-page entry is annotated as
  an official-limitation placeholder until the harness opens third-party
  settings self-registration.
- Switch screenshots to webview-first exports with shared session-file state:
  live canvases now own edits/state/exports, headless CLI remains the fallback,
  and every open entry (agent, canvas UI, Save As) records the session's
  current file.
- Expose `pencil_mcp_batch_get` as the authoritative node/text read path, and
  describe it as such in the preset prompt.
- Fix screenshot resolution regressions: internal high-res export temp dirs
  moved inside the session workspace (the webview export path rejects
  out-of-workspace output dirs, which silently fell back to the 400px native
  thumbnail in every vision mode), and document screenshots now use the
  webview's whole-document export directly instead of the `export_nodes` tool.
- Retry exports on the same path 3 times (webview while a canvas is active,
  CLI otherwise) and report failures clearly instead of leaving the agent to
  retry blindly.

## 0.5.0-beta.5 - 2026-08-15

- Align the `pencil_mcp_execute` tool description with the headless engine's
  real snippet API: only `Update`, `Insert`, `Copy`, `Delete`, `Move`, `Set`,
  and `Replace` are defined. `Get`/`Print` (advertised in official docs) throw
  `ReferenceError` in headless mode, and `editId`/`edits` patch retries are
  unavailable, so the description now states the real operation list, the read
  paths, and the resend-after-failure flow instead of deferring to the official
  documentation chain.
- Prefix headless `pencil_mcp_get_app_state` results with the available
  operation list so the model never needs to probe the engine or research tool
  usage elsewhere.
- Update the preset prompt in the README to state that tool descriptions are
  the complete usage reference: no searching, probing, or verifying usage in
  any other way.

## 0.5.0-beta.4 - 2026-08-15

- Make the canvas chrome and embedded Pencil editor follow the resolved Harness
  light/dark theme automatically, including live system-theme changes.
- Remove light-only iframe and hover colors without adding a separate Pencil
  theme preference or manual plugin control.
- Add a user-facing export menu backed directly by the live official editor:
  selected nodes (or all top-level nodes) export to workspace-safe 2× PNG or
  PDF files, with an action to reveal the output folder.
- Match dropdown surfaces, borders, shadows, hover states, and compact spacing
  to the resolved Harness menu theme in both light and dark mode.
- Localize every plugin-owned canvas entry point and control from the active
  Harness locale service, updating live when that language changes; align the
  conversation and Float/Split actions with one compact Harness-style button.

## 0.5.0-beta.3 - 2026-08-15

- Make the normal installation genuinely one command: the first explicit
  canvas open downloads editor `0.1.94` directly from the official pen.dev
  release source and reuses its verified local cache afterward.
- Pin and verify the editor archive SHA-256, enforce download and extracted-size
  limits, reject unsafe ZIP paths and symbolic links, and install through a
  cross-process lock plus atomic directory rename.
- Keep `DSH_PEN_EDITOR_DIR` as an offline/development override and add
  `DSH_PEN_EDITOR_CACHE_DIR` for custom cache placement.
- Declare the two DSH browser client packages used by the public client bundle
  as peer dependencies.
- Document the exact DSH Web restart command after plugin installation.

## 0.5.0-beta.2 - 2026-08-15

- Prepare the first public npm beta after completing the npm account's release
  authentication requirements.
- Present the complete English README before Simplified Chinese and enforce the
  public documentation language order in release verification.

## 0.5.0-beta.1 - 2026-08-15

- Adopt the public package name `dsh-with-pencil` to describe DSH using the
  official Pencil capabilities without presenting the integration as a
  standalone product.
- Bind the live Pencil canvas to its owning Harness conversation and hide it in
  other conversations without discarding the editor session.
- Route Agent edits through the visible editor when open, with acknowledged,
  atomic disk saves; use a serialized official headless engine otherwise.
- Add selection context, model-visible screenshots, file/resource workflows,
  design libraries, external-change conflict handling and Save As.
- Add responsive split/floating layouts, stable pointer capture and concise
  workspace/file controls.
- Surface save failures with retry, flush dirty canvases during shutdown and
  preflight editor assets before opening.
- Split Host responsibilities into runtime, transport, assets, session,
  workspace and model-tool modules.
- Consolidate the former Host integration and wrapper Bundle into one installable DSH
  package, eliminating local `file:` dependencies from published artifacts.
