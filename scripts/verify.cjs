#!/usr/bin/env node
/**
 * Static verification for the pen-dev-bridge bundle (no DSH runtime needed).
 *
 * Checks:
 *  - every package.json is valid JSON with the right dsh shape
 *  - both cordis.patch.yml files parse and the bundle patch inserts the
 *    package declared in the bundle's dependencies
 *  - the plugin entry is syntactically valid JavaScript (ESM)
 *  - tool parameters use the DSH property-map schema DSL
 *  - the profile template lists dsh-base + the bundle
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
let failures = 0
const fail = (msg) => { failures++; console.error('  ✗ ' + msg) }
const ok = (msg) => console.log('  ✓ ' + msg)

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
}

console.log('pen-dev-bridge static verification\n')

// 1. package.json files
console.log('[1] package.json files')
for (const rel of [
  'packages/pen-dev-bridge/package.json',
  'bundles/pen-dev-bridge-bundle/package.json',
  'profiles/pen-dev-bridge-template/package.json',
]) {
  try {
    const pkg = readJson(rel)
    ok(`${rel} (valid JSON, name=${pkg.name})`)
    if (!pkg.name) fail(`${rel}: missing name`)
  } catch (err) {
    fail(`${rel}: ${err.message}`)
  }
}

// 2. bundle structure
console.log('[2] bundle structure')
try {
  const bundle = readJson('bundles/pen-dev-bridge-bundle/package.json')
  if (!bundle.dsh || !bundle.dsh.bundle || bundle.dsh.bundle.patch !== './cordis.patch.yml') {
    fail('bundle package.json must declare dsh.bundle.patch -> ./cordis.patch.yml')
  } else ok('bundle declares dsh.bundle.patch')
  if (!bundle.dependencies || !bundle.dependencies['pen-dev-bridge']) {
    fail('bundle must depend on pen-dev-bridge')
  } else ok('bundle depends on pen-dev-bridge')
} catch (err) { fail('bundle: ' + err.message) }

// 3. YAML patches
console.log('[3] cordis.patch.yml files')
// js-yaml may be absent; these compositions use two known shapes, so verify
// them structurally: an empty `[]` array, or `- insert:` blocks carrying
// `- id: X` / `name: 'Y'` rows. js-yaml is used when resolvable for a real parse.
let yaml = null
try { yaml = require('js-yaml') } catch { /* fall back to structural check */ }
const patchText = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const parseYaml = (rel) => {
  const text = patchText(rel)
  if (yaml) return yaml.load(text)
  const stripped = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').trim()
  if (stripped === '[]') return []
  if (!stripped.includes('- insert:')) throw new Error('expected "[]" or a "- insert:" block')
  return [{ insert: [] }]
}
const insertedRows = (rel) => {
  const text = patchText(rel)
  const rows = []
  const re = /- id:\s*([^\s]+)[\s\S]*?name:\s*'?([^'\s]+)'?/g
  let m
  while ((m = re.exec(text)) !== null) rows.push({ id: m[1], name: m[2] })
  return rows
}
try {
  parseYaml('bundles/pen-dev-bridge-bundle/cordis.patch.yml')
  const rows = insertedRows('bundles/pen-dev-bridge-bundle/cordis.patch.yml')
  if (!rows.some((row) => row.id === 'pen-dev-bridge' && row.name === 'pen-dev-bridge')) {
    fail('bundle patch must insert { id: pen-dev-bridge, name: pen-dev-bridge }')
  } else ok('bundle patch inserts pen-dev-bridge row')
  const patch = patchText('bundles/pen-dev-bridge-bundle/cordis.patch.yml')
  if (!patch.includes("inject: ['tools', 'subprocess', 'sandboxPolicy', 'webServer', 'sessions']") && !patch.includes('inject: ["tools", "subprocess", "sandboxPolicy", "webServer", "sessions"]')) {
    fail('bundle patch row must inject [tools, subprocess, sandboxPolicy, webServer, sessions]')
  } else ok('bundle patch row injects [tools, subprocess, sandboxPolicy, webServer, sessions]')
} catch (err) { fail('bundle patch: ' + err.message) }
try {
  parseYaml('profiles/pen-dev-bridge-template/cordis.yml')
  parseYaml('profiles/pen-dev-bridge-template/cordis.patch.yml')
  ok('profile root + user patch parse')
} catch (err) { fail('profile patches: ' + err.message) }

// 4. plugin entry syntax
console.log('[4] plugin entry syntax')
let pluginSource = ''
try {
  const pluginPath = path.join(root, 'packages/pen-dev-bridge/lib/index.js')
  execFileSync(process.execPath, ['--check', pluginPath], { stdio: 'pipe' })
  pluginSource = fs.readFileSync(pluginPath, 'utf8')
  ok('lib/index.js parses as ESM')
} catch (err) {
  fail('lib/index.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  execFileSync(process.execPath, ['--check', path.join(root, 'packages/pen-dev-bridge/lib/client.js')], { stdio: 'pipe' })
  ok('lib/client.js parses (browser bundle)')
} catch (err) {
  fail('lib/client.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}

// 4a. defineTool accepts a property map, not a complete JSON Schema object.
console.log('[4a] tool parameter schema dialect')
if (!pluginSource.includes('parameters: parameterProperties')) {
  fail('register helper must pass the DSH parameter property map directly')
} else ok('register helper passes a parameter property map')
if (/required\s*:\s*\[/.test(pluginSource)) {
  fail('tool schemas must mark each required property with required: true, not use JSON Schema required arrays')
} else ok('required parameters use per-property required: true')
if (pluginSource.includes("{ type: 'object', additionalProperties: true, properties: {}, required: [] }")) {
  fail('zero-argument tools must use an empty parameter property map')
} else ok('zero-argument tools use empty property maps')

// 4b. browser-half declaration (dsh.client + exports["./client"])
console.log('[4b] browser-half declaration')
try {
  const pkg = readJson('packages/pen-dev-bridge/package.json')
  const decl = pkg.dsh && pkg.dsh.client
  if (!decl || decl.platform !== 'web') fail('pen-dev-bridge must declare dsh.client.platform: web')
  else ok('dsh.client.platform = web')
  if (!pkg.exports || pkg.exports['./client'] !== './lib/client.js') fail('package must export "./client" -> ./lib/client.js')
  else ok('exports["./client"] -> lib/client.js')
  const client = fs.readFileSync(path.join(root, 'packages/pen-dev-bridge/lib/client.js'), 'utf8')
  if (!client.startsWith('window.__ModuleLoader__.load({')) fail('client bundle must start with the __ModuleLoader__.load wrap')
  else ok('client bundle wrapped for the web loader')
} catch (err) { fail('browser half: ' + err.message) }

// 5. profile template composition
console.log('[5] profile template')
try {
  const profile = readJson('profiles/pen-dev-bridge-template/package.json')
  const bundles = profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles
  if (!Array.isArray(bundles) || !bundles.includes('@deepseek-ai/dsh-base')) fail('profile must list @deepseek-ai/dsh-base')
  if (!Array.isArray(bundles) || !bundles.includes('@deepseek-ai/dsh-web-app')) fail('profile must list @deepseek-ai/dsh-web-app')
  if (!Array.isArray(bundles) || !bundles.includes('pen-dev-bridge-bundle')) fail('profile must list pen-dev-bridge-bundle')
  ok(`bundles = [${bundles.join(', ')}]`)
} catch (err) { fail('profile: ' + err.message) }

console.log('')
if (failures) {
  console.error(`✗ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('✓ all checks passed')
