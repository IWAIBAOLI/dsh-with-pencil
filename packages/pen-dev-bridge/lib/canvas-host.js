import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createCanvasTransport } from './canvas-transport.js'
import { createEditorAssets } from './editor-assets.js'
import { createSessionStore } from './session-store.js'
import { resolveWorkspacePath } from './workspace-path.js'

/** Mount the session-bound Pencil editor, browser IPC, and live MCP bridge. */
export function registerCanvasHost({ ctx, sub, mcpBin, headless }) {
  // ---- pen.dev canvas UI host: session-bound editor + IPC bridge ----
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return
  const bindings = new Map()
  const bindingsBySession = new Map()
  const transport = createCanvasTransport()
  const sessionStore = createSessionStore()
  // This must match CURRENT_SCHEMA_VERSION in the bundled pen-editor assets.
  // The editor rejects every other version instead of migrating it in place.
  const EDITOR_SCHEMA_VERSION = '2.14'

  function sessionIdForExec(exec) {
    return String(exec && exec.agent && exec.agent.session && exec.agent.session.id || '')
  }
  function bindingForExec(exec) {
    const sessionId = sessionIdForExec(exec)
    if (!sessionId) return undefined
    const key = bindingsBySession.get(sessionId)
    return key ? bindings.get(key) : undefined
  }
  function releaseBinding(binding, reason) {
    if (!binding) return
    transport.close(binding, reason || new Error('pen.dev canvas binding released'))
    bindings.delete(binding.key)
    if (bindingsBySession.get(binding.sessionId) === binding.key) bindingsBySession.delete(binding.sessionId)
  }
  function waitForCanvasSave(binding, revision, timeoutMs = 20000) {
    if (binding.saveRevision > revision) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const waiter = { revision, resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        const index = binding.saveWaiters.indexOf(waiter)
        if (index !== -1) binding.saveWaiters.splice(index, 1)
        reject(new Error('canvas did not persist the document in time'))
      }, timeoutMs)
      binding.saveWaiters.push(waiter)
    })
  }
  async function inspectCanvasFile(target) {
    const content = await fsp.readFile(target, 'utf8')
    const document = JSON.parse(content)
    if (!document || !Array.isArray(document.children)) throw new Error('saved .pen file is not a valid document')
    return { bytes: Buffer.byteLength(content), children: document.children.length }
  }
  async function saveCanvas(binding) {
    if (!binding.initialized || binding.loadedFile !== binding.currentFile) {
      throw new Error('canvas document is not ready to save')
    }
    if (!binding.dirty) {
      try { return await inspectCanvasFile(binding.currentFile) }
      catch (err) {
        if (err && err.code === 'ENOENT') return { bytes: 0, children: 0, skipped: true }
        throw err
      }
    }
    const revision = binding.saveRevision
    binding.saveRequested = true
    try {
      await transport.request(binding, 'save-document', {}, 20000)
      await waitForCanvasSave(binding, revision)
    } finally {
      binding.saveRequested = false
    }
    return inspectCanvasFile(binding.currentFile)
  }
  function enqueueCanvas(binding, run) {
    const operation = binding.serial.then(run, run)
    binding.serial = operation.then(() => undefined, () => undefined)
    return operation
  }

  function urlOf(req) {
    return new URL(String(req.url || '/'), 'http://127.0.0.1')
  }
  function uriToPath(uri) {
    const s = String(uri || '')
    if (s.indexOf('file://') === 0) {
      try { return decodeURIComponent(s.slice(7)) } catch (err) { return s.slice(7) }
    }
    return s
  }

  function bindingOf(req) {
    return bindings.get(urlOf(req).searchParams.get('binding') || '')
  }
  const editorAssets = createEditorAssets({ bindingOf, urlOf })
  function insideWorkspace(binding, input) {
    return resolveWorkspacePath(binding.workspace, uriToPath(input))
  }
  function defaultFile(workspace) {
    const configured = process.env.DSH_PEN_FILE
    return resolveWorkspacePath(workspace, configured || path.join('designs', 'design.pen'), {
      extension: '.pen', label: 'DSH_PEN_FILE',
    })
  }
  async function writeFileAtomic(target, content) {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const temporary = target + '.penhost-' + randomUUID() + '.tmp'
    try {
      await fsp.writeFile(temporary, content)
      await fsp.rename(temporary, target)
    } finally {
      try { await fsp.unlink(temporary) } catch (err) { /* rename already removed it */ }
    }
  }
  async function queueCurrentFile(binding) {
    const target = binding.currentFile
    let content
    try {
      content = await fsp.readFile(target, 'utf8')
      const document = JSON.parse(content)
      if (!document || document.version !== EDITOR_SCHEMA_VERSION) {
        throw new Error('Unsupported .pen format ' + (document && document.version ? document.version : 'unknown') + '; this editor requires ' + EDITOR_SCHEMA_VERSION)
      }
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        binding.loadedFile = null
        binding.autosaveAfter = Infinity
        transport.notify(binding, 'file-error', {
          filePath: target, errorMessage: err && err.message ? err.message : String(err),
        })
        return
      }
      content = JSON.stringify({ version: EDITOR_SCHEMA_VERSION, children: [], fileToken: randomUUID() })
    }
    binding.loadedFile = target
    binding.dirty = false
    binding.autosaveAfter = Date.now() + 6000
    transport.notify(binding, 'file-update', {
      fileURI: 'file://' + target, content, zoomToFit: true, isDirty: false, displayName: path.basename(target),
    })
  }
  const autosaveTimer = setInterval(() => {
    for (const binding of bindings.values()) {
      if (binding.loadedFile !== binding.currentFile) continue
      if (!binding.dirty) continue
      if (Date.now() < binding.autosaveAfter) continue
      if (binding.queue.length >= 8) continue
      void enqueueCanvas(binding, () => saveCanvas(binding)).catch((err) => {
        console.warn('[pen-dev-bridge] canvas autosave failed:', err && err.message)
      })
    }
  }, 6000)
  ctx.effect(() => () => clearInterval(autosaveTimer))

  async function readBody(req) {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 64 * 1024 * 1024) throw new Error('request too large')
    }
    return JSON.parse(body || '{}')
  }
  async function handleBind(req, res) {
    let body
    try { body = await readBody(req) }
    catch (err) { res.writeHead(400); res.end('bad json'); return }
    const sessionId = String(body.sessionId || '')
    if (!sessionId) { res.writeHead(400); res.end('sessionId is required'); return }
    const live = ctx.sessions && typeof ctx.sessions.get === 'function' ? ctx.sessions.get(sessionId) : undefined
    const liveCwd = live && live.header && live.header.cwd ? path.resolve(String(live.header.cwd)) : undefined
    const requestedCwd = body.workspace ? path.resolve(String(body.workspace)) : undefined
    if (!liveCwd) {
      res.writeHead(404); res.end('conversation is not available'); return
    }
    if (requestedCwd && liveCwd !== requestedCwd) {
      res.writeHead(409); res.end('workspace does not match the conversation'); return
    }
    const workspace = liveCwd
    try { await headless.releaseSession(sessionId) }
    catch (err) { res.writeHead(409); res.end('failed to hand off headless document: ' + err.message); return }
    const existingKey = bindingsBySession.get(sessionId)
    const existing = existingKey ? bindings.get(existingKey) : undefined
    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ binding: existing.key, workspace: existing.workspace, file: existing.currentFile }))
      return
    }
    const key = randomUUID()
    let currentFile
    try { currentFile = defaultFile(workspace) }
    catch (err) { res.writeHead(409); res.end(err.message); return }
    const binding = {
      key, sessionId, workspace, currentFile, loadedFile: null, autosaveAfter: Infinity,
      queue: [], pollWaiters: [], pendingRequests: new Map(), saveRevision: 0,
      saveWaiters: [], saveRequested: false, dirty: false, initialized: false, lastSeen: 0,
      serial: Promise.resolve(),
    }
    bindings.set(key, binding)
    bindingsBySession.set(sessionId, key)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ binding: key, workspace, file: binding.currentFile }))
  }
  async function handleUnbind(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return }
    try {
      await enqueueCanvas(binding, async () => {
        if (binding.initialized && binding.loadedFile === binding.currentFile) await saveCanvas(binding)
      })
    } catch (error) {
      res.writeHead(409); res.end('failed to save canvas before release: ' + (error && error.message ? error.message : String(error))); return
    }
    releaseBinding(binding)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  }
  async function listPenFiles(workspace) {
    const files = []
    const skipped = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out'])
    async function walk(dir, depth) {
      if (depth > 5 || files.length >= 100) return
      let entries
      try { entries = await fsp.readdir(dir, { withFileTypes: true }) }
      catch (err) { return }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (files.length >= 100) break
        if (entry.name.startsWith('.') || skipped.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full, depth + 1)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pen')) {
          files.push(path.relative(workspace, full).split(path.sep).join('/'))
        }
      }
    }
    await walk(workspace, 0)
    return files
  }
  async function handleFiles(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    const files = await listPenFiles(binding.workspace)
    const current = path.relative(binding.workspace, binding.currentFile).split(path.sep).join('/')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ files, current }))
  }
  async function handleFile(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    let body
    try { body = await readBody(req) }
    catch (err) { res.writeHead(400); res.end('bad json'); return }
    let target
    try { target = insideWorkspace(binding, body.file) }
    catch (err) { res.writeHead(403); res.end(err.message); return }
    if (path.extname(target).toLowerCase() !== '.pen') {
      res.writeHead(400); res.end('canvas file must end in .pen'); return
    }
    try {
      await enqueueCanvas(binding, async () => {
        if (binding.initialized && binding.loadedFile === binding.currentFile) await saveCanvas(binding)
        binding.currentFile = target
        binding.loadedFile = null
        binding.autosaveAfter = Infinity
        await queueCurrentFile(binding)
        if (binding.loadedFile !== target) throw new Error('canvas refused to load ' + target)
      })
    }
    catch (err) { res.writeHead(500); res.end(err.message); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ file: target }))
  }
  async function handleReveal(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    const argv = process.platform === 'darwin'
      ? ['/usr/bin/open', binding.workspace]
      : process.platform === 'win32'
        ? ['explorer.exe', binding.workspace]
        : ['xdg-open', binding.workspace]
    try {
      const handle = sub.spawn({ argv, cwd: binding.workspace, env: {} })
      if (handle && handle.done && typeof handle.done.catch === 'function') {
        handle.done.catch((err) => console.warn('[pen-dev-bridge] reveal workspace failed', err && err.message))
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    } catch (err) {
      res.writeHead(500); res.end(err && err.message ? err.message : String(err))
    }
  }
  async function handleIpc(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    binding.lastSeen = Date.now()
    let msg
    try { msg = await readBody(req) }
    catch (err) { res.writeHead(400); res.end('bad json'); return }
    if (msg.type === 'notification') {
      if (msg.method === 'initialized') {
        binding.initialized = true
        await queueCurrentFile(binding)
      } else if (msg.method === 'set-current-file') {
        try {
          const uri = typeof msg.payload === 'string' ? msg.payload : msg.payload && msg.payload.uri
          binding.currentFile = insideWorkspace(binding, uri)
          binding.loadedFile = null
          binding.autosaveAfter = Infinity
        }
        catch (err) { res.writeHead(403); res.end('forbidden'); return }
      } else if (msg.method === 'file-changed') {
        if (binding.loadedFile === binding.currentFile) binding.dirty = true
      } else if (msg.method === 'set-session') {
        sessionStore.set(msg.payload)
      } else if (msg.method === 'save-resource') {
        if (binding.currentFile && binding.loadedFile === binding.currentFile && (binding.saveRequested || Date.now() >= binding.autosaveAfter) && msg.payload && msg.payload.content !== undefined) {
          try {
            const target = insideWorkspace(binding, binding.currentFile)
            await writeFileAtomic(target, String(msg.payload.content))
            binding.dirty = false
            binding.saveRevision += 1
            for (const waiter of binding.saveWaiters.slice()) {
              if (binding.saveRevision <= waiter.revision) continue
              clearTimeout(waiter.timer)
              binding.saveWaiters.splice(binding.saveWaiters.indexOf(waiter), 1)
              waiter.resolve()
            }
          } catch (err) { console.error('[pen-dev-bridge] save failed', err && err.message) }
        }
      }
      res.writeHead(200); res.end('{}')
      return
    }
    if (msg.type === 'response') {
      transport.acceptResponse(binding, msg)
      res.writeHead(200); res.end('{}')
      return
    }
    if (msg.type !== 'request') { res.writeHead(200); res.end('{}'); return }
    const payload = msg.payload || {}
    let out
    switch (msg.method) {
      case 'get-session': out = sessionStore.get(); break
      case 'get-current-workspace': out = { label: 'DeepSeek Harness', rootPath: binding.workspace }; break
      case 'get-device-id': out = { deviceId: 'dsh-local' }; break
      case 'get-last-online-at': out = { lastOnlineAt: Date.now() }; break
      case 'read-file': {
        let target
        try {
          target = insideWorkspace(binding, payload)
          const content = await fsp.readFile(target)
          out = { __penBinaryBase64: content.toString('base64') }
        } catch (err) {
          out = { __penBinaryBase64: '' }
        }
        break
      }
      case 'stat-file': {
        try {
          const st = await fsp.stat(insideWorkspace(binding, payload))
          out = { exists: true, isFile: st.isFile() }
        } catch (err) { out = { exists: false, isFile: false } }
        break
      }
      case 'find-libraries': {
        try {
          const dataDir = path.join(path.dirname(mcpBin), 'data')
          const libs = fs.readdirSync(dataDir)
            .filter((n) => n.endsWith('.lib.pen'))
            .map((n) => 'file://' + path.join(dataDir, n))
          out = libs
        } catch (err) { out = [] }
        break
      }
      case 'new-file-picker:get-data':
      case 'new-file-picker:delete-recent': out = { templates: [], recentFiles: [] }; break
      case 'import-file': out = { filePath: null }; break
      case 'import-files': out = []; break
      default:
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: msg.id, type: 'response', method: msg.method, error: { code: 'METHOD_NOT_FOUND', message: 'No handler for ' + msg.method } }))
        return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ id: msg.id, type: 'response', method: msg.method, payload: out }))
  }

  const canvasMethods = {
    get_app_state: 'get-editor-state',
    get_guidelines: 'get-guidelines',
    execute: 'batch-design',
    get_screenshot: 'get-screenshot',
  }
  async function waitForCanvasReady(binding, timeoutMs = 20000) {
    const started = Date.now()
    while ((!binding.initialized || Date.now() - binding.lastSeen > 30000) && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (!binding.initialized || Date.now() - binding.lastSeen > 30000) {
      throw new Error('the conversation canvas did not connect in time')
    }
  }
  async function selectCanvasFile(binding, requestedFile) {
    if (!requestedFile) return
    const target = insideWorkspace(binding, requestedFile)
    if (path.extname(target).toLowerCase() !== '.pen') throw new Error('canvas file must end in .pen')
    if (binding.currentFile === target && binding.loadedFile === target) return
    if (binding.initialized && binding.loadedFile === binding.currentFile) await saveCanvas(binding)
    binding.currentFile = target
    binding.loadedFile = null
    binding.autosaveAfter = Infinity
    await queueCurrentFile(binding)
    if (binding.loadedFile !== target) throw new Error('canvas refused to load ' + target)
  }
  function canvasResult(result) {
    if (result && result.image) {
      const bytes = Math.round(String(result.image).length * 0.75 / 1024)
      const imageMediaType = String(result.mimeType || 'image/png')
      return {
        text: '[screenshot: ' + bytes + ' KB ' + imageMediaType + ']',
        imageData: String(result.image),
        imageMediaType,
      }
    }
    if (result && result.message != null) return { text: String(result.message) }
    return { text: result === undefined ? '' : JSON.stringify(result) }
  }
  const canvasBridge = {
    has(exec) { return !!bindingForExec(exec) },
    supports(tool) { return !!canvasMethods[tool] },
    async flush(opts, fileArg) {
      const binding = bindingForExec(opts.exec)
      if (!binding) return { ok: false, text: 'No live canvas is bound to this conversation.' }
      return enqueueCanvas(binding, async () => {
        try {
          await waitForCanvasReady(binding)
          await selectCanvasFile(binding, fileArg)
          const persisted = await saveCanvas(binding)
          return { ok: true, text: 'Live canvas flushed to disk (' + persisted.bytes + ' bytes).' }
        } catch (err) {
          return { ok: false, text: 'Live canvas flush failed: ' + (err && err.message ? err.message : String(err)) }
        }
      })
    },
    async run(tool, args, opts, fileArg) {
      const binding = bindingForExec(opts.exec)
      if (!binding) return null
      return enqueueCanvas(binding, async () => {
        try {
          await waitForCanvasReady(binding)
          await selectCanvasFile(binding, fileArg)
          const method = canvasMethods[tool]
          if (!method) return { ok: false, text: 'Canvas tool unavailable: ' + tool }
          const payload = { ...args }
          delete payload.filePath
          if (method === 'get-editor-state') {
            payload.include_schema = !!args.include_schema
            delete payload.include_canvas_design
            delete payload.include_scripts_and_shaders
          }
          if (method === 'batch-design' && !payload.input) {
            return { ok: false, text: 'This canvas editor requires input; editId patch retries are unavailable.' }
          }
          const response = await transport.request(binding, method, payload, 120000, opts.signal)
          if (response && response.success === false) {
            return { ok: false, text: 'Canvas error: ' + String(response.error || 'tool call failed').slice(0, 4000) }
          }
          const result = response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response
          const rendered = canvasResult(result)
          let text = rendered.text
          if (tool === 'execute') {
            binding.dirty = true
            try {
              const persisted = await saveCanvas(binding)
              text += '\nSaved by live canvas: ' + binding.currentFile + ' (' + persisted.bytes + ' bytes, ' + persisted.children + ' top-level nodes).'
            } catch (err) {
              return { ok: false, text: text.slice(0, 6000) + '\n\nCanvas edit succeeded, but disk save failed: ' + (err && err.message ? err.message : String(err)) }
            }
          }
          return {
            ok: true,
            mode: 'canvas',
            text: text.slice(0, 8000),
            ...(rendered.imageData ? { imageData: rendered.imageData, imageMediaType: rendered.imageMediaType } : {}),
          }
        } catch (err) {
          return { ok: false, text: 'Live canvas call failed: ' + (err && err.message ? err.message : String(err)) }
        }
      })
    },
  }

  headless.setCanvasBridge(canvasBridge)

  const routeDisposers = []
  routeDisposers.push(webServer.register({ kind: 'prefix', path: '/pen-editor', handler: (req, res) => {
    editorAssets.serve(req, res).catch((err) => {
      try { res.writeHead(500); res.end('serve error') } catch (err2) { /* ignore */ }
    })
  } }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/bind', handler: handleBind }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/unbind', handler: handleUnbind }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/files', handler: handleFiles }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/file', handler: handleFile }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/reveal', handler: handleReveal }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/ipc', handler: handleIpc }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/pending', handler: async (req, res) => {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    transport.poll(binding, req, res)
  } }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/state', handler: async (req, res) => {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ file: binding.currentFile, connected: binding.initialized && Date.now() - binding.lastSeen < 30000 }))
  } }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-session-token', handler: async (req, res) => {
    if (!bindingOf(req)) { res.writeHead(401); res.end('invalid canvas binding'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ token: sessionStore.token() }))
  } }))
  for (const d of routeDisposers) if (d) ctx.effect(() => d)
  ctx.effect(() => () => {
    headless.setCanvasBridge(null)
    for (const binding of [...bindings.values()]) releaseBinding(binding, new Error('pen.dev canvas bridge stopped'))
    bindingsBySession.clear()
  })
  console.log('[pen-dev-bridge] pen.dev canvas routes ready at /pen-editor (binds workspace on conversation trigger)')
}
