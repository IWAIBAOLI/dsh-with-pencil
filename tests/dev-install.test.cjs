#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-with-pencil-dev-build-test-'))

try {
  const output = execFileSync(process.execPath, [
    path.join(root, 'scripts', 'dev-install.cjs'),
    '--pack-only', '--skip-tests', '--output-dir', outputDir,
  ], { cwd: root, encoding: 'utf8' })
  const artifacts = fs.readdirSync(outputDir).filter((name) => name.endsWith('.tgz'))
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].startsWith('dsh-with-pencil-' + pkg.version + '-'), true)
  assert.match(artifacts[0], /-[a-f0-9]{12}\.tgz$/)
  assert.match(output, /Built cache-safe snapshot:/)
  const listing = execFileSync('tar', ['-tzf', path.join(outputDir, artifacts[0])], { encoding: 'utf8' })
  assert.match(listing, /package\/lib\/model-tools\.js/)
  assert.match(listing, /package\/cordis\.patch\.yml/)
  console.log('cache-safe development snapshot: ok')
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true })
}
