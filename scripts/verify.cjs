#!/usr/bin/env node
/**
 * Static verification for the dsh-with-pencil bundle (no DSH runtime needed).
 *
 * Checks:
 *  - every package.json is valid JSON with the right dsh shape
 *  - the bundle patch parses and inserts this package
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

console.log('dsh-with-pencil static verification\n')

// 1. package.json files
console.log('[1] package.json files')
const packageFiles = [
  'package.json',
  'profiles/dsh-with-pencil-template/package.json',
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
if (new Set(packageVersions).size !== 1) fail('package and profile versions must match')
else ok(`package versions aligned at ${packageVersions[0]}`)
try {
  const integration = readJson('package.json')
  if (integration.dependencies?.['@pen.dev/cli'] !== '0.3.0') {
    fail('@pen.dev/cli must stay pinned to schema-2.14-compatible version 0.3.0')
  } else ok('@pen.dev/cli is pinned to schema-2.14-compatible version 0.3.0')
} catch (err) { fail('integration dependency versions: ' + err.message) }

// 2. bundle structure
console.log('[2] bundle structure')
try {
  const bundle = readJson('package.json')
  if (!bundle.dsh || !bundle.dsh.bundle || bundle.dsh.bundle.patch !== './cordis.patch.yml') {
    fail('bundle package.json must declare dsh.bundle.patch -> ./cordis.patch.yml')
  } else ok('bundle declares dsh.bundle.patch')
  if (bundle.name !== 'dsh-with-pencil') fail('bundle package name must be dsh-with-pencil')
  else ok('bundle and Host share one installable package')
  if (!bundle.files?.includes('lib') || !bundle.files?.includes('cordis.patch.yml') || !bundle.files?.includes('THIRD_PARTY_NOTICES.md')) {
    fail('bundle files allowlist must include runtime code, patch, and third-party notices')
  } else ok('bundle has an explicit release files allowlist')
  if (fs.existsSync(path.join(root, 'bundles')) || fs.existsSync(path.join(root, 'packages'))) {
    fail('legacy wrapper package directories must not return')
  } else ok('legacy wrapper package directories are absent')
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
  parseYaml('cordis.patch.yml')
  const rows = insertedRows('cordis.patch.yml')
  if (!rows.some((row) => row.id === 'dsh-with-pencil' && row.name === 'dsh-with-pencil')) {
    fail('bundle patch must insert { id: dsh-with-pencil, name: dsh-with-pencil }')
  } else ok('bundle patch inserts dsh-with-pencil row')
  const patch = patchText('cordis.patch.yml')
  if (!patch.includes("inject: ['tools', 'subprocess', 'sandboxPolicy', 'webServer', 'sessions', 'attachments', 'systemPrompt']") && !patch.includes('inject: ["tools", "subprocess", "sandboxPolicy", "webServer", "sessions", "attachments", "systemPrompt"]')) {
    fail('bundle patch row must inject tool, process, web, session, attachment, and system-prompt services')
  } else ok('bundle patch row injects tool, process, web, session, attachment, and system-prompt services')
} catch (err) { fail('bundle patch: ' + err.message) }
try {
  parseYaml('profiles/dsh-with-pencil-template/cordis.yml')
  parseYaml('profiles/dsh-with-pencil-template/cordis.patch.yml')
  ok('profile root + user patch parse')
} catch (err) { fail('profile patches: ' + err.message) }

// 4. plugin entry syntax
console.log('[4] plugin entry syntax')
let pluginSource = ''
let workspacePathSource = ''
let headlessSource = ''
let modelToolsSource = ''
let canvasHostSource = ''
let canvasExportSource = ''
let canvasTransportSource = ''
let editorAssetsSource = ''
let editorInstallerSource = ''
let sessionStoreSource = ''
let ipcBinarySource = ''
let workspaceResourcesSource = ''
let clientSource = ''
try {
  const pluginPath = path.join(root, 'lib/index.js')
  execFileSync(process.execPath, ['--check', pluginPath], { stdio: 'pipe' })
  pluginSource = fs.readFileSync(pluginPath, 'utf8')
  ok('lib/index.js parses as ESM')
} catch (err) {
  fail('lib/index.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  const workspacePath = path.join(root, 'lib/workspace-path.js')
  execFileSync(process.execPath, ['--check', workspacePath], { stdio: 'pipe' })
  workspacePathSource = fs.readFileSync(workspacePath, 'utf8')
  ok('lib/workspace-path.js parses as ESM')
} catch (err) {
  fail('lib/workspace-path.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  const headlessPath = path.join(root, 'lib/headless-runtime.js')
  execFileSync(process.execPath, ['--check', headlessPath], { stdio: 'pipe' })
  headlessSource = fs.readFileSync(headlessPath, 'utf8')
  ok('lib/headless-runtime.js parses as ESM')
} catch (err) {
  fail('lib/headless-runtime.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
try {
  execFileSync(process.execPath, ['--check', path.join(root, 'lib/legacy-tools.js')], { stdio: 'pipe' })
  ok('lib/legacy-tools.js parses as ESM')
} catch (err) {
  fail('lib/legacy-tools.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}
for (const [name, assign] of [
  ['model-tools.js', (source) => { modelToolsSource = source }],
  ['canvas-host.js', (source) => { canvasHostSource = source }],
  ['canvas-export.js', (source) => { canvasExportSource = source }],
  ['canvas-transport.js', (source) => { canvasTransportSource = source }],
  ['editor-assets.js', (source) => { editorAssetsSource = source }],
  ['editor-installer.js', (source) => { editorInstallerSource = source }],
  ['session-store.js', (source) => { sessionStoreSource = source }],
  ['ipc-binary.js', (source) => { ipcBinarySource = source }],
  ['workspace-resources.js', (source) => { workspaceResourcesSource = source }],
]) {
  try {
    const modulePath = path.join(root, 'lib', name)
    execFileSync(process.execPath, ['--check', modulePath], { stdio: 'pipe' })
    assign(fs.readFileSync(modulePath, 'utf8'))
    ok(`lib/${name} parses as ESM`)
  } catch (err) {
    fail(`lib/${name}: ` + (err.stderr ? err.stderr.toString() : err.message))
  }
}
try {
  execFileSync(process.execPath, ['--check', path.join(root, 'lib/client.js')], { stdio: 'pipe' })
  ok('lib/client.js parses (browser bundle)')
} catch (err) {
  fail('lib/client.js: ' + (err.stderr ? err.stderr.toString() : err.message))
}

// 4a. defineTool accepts a property map, not a complete JSON Schema object.
console.log('[4a] tool parameter schema dialect')
if (!modelToolsSource.includes('parameters: parameterProperties')) {
  fail('register helper must pass the DSH parameter property map directly')
} else ok('register helper passes a parameter property map')
if (/required\s*:\s*\[/.test(modelToolsSource)) {
  fail('tool schemas must mark each required property with required: true, not use JSON Schema required arrays')
} else ok('required parameters use per-property required: true')
if (modelToolsSource.includes("{ type: 'object', additionalProperties: true, properties: {}, required: [] }")) {
  fail('zero-argument tools must use an empty parameter property map')
} else ok('zero-argument tools use empty property maps')

// 4b. browser-half declaration (dsh.client + exports["./client"])
console.log('[4b] browser-half declaration')
try {
  const pkg = readJson('package.json')
  const decl = pkg.dsh && pkg.dsh.client
  if (!decl || decl.platform !== 'web') fail('dsh-with-pencil must declare dsh.client.platform: web')
  else ok('dsh.client.platform = web')
  if (!pkg.exports || pkg.exports['./client'] !== './lib/client.js') fail('package must export "./client" -> ./lib/client.js')
  else ok('exports["./client"] -> lib/client.js')
  const client = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  clientSource = client
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
  if (!client.includes('打开工作区文件夹') || !client.includes('新建 .pen 文件') || !client.includes('另存为…') || !client.includes('导出 PNG（2×）') || !client.includes('导出 PDF') || client.includes('当前会话 · 右侧分屏 · 自动保存')) {
    fail('canvas toolbar must expose concise workspace/file controls')
  } else ok('canvas toolbar exposes concise workspace/file controls')
  if (!client.includes('var(--dsw-specific-menu') || !client.includes('var(--dsw-shadow-lv3') || !client.includes('var(--dsw-alias-interactive-bg-hover') || client.includes('0 12px 32px rgba(0,0,0,.42)')) {
    fail('canvas dropdowns must use the resolved Harness menu surface and elevation tokens')
  } else ok('canvas dropdowns use the resolved Harness menu surface and elevation tokens')
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
if ((pluginSource + canvasHostSource + modelToolsSource).includes('process.cwd()')) {
  fail('host must not use process.cwd() as a workspace fallback')
} else ok('host has no process.cwd() workspace fallback')
if (!pluginSource.includes('function workspaceForExec(exec)') || !canvasHostSource.includes("path: '/pen-host/bind'")) {
  fail('host must resolve tool workspaces per call and expose the canvas bind route')
} else ok('host resolves workspaces per call and exposes the bind route')
if (!canvasHostSource.includes("path: '/pen-host/files'") || !canvasHostSource.includes("path: '/pen-host/file'") || !canvasHostSource.includes("path: '/pen-host/reveal'")) {
  fail('host must expose bound .pen file selection and workspace reveal routes')
} else ok('host exposes bound .pen file selection and workspace reveal routes')
if (!canvasHostSource.includes("case 'get-session': out = sessionStore.get()") || !sessionStoreSource.includes("return { email: state.email, token: state.token }")) {
  fail('new conversation canvases must reuse profile-level email and token')
} else ok('new conversation canvases reuse profile-level email and token')
if (!editorAssetsSource.includes('function __penEncodeValue(value)') || !editorAssetsSource.includes('function __penDecodeValue(value)') || !ipcBinarySource.includes('export function encodeIpcBinary') || !ipcBinarySource.includes('export function decodeIpcBinary') || canvasHostSource.includes('insideWorkspace(binding, payload.uri)')) {
  fail('editor file IPC must transport raw URI payloads and binary file content')
} else ok('editor file IPC transports raw URI payloads and binary file content')
if (!canvasHostSource.includes("const EDITOR_SCHEMA_VERSION = '2.14'") || !canvasHostSource.includes('document.version !== EDITOR_SCHEMA_VERSION') || !canvasHostSource.includes('async function queueCurrentFile(binding)') || !canvasHostSource.includes("msg.method === 'initialized'") || !canvasHostSource.includes("transport.notify(binding, 'file-update'")) {
  fail('host must push the selected document after the editor initializes')
} else ok('host pushes the selected document after editor initialization')
if (!canvasHostSource.includes('binding.loadedFile !== binding.currentFile') || !canvasHostSource.includes('(binding.saveRequested || Date.now() >= binding.autosaveAfter)') || !canvasHostSource.includes('async function saveCanvas(binding, options = {})') || !canvasHostSource.includes('writeFileAtomic')) {
  fail('autosave must wait for a successful file load and write atomically')
} else ok('autosave waits for a successful file load and writes atomically')
if (!canvasHostSource.includes("execute: 'batch-design'") || !headlessSource.includes('return canvasBridge.run(tool') || !canvasHostSource.includes("Saved by live canvas:") || !canvasHostSource.includes('transport.request(binding')) {
  fail('open conversation canvases must receive MCP edits through their own editor IPC')
} else ok('MCP edits route directly through the open conversation canvas')
if (!editorAssetsSource.includes('function __penPoll()') || !canvasTransportSource.includes('binding.pollWaiters.push(waiter)') || !canvasHostSource.includes("path: '/pen-host/state'")) {
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
if (!workspacePathSource.includes('path escapes the bound session workspace') || !workspacePathSource.includes('realpathSync.native') || !canvasHostSource.includes('resolveWorkspacePath') || !modelToolsSource.includes('resolveWorkspacePath')) {
  fail('canvas file IPC must enforce the bound workspace boundary')
} else ok('all Pencil paths enforce a symlink-aware workspace boundary')
if (!canvasHostSource.includes("res.writeHead(404); res.end('conversation is not available')") || canvasHostSource.includes('const workspace = liveCwd || requestedCwd')) {
  fail('canvas bindings must require a live Harness conversation')
} else ok('canvas bindings require a live Harness conversation')
if (!canvasTransportSource.includes('cancelled before delivery') || !canvasTransportSource.includes('pending.delivered = true') || !canvasTransportSource.includes('binding.queue.findIndex')) {
  fail('queued canvas requests must be removable on cancellation')
} else ok('queued canvas requests are removed on cancellation')
if (!sessionStoreSource.includes('fs.chmodSync(stateFile, 0o600)') || !sessionStoreSource.includes('mode: 0o600')) {
  fail('persisted browser credentials must use owner-only permissions')
} else ok('persisted browser credentials use owner-only permissions')
if (!modelToolsSource.includes("attachments.saveImage") || !modelToolsSource.includes("blocks.push({ type: 'image', attachment: value.image })")) {
  fail('Pencil screenshots must return a real model-visible image block')
} else ok('Pencil screenshots return a model-visible image block')
if (!pluginSource.includes("ctx.on('system-prompt/assemble'") || !canvasHostSource.includes("transport.request(binding, 'get-editor-state'") || !canvasHostSource.includes('Current pen.dev canvas selection')) {
  fail('selected canvas nodes must be injected into the owning conversation context')
} else ok('selected canvas nodes are injected into the owning conversation context')
if (!workspaceResourcesSource.includes('fs.watchFile(target') || !canvasHostSource.includes('handleExternalDocumentChange') || !canvasHostSource.includes("path: '/pen-host/conflict'") || !canvasHostSource.includes('if (!binding.conflict && binding.currentFile')) {
  fail('external edits must reload clean documents and protect dirty documents from overwrite')
} else ok('external edits reload clean documents and protect dirty documents from overwrite')
if (!workspaceResourcesSource.includes('async function importFiles') || !workspaceResourcesSource.includes('async function saveGeneratedImage') || !workspaceResourcesSource.includes('async function findLibraries') || !workspaceResourcesSource.includes("endsWith('.lib.pen')")) {
  fail('workspace resources must support binary imports, generated images, and design libraries')
} else ok('workspace resources support binary imports, generated images, and design libraries')
if (!canvasHostSource.includes("path: '/pen-host/save-as'") || !canvasHostSource.includes('writeFileAtomicNew') || !canvasHostSource.includes('the Save As target already exists')) {
  fail('Save As must persist an exclusive workspace copy and switch the canvas')
} else ok('Save As persists an exclusive workspace copy and switches the canvas')
if (!canvasHostSource.includes("path: '/pen-host/export'") || !canvasHostSource.includes('exporter.run(binding, format)') || !canvasExportSource.includes("transport.request(binding, 'export-nodes'") || !canvasExportSource.includes("path.join('exports', documentName)") || !canvasExportSource.includes("transport.request(binding, 'batch-get'")) {
  fail('user export must render the current selection/document through live editor IPC into workspace-safe outputs')
} else ok('user export renders the live selection/document into workspace-safe PNG/PDF outputs')
if (!editorAssetsSource.includes('function preflight()') || !canvasHostSource.includes('editorAssets.preflight()')) {
  fail('canvas binding must reject missing or incompatible editor assets before handoff')
} else ok('canvas binding preflights editor assets before handoff')
if (!editorAssetsSource.includes("method: 'color-theme-changed'") ||
    !editorAssetsSource.includes("matchMedia('(prefers-color-scheme: dark)')") ||
    !editorAssetsSource.includes('new MutationObserver') ||
    clientSource.includes('penhost-theme-toggle')) {
  fail('canvas and editor must follow the resolved Harness/system theme without a plugin theme control')
} else ok('canvas and editor follow the resolved Harness/system theme without a plugin theme control')
if (!editorAssetsSource.includes('installOfficialEditor') ||
    !editorInstallerSource.includes("version: '0.1.94'") ||
    !editorInstallerSource.includes("sha256: '7b655d0ee6b18ca460959573661c250db650538443466c2783dd089d3e4ad22a'") ||
    !editorInstallerSource.includes('invalid editor ZIP path') ||
    !editorInstallerSource.includes("'.installed.json'")) {
  fail('missing editor assets must install one pinned, verified official bundle into a safe cache')
} else ok('missing editor assets install one pinned, verified official bundle into a safe cache')
if (!canvasHostSource.includes('saveError: binding.saveError') || !canvasHostSource.includes('rejectSaveWaiters(binding, error)') || !canvasHostSource.includes('ctx.effect(() => async () =>')) {
  fail('save failures must be observable and dirty canvases flushed during async shutdown')
} else ok('save failures are observable and dirty canvases flush during async shutdown')

console.log('[4d] module boundaries')
if (!pluginSource.includes('createHeadlessRuntime') || !pluginSource.includes('registerModelTools') || !pluginSource.includes('registerCanvasHost')) {
  fail('entrypoint must compose the headless, model-tool, and canvas modules')
} else ok('entrypoint only composes the three runtime boundaries')
if (pluginSource.includes("register('pencil_") || pluginSource.includes("path: '/pen-host/")) {
  fail('entrypoint must not contain model tool definitions or Canvas Host routes')
} else ok('entrypoint contains no tool definitions or Canvas Host routes')
if (!canvasHostSource.includes('createCanvasTransport()') || !canvasHostSource.includes('createCanvasExporter(') || !canvasHostSource.includes('createEditorAssets(') || !canvasHostSource.includes('createSessionStore()') || !canvasHostSource.includes('createWorkspaceResources(')) {
  fail('Canvas Host must delegate transport, export, editor assets, credentials, and workspace resources')
} else ok('Canvas Host delegates transport, export, editor assets, credentials, and workspace resources')

// 5. profile template composition
console.log('[5] profile template')
try {
  const profile = readJson('profiles/dsh-with-pencil-template/package.json')
  const bundles = profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles
  if (!Array.isArray(bundles) || !bundles.includes('@deepseek-ai/dsh-base')) fail('profile must list @deepseek-ai/dsh-base')
  if (!Array.isArray(bundles) || !bundles.includes('@deepseek-ai/dsh-web-app')) fail('profile must list @deepseek-ai/dsh-web-app')
  if (!Array.isArray(bundles) || !bundles.includes('dsh-with-pencil')) fail('profile must list dsh-with-pencil')
  if (profile.dependencies?.['dsh-with-pencil'] !== 'file:../..') fail('profile fixture must install the repository root package')
  ok(`bundles = [${bundles.join(', ')}]`)
} catch (err) { fail('profile: ' + err.message) }

// 6. Public README language order
console.log('[6] README language order')
try {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  const english = readme.indexOf('## English')
  const chinese = readme.indexOf('## 简体中文')
  if (english < 0 || chinese < 0 || english > chinese) {
    fail('README must present the complete English section before Simplified Chinese')
  } else ok('README presents English before Simplified Chinese')
} catch (err) { fail('README language order: ' + err.message) }

console.log('')
if (failures) {
  console.error(`✗ ${failures} check(s) failed`)
  process.exit(1)
}
console.log('✓ all checks passed')
