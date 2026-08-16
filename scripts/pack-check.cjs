#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const cache = path.join(os.tmpdir(), 'dsh-with-pencil-npm-pack-cache')

function dryRun(relative, required, allowed) {
  const cwd = path.join(root, relative)
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
  })
  const result = JSON.parse(output)[0]
  assert.ok(result, relative + ' did not produce npm pack metadata')
  const files = result.files.map((item) => item.path)
  for (const file of required) assert.ok(files.includes(file), relative + ' is missing ' + file)
  for (const file of files) assert.match(file, allowed, relative + ' includes unexpected file ' + file)
  assert.deepEqual(result.bundled || [], [], relative + ' must not bundle official or third-party dependencies')
  console.log(relative + ': ' + result.filename + ', ' + result.entryCount + ' files, no bundled dependencies')
}

dryRun('.', [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'CHANGELOG.md',
], /^(package\.json|cordis\.patch\.yml|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|CHANGELOG\.md|lib\/[a-z0-9-]+\.js|docs\/[A-Za-z0-9_-]+\.md)$/)

console.log('npm package contents: ok')
