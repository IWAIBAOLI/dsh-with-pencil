# dsh-with-pencil — Architecture

Implementation notes for maintainers. End users should read the README; this
document explains *why* the plugin routes work the way they do.

## Runtime boundaries

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

## Two renderers, one document

There are two independent renderers:

- **Webview**: the official editor iframe inside the Harness canvas. Reliable
  for whole-document rendering (complex gradients/shadows), used by the manual
  export menu. Its screenshot endpoint is a *viewport* image that ignores
  `nodeId`, so it cannot serve node screenshots.
- **Headless engine** (`@pen.dev/cli` interactive): node-accurate screenshots
  (each node renders at its own aspect), but complex nodes can time out or fail
  on large-scale exports with misleading "wrong .pen file" errors.

### Tool routing (`headless-runtime.js`)

`execute`, `get_app_state` and `export_nodes` prefer the webview when the
canvas is active (`canvasBridge.has` = binding initialized and seen recently);
otherwise they use the headless engine. `get_screenshot`, `batch_get` and
`get_guidelines` always run headless — the webview cannot screenshot a node,
and the data tools do not need a canvas.

A connecting canvas (binding exists but not yet initialized) is worth waiting
for; a stale binding (hidden too long, heartbeat expired >30s) falls back to
headless so calls never stall.

### Document consistency

- The session's current working file is a shared datum
  (`lib/session-file.js`): every switch — agent `open`, the canvas UI file
  menu, Save As, rename/delete fallback, webview `set-current-file` — records
  it, and tool calls operate on it (`runMcpNow` reads it first). The webview
  and the headless engine therefore never look at different files.
- The headless engine records the file mtime at load and reloads automatically
  when it changes (`ensureEngine`), so a live canvas save and a headless read
  never drift apart.
- The webview saves to disk after every successful edit
  (`save-resource` reaches disk and the JSON is parsed again).

### Export retry policy

Exports retry up to 3 times, always on the same path: an active canvas retries
the webview renderer (never switching to CLI — CLI is less reliable while a
canvas is live); no canvas retries the CLI engine (covers cold-start warming,
where the first complex render times out at the server's 60s cap and later
attempts succeed). `get_screenshot` falls back to the native screenshot after
retries; `export_nodes`/`export_html` return a clear failure message.

## Screenshot strategy (`visionMode`)

`visionMode` is a global vision-capability setting (Settings → Plugins →
dsh-with-pencil; default `text`). Future visual adaptations hang off it.
It is a user preference in the `pencil` settings namespace, registered by the
plugin through the Host settings service (`ctx.settings.register`); the patch
layer's `config.visionMode` only seeds the composition base. The client card
(`settings.plugin.item`) writes through the settings scope, and a namespace
watcher flips the live `vision.mode` holder, so a save takes effect without a
restart.

- **`text`** (DeepSeek and other non-multimodal models): image transcription
  needs clarity, so screenshots route to high-resolution rendering:
  - Small nodes (≤640px) use the native headless screenshot.
  - Large nodes export through the webview renderer (CLI fallback + 3 retries).
  - `document` goes through the webview's global document export
    (`exporter.run`) and the exported node images are composed back into one
    document view by document coordinates (sharp); if the canvas is closed,
    the fallback is the native low-res document screenshot with an explicit
    "open the canvas for full resolution" note.
  - Screenshot attachments carry a `visual-fidelity` `instruction` field as a
    *declaration*: a translation layer that reads it can ask the VLM for
    colors/fonts/alignment instead of OCR; layers that ignore it (the current
    third-party one) simply use their default prompt — the field is additive
    and needs no capability probing.
- **`multimodal`**: the model sees pixels itself — native screenshots, no
  instruction, official spot-check semantics.

Note: the plugin does **not** provide an image-transcription module. In `text`
mode, transcription depends on the deployment's vision plugin (e.g.
`dsh-vision-proxy` / a vision router); without one, images reach the model only
as markers.

## Headless DSL subset

The headless snippet API is a strict subset of the official DSL: only
`Update`, `Insert`, `Copy`, `Delete`, `Move`, `Set`, and `Replace` are defined.
`Get`/`Print` (advertised in official docs) throw `ReferenceError` and roll
back the whole call, so the plugin's tool description states the real list
instead of deferring to the official documentation chain.

The official CLI shares a global `pencil-cli.sock`, so headless operations and
engine handoffs are serialized. Independent live canvases keep separate queues.

## Boundaries and lifecycle

- Model paths, browser IPC paths, imports, and exports are restricted to the
  owning conversation workspace, including symlink-aware escape checks.
  Browser credentials are atomically persisted with mode `0600`.
- Selected nodes are injected into the next Agent turn with the current `.pen`
  file and node IDs. Clean canvases reload external file changes automatically;
  dirty canvases stop saving and ask which version to keep. Script references
  are refreshed through the editor's `watch-file` protocol.
- Session teardown clears the shared current-file datum and flushes dirty
  canvases before releasing bindings.

## Source layout

```text
lib/index.js                 Runtime composition, config, dependency resolution
lib/session-file.js          Session current-file shared datum
lib/headless-runtime.js      Official CLI/MCP engine lifecycle + tool routing
lib/model-tools.js           Model tools, screenshot routing, attachments
lib/canvas-host.js           Session binding, persistence, editor IPC routes
lib/canvas-export.js         Live selection/document PNG and PDF export
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

## Verification and licensing

```bash
npm test
npm run release:check
```

Tests simulate real Agent calls and official editor IPC, including live edits,
selection context, atomic saves, external reloads, conflicts, Save As, live
PNG/PDF export, screenshots, cancellation, imports, generated assets, libraries,
and binary IPC.
CI covers Node 22 and 24 on macOS and Linux.

See [`docs/RELEASING.md`](RELEASING.md) for release gates and rollback.
This integration is MIT licensed; official pen.dev and DeepSeek components are
not. See [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
