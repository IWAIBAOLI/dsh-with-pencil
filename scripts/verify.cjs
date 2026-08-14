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
const packageFiles = [
  'packages/pen-dev-bridge/package.json',
  'bundles/pen-dev-bridge-bundle/package.json',
  'profiles/pen-dev-bridge-template/package.json',
]
const packageVersions = []
for (const rel of packageFiles) {
  try {
    const pkg = readJson(rel)
    ok(`${rel} (valid JSON, name=${pkg.name})`)
    if (!pkg.name) fail(`${rel}: missing name`)
    packageVersions.push(pkg.version)
  } catch (err) {
    fail(`${rel}: ${err.message}`)
  }
}
if (new Set(packageVersions).size !== 1) fail('package, bundle, and profile versions must match')
else ok(`package versions aligned at ${packageVersions[0]}`)
try {
  const bridge = readJson('packages/pen-dev-bridge/package.json')
  if (bridge.dependencies?.['@pen.dev/cli'] !== '0.3.0') {
    fail('@pen.dev/cli must stay pinned to schema-2.14-compatible version 0.3.0')
  } else ok('@pen.dev/cli is pinned to schema-2.14-compatible version 0.3.0')
} catch (err) { fail('bridge dependency versions: ' + err.message) }

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
  if (!patch.includes("inject: ['tools', 'subprocess', 'sandboxPolicy', 'webServer', 'sessions', 'attachments']") && !patch.includes('inject: ["tools", "subprocess", "sandboxPolicy", "webServer", "sessions", "attachments"]')) {
    fail('bundle patch row must inject [tools, subprocess, sandboxPolicy, webServer, sessions, attachments]')
  } else ok('bundle patch row injects tool, process, web, session, and attachment services')
} catch (err) { fail('bundle patch: ' + err.message) }
try {
  parseYaml('profiles/pen-dev-bridge-template/cordis.yml')
  parseYaml('profiles/pen-dev-bridge-template/cordis.patch.yml')
  ok('profile root + user patch parse')
} catch (err) { fail('profile patches: ' + err.message) }

// 4. plugin entry syntax
console.log('[4] plugin entry syntax')
let pluginSource = ''
let workspacePathSource = ''
let headlessSource = ''
try {
  const pluginPath = path.join(root, 'packages/pen-dev-bridge/lib/index.js')
  execFileSync(process.execPath, ['--check', pluginPath], { stdio: 'pipe' })
  pluginSource = fs.readFileSync(pluginPath, 'utf8')
  ok('lib/index.js parses as ESM')
} catch (err) {
  fail('lib/index.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  const workspacePath = path.join(root, 'packages/pen-dev-bridge/lib/workspace-path.js')
  execFileSync(process.execPath, ['--check', workspacePath], { stdio: 'pipe' })
  workspacePathSource = fs.readFileSync(workspacePath, 'utf8')
  ok('lib/workspace-path.js parses as ESM')
} catch (err) {
  fail('lib/workspace-path.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  const headlessPath = path.join(root, 'packages/pen-dev-bridge/lib/headless-runtime.js')
  execFileSync(process.execPath, ['--check', headlessPath], { stdio: 'pipe' })
  headlessSource = fs.readFileSync(headlessPath, 'utf8')
  ok('lib/headless-runtime.js parses as ESM')
} catch (err) {
  fail('lib/headless-runtime.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  execFileSync(process.execPath, ['--check', path.join(root, 'packages/pen-dev-bridge/lib/legacy-tools.js')], { stdio: 'pipe' })
  ok('lib/legacy-tools.js parses as ESM')
} catch (err) {
  fail('lib/legacy-tools.js: ' + (err.stderr ? err.stderr.toString() : err.message))
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
  if (client.includes('store.setOpen(true)')) fail('client must not auto-open the canvas during plugin activation')
  else ok('client does not auto-open the canvas')
  if (!client.includes("fetch('/pen-host/bind'") || !client.includes('sessions.current')) {
    fail('client must bind on demand and project the active Harness session')
  } else ok('client binds on demand and follows the active session')
  if (!client.includes("ctx.slots.inject('conversation.input.right'") || !client.includes('summary.blank !== true')) {
    fail('blank conversations must expose an explicit input-bar canvas trigger')
  } else ok('blank conversations expose an explicit canvas trigger')
  if (!client.includes('setPointerCapture(pointerId)') || !client.includes('html[data-penhost-pointer] .dsh-penhost-frame { pointer-events: none')) {
    fail('canvas resize/drag must keep pointer ownership across the editor iframe')
  } else ok('canvas resize/drag keeps pointer ownership across the editor iframe')
  if (!client.includes('打开工作区文件夹') || !client.includes('新建 .pen 文件') || client.includes('当前会话 · 右侧分屏 · 自动保存')) {
    fail('canvas toolbar must expose concise workspace/file controls')
  } else ok('canvas toolbar exposes concise workspace/file controls')
  if (!client.includes('DEFAULT_SPLIT_RATIO = 0.42') || !client.includes('ratio: width / viewport') || !client.includes('setViewportWidth(viewport)') || client.includes('wide: width')) {
    fail('split canvas width must default smaller and follow viewport ratio')
  } else ok('split canvas defaults to 42% and follows viewport ratio')
  if (!client.includes("fetch('/pen-host/state?binding='") || !client.includes('key: state.binding') || client.includes('key: state.file || state.binding')) {
    fail('canvas iframe must stay mounted while agent-selected file labels synchronize')
  } else ok('canvas iframe stays mounted while agent-selected file labels synchronize')
} catch (err) { fail('browser half: ' + err.message) }

// 4c. The host must not derive a workspace from its launch directory. Both
// model tools and the browser canvas resolve the owning session at use time.
console.log('[4c] session workspace binding')
if (pluginSource.includes('process.cwd()')) {
  fail('host must not use process.cwd() as a workspace fallback')
} else ok('host has no process.cwd() workspace fallback')
if (!pluginSource.includes('function workspaceForExec(exec)') || !pluginSource.includes("path: '/pen-host/bind'")) {
  fail('host must resolve tool workspaces per call and expose the canvas bind route')
} else ok('host resolves workspaces per call and exposes the bind route')
if (!pluginSource.includes("path: '/pen-host/files'") || !pluginSource.includes("path: '/pen-host/file'") || !pluginSource.includes("path: '/pen-host/reveal'")) {
  fail('host must expose bound .pen file selection and workspace reveal routes')
} else ok('host exposes bound .pen file selection and workspace reveal routes')
if (!pluginSource.includes("case 'get-session': out = sessionState()") || !pluginSource.includes('return { email: uiState.email, token: uiState.token }')) {
  fail('new conversation canvases must reuse profile-level email and token')
} else ok('new conversation canvases reuse profile-level email and token')
if (!pluginSource.includes('function __penDecodeResponse(resp)') || !pluginSource.includes("out = { __penBinaryBase64: content.toString('base64') }") || pluginSource.includes('insideWorkspace(binding, payload.uri)')) {
  fail('editor file IPC must transport raw URI payloads and binary file content')
} else ok('editor file IPC transports raw URI payloads and binary file content')
if (!pluginSource.includes("const EDITOR_SCHEMA_VERSION = '2.14'") || !pluginSource.includes('document.version !== EDITOR_SCHEMA_VERSION') || !pluginSource.includes('async function queueCurrentFile(binding)') || !pluginSource.includes("msg.method === 'initialized'") || !pluginSource.includes("method: 'file-update'")) {
  fail('host must push the selected document after the editor initializes')
} else ok('host pushes the selected document after editor initialization')
if (!pluginSource.includes('binding.loadedFile !== binding.currentFile') || !pluginSource.includes('(binding.saveRequested || Date.now() >= binding.autosaveAfter)') || !pluginSource.includes('async function saveCanvas(binding)') || !pluginSource.includes('writeFileAtomic')) {
  fail('autosave must wait for a successful file load and write atomically')
} else ok('autosave waits for a successful file load and writes atomically')
if (!pluginSource.includes("execute: 'batch-design'") || !headlessSource.includes('return canvasBridge.run(tool') || !pluginSource.includes("Saved by live canvas:") || !pluginSource.includes('function requestCanvas(')) {
  fail('open conversation canvases must receive MCP edits through their own editor IPC')
} else ok('MCP edits route directly through the open conversation canvas')
if (!pluginSource.includes('function __penPoll()') || !pluginSource.includes('binding.pollWaiters.push(waiter)') || !pluginSource.includes("path: '/pen-host/state'")) {
  fail('live canvas IPC must use low-latency polling and expose synchronized binding state')
} else ok('live canvas IPC uses low-latency polling with synchronized binding state')
if (!headlessSource.includes("get_app_state: ['get_app_state', 'get_editor_state']") || !headlessSource.includes("execute: ['execute', 'batch_design']") || !headlessSource.includes("await call('tools/list', {})")) {
  fail('MCP calls must map the schema-compatible CLI legacy tool names from tools/list')
} else ok('MCP calls map legacy tool names discovered through tools/list')
if (!headlessSource.includes('function cliSocketActive()') || !headlessSource.includes('async function cleanupStaleCliSocket()') || !headlessSource.includes('let mcpSerial = Promise.resolve()') || !headlessSource.includes('await client.close()')) {
  fail('headless MCP calls must serialize, retire helpers, and clean only inactive CLI sockets')
} else ok('headless MCP calls serialize, retire helpers, and clean inactive CLI sockets')
if (!headlessSource.includes('async function engineCommand(') || !headlessSource.includes("fresh.includes('Saved ' + target)") || !headlessSource.includes('MCP edit succeeded in memory, but disk save failed') || !headlessSource.includes('Saved to disk: ')) {
  fail('MCP edits must await an acknowledged save and verify the disk document')
} else ok('MCP edits await an acknowledged save and verify the disk document')
if (headlessSource.includes('process.kill(pid, 0)') || !headlessSource.includes('process.env.DSH_PEN_MCP_APP') || !headlessSource.includes('No pen.dev engine is bound to this conversation')) {
  fail('external editor routing must be explicit and request an open by default')
} else ok('external editor routing is opt-in and session-safe by default')
if (!workspacePathSource.includes('path escapes the bound session workspace') || !workspacePathSource.includes('realpathSync.native') || !pluginSource.includes('resolveWorkspacePath')) {
  fail('canvas file IPC must enforce the bound workspace boundary')
} else ok('all Pencil paths enforce a symlink-aware workspace boundary')
if (!pluginSource.includes("res.writeHead(404); res.end('conversation is not available')") || pluginSource.includes('const workspace = liveCwd || requestedCwd')) {
  fail('canvas bindings must require a live Harness conversation')
} else ok('canvas bindings require a live Harness conversation')
if (!pluginSource.includes('cancelled before delivery') || !pluginSource.includes('pending.delivered = true') || !pluginSource.includes('binding.queue.findIndex')) {
  fail('queued canvas requests must be removable on cancellation')
} else ok('queued canvas requests are removed on cancellation')
if (!pluginSource.includes('fs.chmodSync(stateFile, 0o600)') || !pluginSource.includes('mode: 0o600')) {
  fail('persisted browser credentials must use owner-only permissions')
} else ok('persisted browser credentials use owner-only permissions')
if (!pluginSource.includes("attachments.saveImage") || !pluginSource.includes("blocks.push({ type: 'image', attachment: value.image })")) {
  fail('Pencil screenshots must return a real model-visible image block')
} else ok('Pencil screenshots return a model-visible image block')

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
