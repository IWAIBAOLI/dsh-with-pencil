# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/); prereleases are published under the
`beta` npm dist-tag.

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
