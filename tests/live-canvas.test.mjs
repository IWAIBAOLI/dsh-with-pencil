import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getSessionDocument, getSessionFile } from '../lib/session-file.js'

const toolFixture = new URL('./fixtures/dsh-tools.mjs', import.meta.url).href
const schemasteryFixture = new URL('./fixtures/schemastery.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: toolFixture, shortCircuit: true }
    if (specifier === '@deepseek-ai/schemastery') return { url: schemasteryFixture, shortCircuit: true }
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
let readImages = 0
let beforeReadImage
let activeModel = 'deepseek-flash'
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
    if (name === 'llm') return {
      async resolveModelInfo(provider, model) {
        assert.equal(provider, 'deepseek-official')
        return { inputModalities: model === 'deepseek-flash' ? ['text', 'image'] : ['text'] }
      },
    }
    if (name === 'subprocess') return { spawn(spec) { return headlessHandle(spec) } }
    if (name === 'sandboxPolicy') return { resolve: () => ({ workspaceRoot: workspace }) }
    if (name === 'webServer') return webServer
    if (name === 'attachments') return {
      async saveImage({ data, mediaType, name: imageName }) {
        savedImages += 1
        return { attachmentId: 'test-image-' + savedImages, mediaType, bytes: data.byteLength, width: 1, height: 1, name: imageName }
      },
      async readImage(ref) {
        readImages += 1
        assert.equal(ref.attachmentId, 'chat-image-1')
        if (beforeReadImage) await beforeReadImage()
        return {
          data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
          ref,
        }
      },
    }
    return undefined
  },
  tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
  on(name, handler) { eventHandlers.set(name, handler); return () => eventHandlers.delete(name) },
  effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
}

const bridge = (await import(bridgeUrl.href + '?test=' + Date.now())).default
let visionMode = 'text'
bridge.apply(ctx, { visionMode: { get: () => visionMode } })

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
let rendererDocument = getSessionDocument('canvas-agent')
let editorReloads = 0
const saveTargets = []
let canvasMutations = 0
let selectedElements = []
let exportNodeCalls = 0
let invalidNextSave = false
let failNextBatch = false
const batchDesignInputs = []
let pauseAfterBatch = false
let pausedResolve
let resumeResolve

async function postIpc(message) {
  const response = await http('/pen-host/ipc', {
    method: 'POST', query,
    body: { documentURI: rendererDocument.fileURI, documentRevision: rendererDocument.revision, ...message },
  })
  assert.equal(response.status, 200, response.text)
  return response.json()
}

async function requestIpc(method, payload) {
  const message = await postIpc({ id: 'host-' + Date.now() + '-' + Math.random(), type: 'request', method, payload })
  assert.equal(message.error, undefined, message.error && message.error.message)
  return message.payload
}

async function fakeEditor() {
  await postIpc({ id: 'editor-init', type: 'notification', method: 'initialized', payload: {} })
  while (running) {
    const response = await http('/pen-host/pending', { query: { ...query, documentRevision: rendererDocument.revision } })
    if (!running) break
    assert.equal(response.status, 200, response.text)
    for (const message of response.json().messages || []) {
      if (message.method === 'reload-editor' || (message.method === 'file-update' &&
          (message.payload.fileURI !== rendererDocument.fileURI || message.payload.documentRevision !== rendererDocument.revision))) {
        // Model the real bootstrap: the official editor's URI is immutable.
        // A document switch recreates it; file-update alone cannot change it.
        rendererDocument = getSessionDocument('canvas-agent')
        editorReloads += 1
        await postIpc({ id: 'editor-reload', type: 'notification', method: 'initialized', payload: {} })
        break
      }
      if (message.type === 'notification' && message.method === 'file-update') {
        liveFile = fileURLToPath(message.payload.fileURI)
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
        const input = message.payload.input || ''
        batchDesignInputs.push(input)
        if (failNextBatch) {
          failNextBatch = false
          await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: false, error: 'simulated insert failure' } })
          continue
        }
        const name = /["']?name["']?\s*:\s*"([^\"]+)"/.exec(input)?.[1]
        assert.ok(name, 'unsupported simulation input')
        liveDocument.children.push({ id: 'node-' + (liveDocument.children.length + 1), type: 'frame', name })
        canvasMutations += 1
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { message: 'Created ' + name + ' on visible canvas' } } })
      } else if (message.method === 'save') {
        saveTargets.push(message.payload.uri)
        const saved = structuredClone(liveDocument)
        const destination = fileURLToPath(message.payload.uri)
        const rebase = (value) => {
          if (!value || typeof value !== 'object') return
          if (value.type === 'image' && value.url && !/^[a-z]+:/i.test(value.url)) {
            value.url = path.relative(path.dirname(destination), path.resolve(path.dirname(liveFile), value.url)).split(path.sep).join('/')
          }
          for (const child of Object.values(value)) rebase(child)
        }
        rebase(saved)
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: JSON.stringify(saved) })
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
  agent: { session: {
    id: 'canvas-agent', header: { cwd: workspace },
    requestHeader() { return { config: { provider: 'deepseek-official', model: activeModel } } },
  } },
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
  assert.equal(getSessionFile('canvas-agent'), path.join(workspace, 'one.pen'))
  assert.equal(rendererDocument.fileURI, pathToFileURL(liveFile).toString())
  assert.equal(editorReloads, 1)
  const originalContext = getSessionDocument('canvas-agent')
  fs.writeFileSync(path.join(workspace, 'invalid.pen'), '{"version":"invalid"}')
  const failedOpen = await tools.get('pencil_mcp_open').execute({ filePath: 'invalid.pen' }, baseExec)
  assert.equal(failedOpen.ok, false)
  assert.match(failedOpen.text, /Unsupported \.pen format/)
  assert.equal(getSessionDocument('canvas-agent'), originalContext, 'failed open must retain the current document')
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

  liveDocument.children[0].metadata = { savedBeforeSwitch: true }
  await postIpc({ id: 'dirty-before-open', type: 'notification', method: 'file-changed', payload: {} })
  await call('pencil_mcp_open', { filePath: 'two.pen' })
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'one.pen'), 'utf8')).children[0].metadata.savedBeforeSwitch, true)
  assert.equal(fs.existsSync(path.join(workspace, 'two.pen')), false, 'switch must not save old content into the new file')
  const createdFile = await http('/pen-host/file', { method: 'POST', query, body: { file: 'ui-new.pen', create: true } })
  assert.equal(createdFile.status, 200, createdFile.text)
  assert.deepEqual(diskState('ui-new.pen').names, [])
  const duplicateFile = await http('/pen-host/file', { method: 'POST', query, body: { file: 'ui-new.pen', create: true } })
  assert.equal(duplicateFile.status, 409, duplicateFile.text)
  await call('pencil_mcp_open', { filePath: 'one.pen' })
  const returnedContext = getSessionDocument('canvas-agent')
  assert.ok(returnedContext.revision > originalContext.revision)
  const staleImport = await postIpc({
    id: 'stale-import', type: 'request', method: 'import-file',
    documentURI: originalContext.fileURI, documentRevision: originalContext.revision,
    payload: { fileName: 'stale.png', fileContents: { __penBinaryBase64: 'AQID' } },
  })
  assert.equal(staleImport.error.code, 'STALE_DOCUMENT')
  assert.equal(fs.existsSync(path.join(workspace, 'images', 'stale.png')), false)
  const beforeLateSave = fs.readFileSync(path.join(workspace, 'one.pen'), 'utf8')
  await postIpc({
    id: 'stale-save', type: 'notification', method: 'save-resource',
    documentURI: originalContext.fileURI, documentRevision: originalContext.revision,
    payload: { content: JSON.stringify({ version: '2.14', children: [] }) },
  })
  assert.equal(fs.readFileSync(path.join(workspace, 'one.pen'), 'utf8'), beforeLateSave)
  const stalePoll = await http('/pen-host/pending', { query: { ...query, documentRevision: originalContext.revision } })
  assert.equal(stalePoll.json().messages[0].method, 'reload-editor')
  const reopened = await call('pencil_mcp_get_app_state', { include_schema: false })
  assert.match(reopened.text, /DiskWins/)
  assert.match(reopened.text, /LocalWins/)

  const exportCallsBeforeScreenshot = exportNodeCalls
  const screenshot = await call('pencil_mcp_get_screenshot', { filePath: 'one.pen', nodeId: 'document' })
  assert.ok(exportNodeCalls > exportCallsBeforeScreenshot, 'document screenshots must export top-level nodes through the live canvas')
  assert.equal(screenshot.image.attachmentId, 'test-image-1')
  assert.match(screenshot.image.instruction, /Visual-fidelity spot check/)
  const screenshotBlocks = tools.get('pencil_mcp_get_screenshot').output.render({}, screenshot)
  assert.equal(screenshotBlocks.some((block) => block.type === 'image'), true)
  visionMode = 'multimodal'
  const exportsBeforeMultimodal = exportNodeCalls
  const nativeScreenshot = await call('pencil_mcp_get_screenshot', { filePath: 'one.pen', nodeId: 'document' })
  assert.equal(exportNodeCalls, exportsBeforeMultimodal, 'volatile multimodal mode must use native screenshots immediately')
  assert.equal(nativeScreenshot.image.attachmentId, 'test-image-2')
  assert.equal(nativeScreenshot.image.instruction, undefined)
  activeModel = 'custom-text'
  await assert.rejects(
    tools.get('pencil_mcp_get_screenshot').execute({ filePath: 'one.pen', nodeId: 'document' }, baseExec),
    /model "custom-text" does not declare it/,
  )
  assert.equal(savedImages, 2, 'unsupported routes must fail before rendering or saving an image')
  activeModel = 'deepseek-flash'
  visionMode = 'text'
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
  assert.equal(savedImages, 2)
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

  liveDocument.children.push({ id: 'save-as-only', type: 'frame', name: 'SaveAsOnly', fill: { type: 'image', url: 'images/agent-vision.png' } })
  await postIpc({ id: 'dirty-save-as', type: 'notification', method: 'file-changed', payload: {} })
  const savedAs = await http('/pen-host/save-as', { method: 'POST', query, body: { file: 'variants/final.pen' } })
  assert.equal(savedAs.status, 200, savedAs.text)
  await waitFor(() => liveFile === path.join(workspace, 'variants', 'final.pen'))
  assert.deepEqual(diskState('one.pen').names, ['DiskWins', 'LocalWins', 'RetrySaved'])
  assert.deepEqual(diskState('variants/final.pen').names, ['DiskWins', 'LocalWins', 'RetrySaved', 'SaveAsOnly'])
  assert.equal(saveTargets.at(-1), pathToFileURL(liveFile).toString(), 'Save As must use the official target-aware serializer')
  const savedImageUrl = JSON.parse(fs.readFileSync(liveFile, 'utf8')).children.at(-1).fill.url
  assert.equal(savedImageUrl, '../images/agent-vision.png')
  assert.equal(fs.readFileSync(path.resolve(path.dirname(liveFile), savedImageUrl), 'utf8'), 'image-bytes')
  const afterSwitchImport = await requestIpc('import-file', { fileName: 'after-switch.png', fileContents: { __penBinaryBase64: 'AQID' } })
  const afterSwitchUri = new URL(afterSwitchImport.filePath, rendererDocument.fileURI).toString()
  assert.equal(afterSwitchUri, pathToFileURL(path.join(workspace, 'variants', 'images', 'after-switch.png')).toString())
  assert.equal((await requestIpc('read-file', afterSwitchUri)).__penBinaryBase64, 'AQID')
  assert.equal(fs.existsSync(path.join(workspace, 'images', 'after-switch.png')), false)
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

  const chatMessages = [{
    role: 'user',
    content: [{ type: 'image', attachment: { attachmentId: 'chat-image-1', mediaType: 'image/png' } }],
  }]
  await eventHandlers.get('agent/pre-step')(
    { agent: baseExec.agent, messages: chatMessages },
    // A text-model wrapper may replace the raw ImageBlock downstream.
    async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: '[图片转译]' }] }] }),
  )
  const insertedImage = await call('pencil_mcp_insert_image', {
    image: 'latest', filePath: 'variants/final.lib.pen', name: 'Chat reference',
    width: 640, height: 360, x: 24, y: 48, mode: 'fill',
  })
  assert.equal(readImages, 1)
  assert.match(insertedImage.text, /resolved via chat-attachment/)
  const imageInput = batchDesignInputs.at(-1)
  const imageNode = JSON.parse(/Insert\([^,]+,\s*(\{.*\})\)$/.exec(imageInput)[1])
  assert.deepEqual(imageNode, {
    type: 'frame', name: 'Chat reference', width: 640, height: 360,
    fill: { type: 'image', url: imageNode.fill.url, mode: 'fill' }, x: 24, y: 48,
  })
  assert.match(imageNode.fill.url, /^\.\/images\/pencil-.+\.png$/)
  assert.equal(fs.existsSync(path.join(workspace, 'variants', imageNode.fill.url)), true)

  const imagesDir = path.join(workspace, 'variants', 'images')
  const readsBeforeMismatch = readImages
  const mismatchedImage = await tools.get('pencil_mcp_insert_image').execute({ image: 'latest', filePath: 'one.pen' }, baseExec)
  assert.equal(mismatchedImage.ok, false)
  assert.match(mismatchedImage.text, /filePath differs.*pencil_mcp_open/)
  assert.equal(readImages, readsBeforeMismatch, 'mismatched targets must be refused before reading or writing the asset')

  let imageReadStarted
  let resumeImageRead
  const startedReading = new Promise((resolve) => { imageReadStarted = resolve })
  const waitForRead = new Promise((resolve) => { resumeImageRead = resolve })
  beforeReadImage = async () => { imageReadStarted(); await waitForRead }
  const beforeRacingInsert = fs.readdirSync(imagesDir).sort()
  const racingInsert = tools.get('pencil_mcp_insert_image').execute({ image: 'latest', name: 'Must not cross documents' }, baseExec)
  await startedReading
  await call('pencil_mcp_open', { filePath: 'race/other.pen' })
  resumeImageRead()
  const raced = await racingInsert
  beforeReadImage = undefined
  assert.equal(raced.ok, false)
  assert.match(raced.text, /document changed/)
  assert.equal(liveDocument.children.length, 0, 'an in-flight image must not be inserted into the new document')
  assert.deepEqual(fs.readdirSync(imagesDir).sort(), beforeRacingInsert, 'a rejected stale insert must not leave an orphan image')
  await call('pencil_mcp_open', { filePath: 'variants/final.lib.pen' })

  const imagesBeforeFailedInsert = fs.readdirSync(imagesDir).sort()
  failNextBatch = true
  const failedInsert = await tools.get('pencil_mcp_insert_image').execute({
    image: 'recent:1', filePath: 'variants/final.lib.pen', name: 'Must roll back',
  }, baseExec)
  assert.equal(failedInsert.ok, false)
  assert.match(failedInsert.text, /simulated insert failure/)
  assert.deepEqual(fs.readdirSync(imagesDir).sort(), imagesBeforeFailedInsert)
  const failedInput = batchDesignInputs.at(-1)
  const failedNode = JSON.parse(/Insert\([^,]+,\s*(\{.*\})\)$/.exec(failedInput)[1])
  assert.equal(failedNode.width, 400)
  assert.equal(failedNode.height, 300)
  assert.equal(failedNode.fill.mode, 'fit')

  const imagesBeforeSaveFailure = fs.readdirSync(imagesDir).sort()
  invalidNextSave = true
  const saveFailedInsert = await tools.get('pencil_mcp_insert_image').execute({
    image: 'latest', filePath: 'variants/final.lib.pen', name: 'Retained after save failure',
  }, baseExec)
  assert.equal(saveFailedInsert.ok, false)
  assert.match(saveFailedInsert.text, /edit succeeded, but disk save failed/i)
  assert.equal(fs.readdirSync(imagesDir).length, imagesBeforeSaveFailure.length + 1)
  const recoveredImageSave = await http('/pen-host/save', { method: 'POST', query })
  assert.equal(recoveredImageSave.status, 200, recoveredImageSave.text)

  const refusedMove = await http('/pen-host/rename', { method: 'POST', query, body: { file: 'one.pen', name: 'moved/inactive.pen' } })
  assert.equal(refusedMove.status, 409, 'moving an inactive document cannot silently retain the wrong resource base')
  assert.match(refusedMove.text, /open this file/)
  assert.equal(fs.existsSync(path.join(workspace, 'one.pen')), true)
  assert.equal(fs.existsSync(path.join(workspace, 'moved', 'inactive.pen')), false)
  const moved = await http('/pen-host/rename', {
    method: 'POST', query, body: { file: 'variants/final.lib.pen', name: 'moved/deeper/final.pen' },
  })
  assert.equal(moved.status, 200, moved.text)
  await waitFor(() => liveFile === path.join(workspace, 'moved', 'deeper', 'final.pen'))
  assert.equal(fs.existsSync(path.join(workspace, 'variants', 'final.lib.pen')), false)
  const movedFill = JSON.parse(fs.readFileSync(liveFile, 'utf8')).children.find((node) => node.id === 'save-as-only').fill
  assert.equal(movedFill.url, '../../images/agent-vision.png')
  assert.equal(fs.readFileSync(path.resolve(path.dirname(liveFile), movedFill.url), 'utf8'), 'image-bytes')

  const specialFile = path.join(workspace, '中文 #100%', '当前文件.pen')
  fs.mkdirSync(path.dirname(specialFile), { recursive: true })
  fs.writeFileSync(specialFile, JSON.stringify({ version: '2.14', children: [] }))
  await postIpc({ id: 'native-open', type: 'notification', method: 'load-file', payload: { fileURI: pathToFileURL(specialFile).toString() } })
  await waitFor(() => liveFile === specialFile)
  assert.equal(getSessionFile('canvas-agent'), specialFile, 'official load-file URI must use the same document switch coordinator')
  const specialImport = await requestIpc('import-file', { fileName: 'special.png', fileContents: { __penBinaryBase64: 'AQID' } })
  assert.equal((await requestIpc('read-file', new URL(specialImport.filePath, rendererDocument.fileURI).toString())).__penBinaryBase64, 'AQID')

  const retainedFile = getSessionFile('canvas-agent')
  running = false
  const unbound = await http('/pen-host/unbind', { method: 'POST', query })
  assert.equal(unbound.status, 200, unbound.text)
  assert.equal(getSessionFile('canvas-agent'), retainedFile, 'closing the canvas must preserve the conversation document')
  await editorLoop
  await call('pencil_mcp_get_app_state', { include_schema: false })
  assert.equal(getSessionFile('canvas-agent'), retainedFile, 'headless handoff must use the same document')
  await call('pencil_mcp_open', { filePath: 'headless-next.pen' })
  assert.equal(getSessionFile('canvas-agent'), path.join(workspace, 'headless-next.pen'))
  const rebound = await http('/pen-host/bind', { method: 'POST', body: { sessionId: 'canvas-agent', workspace } })
  assert.equal(rebound.status, 200, rebound.text)
  assert.equal(rebound.json().file, getSessionFile('canvas-agent'), 'canvas rebinding must not reset the headless current file')
  await eventHandlers.get('session/disposed')(baseExec.agent.session)
  assert.equal(getSessionFile('canvas-agent'), null, 'only session disposal clears the document identity')
  assert.equal((await http('/pen-host/state', { query: { binding: rebound.json().binding } })).status, 401)
  const clearedImage = await tools.get('pencil_mcp_insert_image').execute({
    image: 'latest', filePath: 'variants/final.lib.pen',
  }, baseExec)
  assert.equal(clearedImage.ok, false)
  assert.match(clearedImage.text, /no conversation image matches "latest"/)

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
