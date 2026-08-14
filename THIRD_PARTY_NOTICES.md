# Third-party notices

`dsh-with-pencil` is an independent, unofficial integration. It is not endorsed
by, affiliated with, or maintained by pen.dev or DeepSeek.

## pen.dev / Pencil

The npm package declares `@pen.dev/cli@0.3.0` as a normal dependency. npm/pnpm
obtains that package from its official registry source; this repository and its
tarball do not copy or bundle the CLI.

The browser editor assets are also not included. Users must obtain a compatible
editor bundle from pen.dev and point `DSH_PEN_EDITOR_DIR` to its `out` directory.

The CLI, editor, Pencil name, pen.dev name, services and related assets remain
subject to their owners' terms and licenses. The MIT license for this repository
does not grant rights to those components. Review the current official terms
before installing or distributing a working integration:

- https://www.pen.dev/eula
- https://www.pen.dev/terms-of-use
- https://docs.pen.dev/for-developers/pencil-cli

## DeepSeek Harness

DeepSeek Harness packages are supplied by the target DSH installation or
resolved as peer dependencies. They are not copied or bundled into this npm
tarball and remain subject to their own licenses and terms.
