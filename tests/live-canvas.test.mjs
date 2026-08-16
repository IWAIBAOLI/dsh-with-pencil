import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const toolFixture = new URL('./fixtures/dsh-tools.mjs', import.meta.url).href
const schemasteryFixture = new URL('./fixtures/schemastery.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: toolFixture, shortCircuit: true }
    if (specifier === 'schemastery') return { url: schemasteryFixture, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
process.env.DSH_PEN_CLI_BIN = '/test/pen-cli.mjs'
process.env.DSH_PEN_MCP_BIN = '/test/pen-mcp'

const bridgeUrl = new URL('../lib/index.js', import.meta.url)
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-live-canvas-'))
const editorDir = path.join(workspace, 'editor-out')
fs.mkdirSync(editorDir, { recursive: true })
fs.writeFileSync(path.join(editorDir, 'index.html'), '<html><body><script type="module" src="/assets/editor.js"></script></body></html>')
process.env.DSH_PEN_EDITOR_DIR = editorDir
const tools = new Map()
const routes = new Map()
const cleanups = []
const eventHandlers = new Map()
const sessions = new Map([['canvas-agent', { header: { cwd: workspace } }]])
let savedImages = 0
let headlessSpawns = 0
// Screenshots now run on the shared headless engine (the webview screenshot
// is a viewport image that ignores nodeId), so `subprocess.spawn` must answer
// with a working CLI/MCP pair instead of refusing to start.
const headlessDocs = new Map()
function headlessHandle(spec) {
  headlessSpawns += 1
  const argv = spec.argv || []
  const isMcp = argv.some((arg) => arg === '--app')
  if (spec.signal && spec.signal.aborted) throw new Error('aborted before spawn: ' + String(spec.signal.reason ?? 'aborted'))
  const stdout = new EventEmitter()
  const outIndex = argv.indexOf('--out')
  const engineFile = outIndex >= 0 ? argv[outIndex + 1] : null
  if (!isMcp && engineFile && !headlessDocs.has(engineFile)) headlessDocs.set(engineFile, { version: '2.14', children: [] })
  const emit = (chunk) => setTimeout(() => stdout.emit('data', Buffer.from(chunk)), 1)
  const respond = (id, result) => emit(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
  const write = (chunk) => {
    if (isMcp) {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line.trim()) continue
        let request
        try { request = JSON.parse(line) } catch { continue }
        if (request.method === 'initialize') respond(request.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-mcp', version: '0.0.1' } })
        else if (request.method === 'tools/list') {
          respond(request.id, { tools: [
            { name: 'batch_design', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } },
            { name: 'get_editor_state', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } },
            { name: 'get_screenshot', description: 'x', inputSchema: { type: 'object', properties: {}, required: [] } },
          ] })
        } else if (request.method === 'tools/call') {
          const { name, arguments: args } = request.params || {}
          const file = (args && args.filePath) || engineFile
          const doc = headlessDocs.get(file) || (headlessDocs.set(file, { version: '2.14', children: [] }), headlessDocs.get(file))
          if (name === 'get_screenshot') {
            respond(request.id, { content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }], isError: false })
          } else if (name === 'get_editor_state') {
            respond(request.id, { content: [{ type: 'text', text: '## Currently active editor\n- ' + file + '\n\n### Top-Level Nodes (' + doc.children.length + '):\n' }], isError: false })
          } else if (name === 'batch_design') {
            doc.children.push({ id: 'node-' + (doc.children.length + 1), type: 'frame', name: 'mock' })
            respond(request.id, { content: [{ type: 'text', text: 'OK' }], isError: false })
          } else {
            respond(request.id, { content: [{ type: 'text', text: 'unhandled ' + name }], isError: true })
          }
        }
      }
      return
    }
    if (String(chunk).includes('save()') && engineFile) {
      const doc = headlessDocs.get(engineFile) || { version: '2.14', children: [] }
      headlessDocs.set(engineFile, doc)
      const content = JSON.stringify(doc)
      fs.writeFileSync(engineFile, content)
      emit('Saved ' + engineFile + ' (' + Buffer.byteLength(content) + ' bytes, ' + doc.children.length + ' top-level nodes).\n')
    }
  }
  setTimeout(() => { if (!isMcp) emit('[INFO] Ready.\n') }, 1)
  let doneResolve
  const done = new Promise((resolve) => { doneResolve = resolve })
  return {
    pid: 1,
    stdin: { write, on() {}, end() {} },
    stdout,
    stderr: new EventEmitter(),
    collected: { stdout: { readFrom() { return { text: '' } } }, stderr: { readFrom() { return { text: '' } } } },
    done,
    terminate() { doneResolve({ exitCode: 0, signalCode: null, aborted: false }) },
  }
}

const webServer = {
  register(route) {
    const key = route.kind + ':' + route.path
    routes.set(key, route.handler)
    return () => routes.delete(key)
  },
}

const ctx = {
  sessions: { get(sessionId) { return sessions.get(sessionId) } },
  get(name) {
    if (name === 'subprocess') return { spawn(spec) { return headlessHandle(spec) } }
    if (name === 'sandboxPolicy') return { resolve: () => ({ workspaceRoot: workspace }) }
    if (name === 'webServer') return webServer
    if (name === 'attachments') return {
      async saveImage({ data, mediaType, name: imageName }) {
        savedImages += 1
        return { attachmentId: 'test-image-' + savedImages, mediaType, bytes: data.byteLength, width: 1, height: 1, name: imageName }
      },
    }
    return undefined
  },
  tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
  on(name, handler) { eventHandlers.set(name, handler); return () => eventHandlers.delete(name) },
  effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
}

const bridge = (await import(bridgeUrl.href + '?test=' + Date.now())).default
bridge.apply(ctx)

async function http(pathname, options = {}) {
  const exact = routes.get('exact:' + pathname)
  const prefix = [...routes.entries()].find(([key]) => key.startsWith('prefix:') && pathname.startsWith(key.slice(7)))?.[1]
  const handler = exact || prefix
  assert.ok(handler, 'missing route ' + pathname)
  const body = options.body === undefined ? '' : JSON.stringify(options.body)
  const req = Readable.from(body ? [body] : [])
  req.url = pathname + (options.query ? '?' + new URLSearchParams(options.query) : '')
  req.method = options.method || 'GET'
  const res = new EventEmitter()
  res.statusCode = 200
  res.headers = {}
  let output = ''
  return new Promise((resolve, reject) => {
    res.writeHead = (statusCode, headers = {}) => { res.statusCode = statusCode; res.headers = headers }
    res.end = (chunk = '') => {
      output += chunk == null ? '' : String(chunk)
      resolve({ status: res.statusCode, headers: res.headers, text: output, json: () => JSON.parse(output || '{}') })
      queueMicrotask(() => res.emit('close'))
    }
    try {
      const result = handler(req, res)
      if (result && typeof result.catch === 'function') result.catch(reject)
    } catch (error) { reject(error) }
  })
}

const rejected = await http('/pen-host/bind', {
  method: 'POST', body: { sessionId: 'not-a-live-session', workspace },
})
assert.equal(rejected.status, 404)

const bound = await http('/pen-host/bind', {
  method: 'POST', body: { sessionId: 'canvas-agent', workspace },
})
assert.equal(bound.status, 200, bound.text)
const binding = bound.json().binding
const query = { binding }
let running = true
let liveDocument = { version: '2.14', children: [], fileToken: 'canvas-test' }
let liveFile = path.join(workspace, 'designs', 'design.pen')
let canvasMutations = 0
let selectedElements = []
let exportNodeCalls = 0
let invalidNextSave = false
let pauseAfterBatch = false
let pausedResolve
let resumeResolve

async function postIpc(message) {
  const response = await http('/pen-host/ipc', { method: 'POST', query, body: message })
  assert.equal(response.status, 200, response.text)
}

async function requestIpc(method, payload) {
  const response = await http('/pen-host/ipc', {
    method: 'POST', query, body: { id: 'host-' + Date.now() + '-' + Math.random(), type: 'request', method, payload },
  })
  assert.equal(response.status, 200, response.text)
  const message = response.json()
  assert.equal(message.error, undefined, message.error && message.error.message)
  return message.payload
}

async function fakeEditor() {
  await postIpc({ id: 'editor-init', type: 'notification', method: 'initialized', payload: {} })
  while (running) {
    const response = await http('/pen-host/pending', { query })
    assert.equal(response.status, 200, response.text)
    for (const message of response.json().messages || []) {
      if (message.type === 'notification' && message.method === 'file-update') {
        liveFile = String(message.payload.fileURI).replace(/^file:\/\//, '')
        liveDocument = JSON.parse(message.payload.content)
        continue
      }
      if (message.type !== 'request') continue
      if (message.method === 'get-editor-state') {
        const names = liveDocument.children.map((node) => node.name).join(', ')
        const selected = selectedElements.length
          ? '\n\n## Selected Elements:\n' + selectedElements.map((node) => '- `' + node.id + '` (' + node.type + '): ' + node.name).join('\n') + '\n\n## Canvas Design'
          : ''
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { message: 'Canvas nodes (' + liveDocument.children.length + '): ' + names + selected } } })
      } else if (message.method === 'batch-get') {
        await postIpc({
          id: message.id, type: 'response', method: message.method,
          payload: { success: true, result: { nodes: liveDocument.children.map((node) => ({ ...node })) } },
        })
      } else if (message.method === 'batch-design') {
        const match = /([A-Za-z][A-Za-z0-9_]*)=Insert\([^,]+,\{[^}]*name:\"([^\"]+)\"/.exec(message.payload.input || '')
        assert.ok(match, 'unsupported simulation input')
        liveDocument.children.push({ id: 'node-' + (liveDocument.children.length + 1), type: 'frame', name: match[2] })
        canvasMutations += 1
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { message: 'Created ' + match[2] + ' on visible canvas' } } })
      } else if (message.method === 'save-document') {
        const content = invalidNextSave ? '{"version":"broken"}' : JSON.stringify(liveDocument)
        invalidNextSave = false
        await postIpc({ id: 'save-' + Date.now(), type: 'notification', method: 'save-resource', payload: { content } })
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: {} })
      } else if (message.method === 'get-screenshot') {
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { image: 'iVBORw0KGgo=', mimeType: 'image/png' } } })
      } else if (message.method === 'export-nodes') {
        exportNodeCalls += 1
        const format = message.payload.format || 'png'
        const bytes = Buffer.from(format + ':' + message.payload.nodeIds.join(','))
        await postIpc({
          id: message.id, type: 'response', method: message.method,
          payload: { success: true, result: { images: [{ nodeId: message.payload.nodeIds.join(','), image: bytes.toString('base64'), mimeType: format === 'pdf' ? 'application/pdf' : 'image/png' }] } },
        })
      } else {
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: false, error: 'unhandled fake editor method ' + message.method } })
      }
    }
    if (pauseAfterBatch) {
      pauseAfterBatch = false
      if (pausedResolve) pausedResolve()
      await new Promise((resolve) => { resumeResolve = resolve })
    }
  }
}

const editorLoop = fakeEditor()
const baseExec = {
  signal: new AbortController().signal,
  agent: { session: { id: 'canvas-agent', header: { cwd: workspace } } },
}

async function call(name, args, exec = baseExec) {
  const result = await tools.get(name).execute(args, exec)
  assert.equal(result.ok, true, name + ' failed: ' + result.text)
  return result
}

function diskState(relative) {
  const target = path.join(workspace, relative)
  if (!fs.existsSync(target)) return { exists: false }
  const content = fs.readFileSync(target, 'utf8')
  const parsed = JSON.parse(content)
  return { exists: true, bytes: Buffer.byteLength(content), children: parsed.children.length, names: parsed.children.map((node) => node.name) }
}

async function waitFor(test, timeoutMs = 4000) {
  const started = Date.now()
  while (!(await test())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for canvas state')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

try {
  await assert.rejects(
    () => tools.get('pencil_mcp_open').execute({ filePath: '../escaped.pen' }, baseExec),
    /escapes/,
  )

  await call('pencil_mcp_open', { filePath: 'one.pen' })
  const imported = await requestIpc('import-file', {
    fileName: 'agent-vision.png', fileContents: { __penBinaryBase64: Buffer.from('image-bytes').toString('base64') },
  })
  assert.equal(imported.filePath, './images/agent-vision.png')
  const importedBytes = await requestIpc('read-file', pathToFileURL(path.join(workspace, 'images', 'agent-vision.png')).toString())
  assert.equal(Buffer.from(importedBytes.__penBinaryBase64, 'base64').toString(), 'image-bytes')
  const generated = await requestIpc('save-generated-image', { image: Buffer.from('generated-image').toString('base64') })
  assert.match(generated.relativePath, /^\.\/images\/generated-.+\.png$/)
  fs.writeFileSync(path.join(workspace, 'workspace-kit.lib.pen'), JSON.stringify({ version: '2.14', children: [] }))
  const libraries = await requestIpc('find-libraries', {})
  assert.ok(libraries.includes(pathToFileURL(path.join(workspace, 'workspace-kit.lib.pen')).toString()))
  for (const name of ['Hero', 'Features', 'Footer']) {
    const before = canvasMutations
    const result = await call('pencil_mcp_execute', {
      filePath: 'one.pen', input: `${name}=Insert(document,{type:\"frame\",name:\"${name}\"})`,
    })
    assert.equal(canvasMutations, before + 1)
    assert.match(result.text, /Saved by live canvas:/)
  }
  assert.deepEqual(diskState('one.pen').names, ['Hero', 'Features', 'Footer'])

  selectedElements = [liveDocument.children[0], liveDocument.children[2]]
  const assembly = { contexts: [] }
  let continued = false
  await eventHandlers.get('system-prompt/assemble')(
    assembly,
    { agent: baseExec.agent, signal: baseExec.signal },
    async () => { continued = true },
  )
  assert.equal(continued, true)
  assert.equal(assembly.contexts.length, 1)
  assert.equal(assembly.contexts[0].name, 'pen-dev:selection')
  assert.match(assembly.contexts[0].text, /`node-1` \(frame\): Hero/)
  assert.match(assembly.contexts[0].text, /`node-3` \(frame\): Footer/)
  selectedElements = []

  await new Promise((resolve) => setTimeout(resolve, 550))
  const external = { version: '2.14', children: [{ id: 'external', type: 'frame', name: 'External' }], fileToken: 'external-clean' }
  fs.writeFileSync(path.join(workspace, 'one.pen'), JSON.stringify(external))
  await waitFor(() => liveDocument.children.some((node) => node.name === 'External'))
  assert.equal((await http('/pen-host/state', { query })).json().conflict, null)

  liveDocument.children.push({ id: 'unsaved', type: 'frame', name: 'Unsaved' })
  await postIpc({ id: 'dirty-reload', type: 'notification', method: 'file-changed', payload: {} })
  await new Promise((resolve) => setTimeout(resolve, 550))
  const diskWins = { version: '2.14', children: [{ id: 'disk', type: 'frame', name: 'DiskWins' }], fileToken: 'external-dirty' }
  fs.writeFileSync(path.join(workspace, 'one.pen'), JSON.stringify(diskWins))
  await waitFor(async () => !!(await http('/pen-host/state', { query })).json().conflict)
  const reloadedConflict = await http('/pen-host/conflict', { method: 'POST', query, body: { action: 'reload' } })
  assert.equal(reloadedConflict.status, 200, reloadedConflict.text)
  await waitFor(() => liveDocument.children.some((node) => node.name === 'DiskWins'))
  assert.deepEqual(diskState('one.pen').names, ['DiskWins'])

  liveDocument.children.push({ id: 'local', type: 'frame', name: 'LocalWins' })
  await postIpc({ id: 'dirty-overwrite', type: 'notification', method: 'file-changed', payload: {} })
  await new Promise((resolve) => setTimeout(resolve, 550))
  const diskLoses = { version: '2.14', children: [{ id: 'disk-loses', type: 'frame', name: 'DiskLoses' }], fileToken: 'external-overwrite' }
  fs.writeFileSync(path.join(workspace, 'one.pen'), JSON.stringify(diskLoses))
  await waitFor(async () => !!(await http('/pen-host/state', { query })).json().conflict)
  const overwrittenConflict = await http('/pen-host/conflict', { method: 'POST', query, body: { action: 'overwrite' } })
  assert.equal(overwrittenConflict.status, 200, overwrittenConflict.text)
  assert.deepEqual(diskState('one.pen').names, ['DiskWins', 'LocalWins'])

  await call('pencil_mcp_open', { filePath: 'two.pen' })
  await call('pencil_mcp_open', { filePath: 'one.pen' })
  const reopened = await call('pencil_mcp_get_app_state', { include_schema: false })
  assert.match(reopened.text, /DiskWins/)
  assert.match(reopened.text, /LocalWins/)

  const exportCallsBeforeScreenshot = exportNodeCalls
  const screenshot = await call('pencil_mcp_get_screenshot', { filePath: 'one.pen', nodeId: 'document' })
  assert.ok(exportNodeCalls > exportCallsBeforeScreenshot, 'document screenshots must export top-level nodes through the live canvas')
  assert.equal(screenshot.image.attachmentId, 'test-image-1')
  const screenshotBlocks = tools.get('pencil_mcp_get_screenshot').output.render({}, screenshot)
  assert.equal(screenshotBlocks.some((block) => block.type === 'image'), true)
  assert.deepEqual(
    fs.readdirSync(workspace).filter((f) => f.startsWith('.pen-doc-') || f.startsWith('.pen-shot-')),
    [],
    'screenshot temp dirs must be removed right after use',
  )

  const paused = new Promise((resolve) => { pausedResolve = resolve })
  pauseAfterBatch = true
  await call('pencil_mcp_get_app_state', { include_schema: false })
  await paused

  const controller = new AbortController()
  const cancelledExec = { ...baseExec, signal: controller.signal }
  const cancelled = tools.get('pencil_mcp_get_screenshot').execute({ filePath: 'one.pen', nodeId: 'document' }, cancelledExec)
  controller.abort('test cancellation')
  const cancelledResult = await cancelled
  assert.equal(cancelledResult.ok, false)
  assert.match(cancelledResult.text, /aborted before spawn/)

  await postIpc({ id: 'editor-reinit', type: 'notification', method: 'initialized', payload: {} })
  const queued = await http('/pen-host/pending', { query })
  assert.equal(queued.json().messages.some((message) => message.method === 'get-screenshot'), false)

  resumeResolve()
  const state = await http('/pen-host/state', { query })
  assert.equal(state.json().connected, true)
  assert.ok(headlessSpawns > 0, 'screenshots must run on the headless engine')
  assert.equal(savedImages, 1)
  assert.equal(canvasMutations, 3)
  assert.equal(liveFile, path.join(workspace, 'one.pen'))

  liveDocument.children.push({ id: 'retry-save', type: 'frame', name: 'RetrySaved' })
  await postIpc({ id: 'dirty-failed-save', type: 'notification', method: 'file-changed', payload: {} })
  invalidNextSave = true
  const failedSave = await http('/pen-host/save', { method: 'POST', query })
  assert.equal(failedSave.status, 409)
  assert.match((await http('/pen-host/state', { query })).json().saveError, /Unsupported \.pen format/)
  const retriedSave = await http('/pen-host/save', { method: 'POST', query })
  assert.equal(retriedSave.status, 200, retriedSave.text)
  assert.equal((await http('/pen-host/state', { query })).json().saveError, null)
  assert.deepEqual(diskState('one.pen').names, ['DiskWins', 'LocalWins', 'RetrySaved'])

  liveDocument.children.push({ id: 'save-as-only', type: 'frame', name: 'SaveAsOnly' })
  await postIpc({ id: 'dirty-save-as', type: 'notification', method: 'file-changed', payload: {} })
  const savedAs = await http('/pen-host/save-as', { method: 'POST', query, body: { file: 'variants/final.pen' } })
  assert.equal(savedAs.status, 200, savedAs.text)
  await waitFor(() => liveFile === path.join(workspace, 'variants', 'final.pen'))
  assert.deepEqual(diskState('one.pen').names, ['DiskWins', 'LocalWins', 'RetrySaved'])
  assert.deepEqual(diskState('variants/final.pen').names, ['DiskWins', 'LocalWins', 'RetrySaved', 'SaveAsOnly'])
  const refusedOverwrite = await http('/pen-host/save-as', { method: 'POST', query, body: { file: 'one.pen' } })
  assert.equal(refusedOverwrite.status, 409)
  assert.match(refusedOverwrite.text, /already exists/)

  selectedElements = [liveDocument.children[0], liveDocument.children[2]]
  const exportedPng = await http('/pen-host/export', { method: 'POST', query, body: { format: 'png' } })
  assert.equal(exportedPng.status, 200, exportedPng.text)
  assert.equal(exportedPng.json().scope, 'selection')
  assert.equal(exportedPng.json().files.length, 2)
  assert.equal(fs.readFileSync(path.join(workspace, exportedPng.json().files[0]), 'utf8'), 'png:' + selectedElements[0].id)
  selectedElements = []
  const exportedPdf = await http('/pen-host/export', { method: 'POST', query, body: { format: 'pdf' } })
  assert.equal(exportedPdf.status, 200, exportedPdf.text)
  assert.equal(exportedPdf.json().scope, 'document')
  assert.equal(exportedPdf.json().files.length, 1)
  assert.equal(fs.readFileSync(path.join(workspace, exportedPdf.json().files[0]), 'utf8'), 'pdf:' + liveDocument.children.map((node) => node.id).join(','))

  await postIpc({ id: 'make-library', type: 'notification', method: 'turn-into-library', payload: {} })
  await waitFor(async () => (await http('/pen-host/state', { query })).json().file.endsWith('final.lib.pen'))
  assert.equal(fs.existsSync(path.join(workspace, 'variants', 'final.pen')), false)
  assert.deepEqual(diskState('variants/final.lib.pen').names, ['DiskWins', 'LocalWins', 'RetrySaved', 'SaveAsOnly'])

  running = false
  const unbound = await http('/pen-host/unbind', { method: 'POST', query })
  assert.equal(unbound.status, 200, unbound.text)
  const releasedState = await http('/pen-host/state', { query })
  assert.equal(releasedState.status, 401)
  console.log('live canvas routing and persistence: ok')
} finally {
  running = false
  if (resumeResolve) resumeResolve()
  for (const cleanup of cleanups.reverse()) await cleanup()
  await editorLoop.catch((error) => { if (running) throw error })
  delete process.env.DSH_PEN_EDITOR_DIR
  fs.rmSync(workspace, { recursive: true, force: true })
}
