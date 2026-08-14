#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const errors = []
const warnings = []
const fail = (message) => errors.push(message)

if (pkg.private === true) fail('package.json still has "private": true')
if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(pkg.name || '')) fail('package name is missing or invalid')
if (!/-[0-9A-Za-z.-]+$/.test(pkg.version || '')) warnings.push('version is not a prerelease; first public release should remain beta')

const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
if (!repository || /<|>|example|placeholder/i.test(repository)) fail('repository URL is missing or still a placeholder')

for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
  if (/^(file|link|workspace):/.test(spec)) fail(`dependency ${name} is not publishable: ${spec}`)
}

const requiredFiles = ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']
for (const file of requiredFiles) {
  if (!pkg.files?.includes(file)) fail(`package.json files list is missing ${file}`)
  if (!fs.existsSync(path.join(root, file))) fail(`release file is missing: ${file}`)
}

if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('dsh.bundle.patch must point to ./cordis.patch.yml')
if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform must be web')

const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
const escapedName = String(pkg.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
if (!new RegExp(`name:\\s*['"]?${escapedName}['"]?(?:\\s|$)`).test(patch)) {
  fail(`cordis.patch.yml does not insert the published package name ${pkg.name}`)
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes(`## ${pkg.version} `)) fail(`CHANGELOG.md has no heading for ${pkg.version}`)

try {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
  if (status) fail('git worktree is not clean')
} catch (error) {
  fail('unable to verify git worktree: ' + error.message)
}

try {
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!origin) fail('git origin is not configured')
} catch {
  fail('git origin is not configured')
}

for (const warning of warnings) console.warn('warning: ' + warning)
if (errors.length) {
  console.error('Release is intentionally blocked:')
  for (const error of errors) console.error('- ' + error)
  console.error('\nSee docs/RELEASING.md before changing these gates.')
  process.exit(1)
}

console.log('Automated release gates passed.')
console.log('Manual gate remains: confirm pen.dev CLI/editor use and distribution terms.')
