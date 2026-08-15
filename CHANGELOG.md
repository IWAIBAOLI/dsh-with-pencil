# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/); prereleases are published under the
`beta` npm dist-tag.

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
