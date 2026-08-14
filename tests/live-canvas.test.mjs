import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const toolFixture = new URL('./fixtures/dsh-tools.mjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: toolFixture, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
process.env.DSH_PEN_CLI_BIN = '/test/pen-cli.mjs'
process.env.DSH_PEN_MCP_BIN = '/test/pen-mcp'

const bridgeUrl = new URL('../packages/pen-dev-bridge/lib/index.js', import.meta.url)
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pen-live-canvas-'))
const tools = new Map()
const routes = new Map()
const cleanups = []
const sessions = new Map([['canvas-agent', { header: { cwd: workspace } }]])
let subprocessSpawns = 0
let savedImages = 0

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
    if (name === 'subprocess') return { spawn() { subprocessSpawns += 1; throw new Error('headless subprocess must not start while canvas is live') } }
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
let pauseAfterBatch = false
let pausedResolve
let resumeResolve

async function postIpc(message) {
  const response = await http('/pen-host/ipc', { method: 'POST', query, body: message })
  assert.equal(response.status, 200, response.text)
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
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { message: 'Canvas nodes (' + liveDocument.children.length + '): ' + names } } })
      } else if (message.method === 'batch-design') {
        const match = /([A-Za-z][A-Za-z0-9_]*)=Insert\([^,]+,\{[^}]*name:\"([^\"]+)\"/.exec(message.payload.input || '')
        assert.ok(match, 'unsupported simulation input')
        liveDocument.children.push({ id: 'node-' + (liveDocument.children.length + 1), type: 'frame', name: match[2] })
        canvasMutations += 1
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { message: 'Created ' + match[2] + ' on visible canvas' } } })
      } else if (message.method === 'save-document') {
        await postIpc({ id: 'save-' + Date.now(), type: 'notification', method: 'save-resource', payload: { content: JSON.stringify(liveDocument) } })
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: {} })
      } else if (message.method === 'get-screenshot') {
        await postIpc({ id: message.id, type: 'response', method: message.method, payload: { success: true, result: { image: 'iVBORw0KGgo=', mimeType: 'image/png' } } })
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

try {
  await assert.rejects(
    () => tools.get('pencil_mcp_open').execute({ filePath: '../escaped.pen' }, baseExec),
    /escapes/,
  )

  await call('pencil_mcp_open', { filePath: 'one.pen' })
  for (const name of ['Hero', 'Features', 'Footer']) {
    const before = canvasMutations
    const result = await call('pencil_mcp_execute', {
      filePath: 'one.pen', input: `${name}=Insert(document,{type:\"frame\",name:\"${name}\"})`,
    })
    assert.equal(canvasMutations, before + 1)
    assert.match(result.text, /Saved by live canvas:/)
  }
  assert.deepEqual(diskState('one.pen').names, ['Hero', 'Features', 'Footer'])

  await call('pencil_mcp_open', { filePath: 'two.pen' })
  await call('pencil_mcp_open', { filePath: 'one.pen' })
  const reopened = await call('pencil_mcp_get_app_state', { include_schema: false })
  assert.match(reopened.text, /Hero/)
  assert.match(reopened.text, /Footer/)

  const screenshot = await call('pencil_mcp_get_screenshot', { filePath: 'one.pen', nodeId: 'document' })
  assert.equal(screenshot.image.attachmentId, 'test-image-1')
  const screenshotBlocks = tools.get('pencil_mcp_get_screenshot').output.render({}, screenshot)
  assert.equal(screenshotBlocks.some((block) => block.type === 'image'), true)

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
  assert.match(cancelledResult.text, /cancelled before delivery/)

  await postIpc({ id: 'editor-reinit', type: 'notification', method: 'initialized', payload: {} })
  const queued = await http('/pen-host/pending', { query })
  assert.equal(queued.json().messages.some((message) => message.method === 'get-screenshot'), false)

  resumeResolve()
  const state = await http('/pen-host/state', { query })
  assert.equal(state.json().connected, true)
  assert.equal(subprocessSpawns, 0)
  assert.equal(savedImages, 1)
  assert.equal(canvasMutations, 3)
  assert.equal(liveFile, path.join(workspace, 'one.pen'))

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
  fs.rmSync(workspace, { recursive: true, force: true })
}
