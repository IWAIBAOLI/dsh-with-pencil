# Releasing dsh-with-pencil

## Distribution shape

The repository root is the only publishable package. It is both the DSH Bundle
and the Host/Client implementation:

```text
dsh-with-pencil
├── package.json          dsh.bundle + dsh.client + runtime dependencies
├── cordis.patch.yml      mounts the Host plugin
├── lib/                  prebuilt Host and browser modules
└── README / LICENSE / THIRD_PARTY_NOTICES / CHANGELOG
```

The private profile under `profiles/` is only a development fixture. It must not
be published. There is no wrapper Bundle package and therefore no local
dependency to rewrite during publishing.

This follows the DSH Bundle contract: users install the package they activate,
while libraries without `dsh.bundle` are ordinary implementation dependencies.

## Current release blockers

The source intentionally keeps `private: true`. Do not remove it until all of
these are resolved:

1. Choose and reserve the final npm package name or owner scope.
2. Create the public source repository, configure `origin`, and add its
   `repository`, `bugs` and `homepage` metadata to `package.json`.
3. Confirm with pen.dev that this integration may download/use the official CLI
   and editor and may inject the local browser bootstrap described in the
   README. Do not copy either official artifact into this repository or npm
   tarball.
4. Decide how users obtain the compatible editor bundle. The beta currently
   requires `DSH_PEN_EDITOR_DIR`; an installer may download from an official
   pen.dev URL only after the relevant terms are confirmed.
5. Move to an official `@pen.dev/cli` release whose image stack includes a
   patched Sharp/libvips version, or obtain written vendor guidance for the
   pinned version. Do not force a transitive Sharp override without rerunning
   the editor/render/export compatibility suite.
6. Enable npm two-factor authentication or trusted publishing and private
   vulnerability reporting for the repository.

`npm run release:check` deliberately fails while these machine-checkable gates
remain unresolved.

## Beta preparation

1. Update the prerelease version in `package.json`, the profile fixture and
   `CHANGELOG.md`.
2. Keep `@pen.dev/cli` pinned until its schema and IPC behavior have been tested
   with the selected editor build.
3. Run:

   ```sh
   npm test
   npm run release:check
   npm pack --dry-run
   ```

4. Create the real tarball with `npm pack`. Install that tarball into a clean,
   disposable DSH profile—not from this checkout—and verify startup, login reuse,
   conversation switching, live Agent edits, autosave, Save As, conflicts,
   screenshots and shutdown flushing.
5. Inspect the tarball. It must contain only this project's code and notices;
   `@pen.dev/cli`, editor assets, DSH packages, credentials, `.pen` documents and
   absolute local paths must not be embedded.
6. Commit the version, tag the exact commit, then publish the beta without
   moving `latest`:

   ```sh
   npm publish --access public --tag beta --provenance
   ```

7. Install the published artifact in another clean profile:

   ```sh
   dsh plugin --profile pencil-beta add dsh-with-pencil@beta
   dsh --profile pencil-beta --dump-config
   dsh --profile pencil-beta
   ```

For a scoped name, use that exact scoped name in `package.json`,
`cordis.patch.yml`, the installation command and the profile fixture.

## Rollback

Never reuse or overwrite an npm version. If a beta is broken, deprecate that
exact version with an explanation, publish a new prerelease version, and move
the `beta` dist-tag only after the replacement passes the clean-profile smoke
test. Keep the Git tag and changelog entry for auditability.
