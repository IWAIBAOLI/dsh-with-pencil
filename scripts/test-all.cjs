#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const checks = [
  'scripts/verify.cjs',
  'scripts/pack-check.cjs',
  'tests/host-components.test.mjs',
  'tests/workspace-path.test.mjs',
  'tests/workspace-resources.test.mjs',
  'tests/live-canvas.test.mjs',
]

for (const relative of checks) {
  console.log('\n> node ' + relative)
  execFileSync(process.execPath, [path.join(root, relative)], { cwd: root, stdio: 'inherit' })
}

console.log('\nAll pen-dev-bridge checks passed.')
