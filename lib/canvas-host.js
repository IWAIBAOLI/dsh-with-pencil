import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCanvasTransport } from './canvas-transport.js'
import { createCanvasExporter } from './canvas-export.js'
import { createEditorAssets } from './editor-assets.js'
import { decodeIpcBinary, encodeIpcBinary } from './ipc-binary.js'
import { createSessionStore } from './session-store.js'
import { createWorkspaceResources } from './workspace-resources.js'
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
  const resources = createWorkspaceResources({ mcpBin, transport })
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
    resources.cleanup(binding)
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
  function rejectSaveWaiters(binding, error) {
    for (const waiter of binding.saveWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
  async function inspectCanvasFile(target) {
    const content = await fsp.readFile(target, 'utf8')
    const document = validateDocument(content)
    return { bytes: Buffer.byteLength(content), children: document.children.length }
  }
  async function saveCanvas(binding, options = {}) {
    if (!binding.initialized || binding.loadedFile !== binding.currentFile) {
      throw new Error('canvas document is not ready to save')
    }
    if (binding.conflict) throw new Error('the .pen file changed on disk; resolve the canvas conflict before saving')
    const target = options.target || binding.currentFile
    if (!options.force && !binding.dirty) {
      try {
        const inspected = await inspectCanvasFile(target)
        binding.saveError = null
        return inspected
      }
      catch (err) {
        if (err && err.code === 'ENOENT') return { bytes: 0, children: 0, skipped: true }
        throw err
      }
    }
    const revision = binding.saveRevision
    binding.saveRequested = true
    binding.saveTarget = target
    binding.saveExclusive = !!options.exclusive
    binding.saveError = null
    try {
      await transport.request(binding, 'save-document', {}, 20000)
      if (binding.saveError) throw new Error(binding.saveError)
      await waitForCanvasSave(binding, revision)
    } catch (error) {
      binding.saveError = error && error.message ? error.message : String(error)
      throw error
    } finally {
      binding.saveRequested = false
      binding.saveTarget = null
      binding.saveExclusive = false
    }
    return inspectCanvasFile(target)
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
    if (s.startsWith('file:')) try { return fileURLToPath(s) } catch (error) { /* validate as a path below */ }
    return s
  }

  function bindingOf(req) {
    return bindings.get(urlOf(req).searchParams.get('binding') || '')
  }
  const editorAssets = createEditorAssets({ bindingOf, urlOf })
  function insideWorkspace(binding, input) {
    return resolveWorkspacePath(binding.workspace, uriToPath(input))
  }
  const exporter = createCanvasExporter({
    transport, insideWorkspace, saveCanvas, waitForCanvasReady, writeFileAtomic,
  })
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
  async function writeFileAtomicNew(target, content) {
    await fsp.mkdir(path.dirname(target), { recursive: true })
    const temporary = target + '.penhost-' + randomUUID() + '.tmp'
    try {
      await fsp.writeFile(temporary, content, { flag: 'wx' })
      await fsp.link(temporary, target)
    } finally {
      try { await fsp.unlink(temporary) } catch (error) { /* linked content survives */ }
    }
  }
  function validateDocument(content) {
    const document = JSON.parse(content)
    if (!document || document.version !== EDITOR_SCHEMA_VERSION || !Array.isArray(document.children)) {
      throw new Error('Unsupported .pen format ' + (document && document.version ? document.version : 'unknown') + '; this editor requires ' + EDITOR_SCHEMA_VERSION)
    }
    return document
  }
  function handleExternalDocumentChange(binding, change) {
    void enqueueCanvas(binding, async () => {
      if (binding.currentFile !== change.target || binding.loadedFile !== change.target) return
      let document
      try {
        if (change.error) throw change.error
        document = validateDocument(change.content)
      } catch (error) {
        binding.conflict = '磁盘上的 .pen 文件已删除或内容无效：' + (error && error.message ? error.message : String(error))
        return
      }
      if (binding.dirty || binding.saveRequested) {
        binding.conflict = '磁盘文件在画布存在未保存修改时被外部更新。请选择重新加载或保留画布版本。'
        return
      }
      binding.conflict = null
      binding.dirty = false
      resources.rememberDocument(binding, change.target, change.content)
      transport.notify(binding, 'file-update', {
        fileURI: pathToFileURL(change.target).toString(),
        content: change.content,
        zoomToFit: false,
        isDirty: false,
        displayName: path.basename(change.target),
      })
      console.log('[dsh-with-pencil] reloaded externally changed canvas:', change.target, '(' + document.children.length + ' top-level nodes)')
    }).catch((error) => console.warn('[dsh-with-pencil] external canvas reload failed:', error && error.message))
  }
  async function queueCurrentFile(binding) {
    const target = binding.currentFile
    let content
    try {
      content = await fsp.readFile(target, 'utf8')
      validateDocument(content)
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
    binding.conflict = null
    binding.saveError = null
    binding.autosaveAfter = Date.now() + 6000
    resources.rememberDocument(binding, target, content)
    transport.notify(binding, 'file-update', {
      fileURI: pathToFileURL(target).toString(), content, zoomToFit: true, isDirty: false, displayName: path.basename(target),
    })
  }
  const autosaveTimer = setInterval(() => {
    for (const binding of bindings.values()) {
      if (binding.loadedFile !== binding.currentFile) continue
      if (!binding.dirty) continue
      if (binding.conflict) continue
      if (Date.now() < binding.autosaveAfter) continue
      if (binding.queue.length >= 8) continue
      void enqueueCanvas(binding, () => saveCanvas(binding)).catch((err) => {
        console.warn('[dsh-with-pencil] canvas autosave failed:', err && err.message)
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
    return decodeIpcBinary(JSON.parse(body || '{}'))
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
    try { await editorAssets.preflight() }
    catch (error) {
      res.writeHead(503)
      res.end('pen.dev editor is unavailable: ' + (error && error.message ? error.message : String(error)))
      return
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
      serial: Promise.resolve(), conflict: null, documentFingerprint: null, documentWatcher: null,
      resourceWatchers: new Map(), onExternalDocumentChange: null, saveError: null,
      saveTarget: null, saveExclusive: false,
    }
    binding.onExternalDocumentChange = (change) => handleExternalDocumentChange(binding, change)
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
        binding.conflict = null
        binding.saveError = null
        binding.autosaveAfter = Infinity
        await queueCurrentFile(binding)
        if (binding.loadedFile !== target) throw new Error('canvas refused to load ' + target)
      })
    }
    catch (err) { res.writeHead(500); res.end(err.message); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ file: target }))
  }
  async function handleSave(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    try {
      const persisted = await enqueueCanvas(binding, () => saveCanvas(binding))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, file: binding.currentFile, persisted }))
    } catch (error) {
      res.writeHead(409); res.end(error && error.message ? error.message : String(error))
    }
  }
  async function handleSaveAs(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    let body
    try { body = await readBody(req) }
    catch (error) { res.writeHead(400); res.end('bad json'); return }
    let target
    try { target = insideWorkspace(binding, body.file) }
    catch (error) { res.writeHead(403); res.end(error.message); return }
    if (path.extname(target).toLowerCase() !== '.pen') {
      res.writeHead(400); res.end('canvas file must end in .pen'); return
    }
    if (target === binding.currentFile) {
      res.writeHead(409); res.end('choose a different filename for Save As'); return
    }
    try {
      await enqueueCanvas(binding, async () => {
        try { await fsp.access(target); throw new Error('the Save As target already exists') }
        catch (error) { if (!error || error.code !== 'ENOENT') throw error }
        await saveCanvas(binding, { target, force: true, exclusive: true })
        const content = await fsp.readFile(target, 'utf8')
        validateDocument(content)
        resources.stopDocumentWatcher(binding)
        binding.currentFile = target
        binding.loadedFile = target
        binding.conflict = null
        binding.saveError = null
        binding.dirty = false
        binding.autosaveAfter = Date.now() + 6000
        resources.rememberDocument(binding, target, content)
        transport.notify(binding, 'file-update', {
          fileURI: pathToFileURL(target).toString(),
          content,
          zoomToFit: false,
          isDirty: false,
          displayName: path.basename(target),
        })
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, file: target }))
    } catch (error) {
      res.writeHead(409); res.end(error && error.message ? error.message : String(error))
    }
  }
  async function handleExport(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    let body
    try { body = await readBody(req) }
    catch (error) { res.writeHead(400); res.end('bad json'); return }
    const format = String(body.format || '').toLowerCase()
    if (format !== 'png' && format !== 'pdf') {
      res.writeHead(400); res.end('export format must be png or pdf'); return
    }
    try {
      const result = await enqueueCanvas(binding, () => exporter.run(binding, format))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (error) {
      res.writeHead(409); res.end(error && error.message ? error.message : String(error))
    }
  }
  async function handleConflict(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    let body
    try { body = await readBody(req) }
    catch (error) { res.writeHead(400); res.end('bad json'); return }
    const action = String(body.action || '')
    try {
      await enqueueCanvas(binding, async () => {
        if (!binding.conflict) return
        if (action === 'reload') {
          const content = await fsp.readFile(binding.currentFile, 'utf8')
          validateDocument(content)
          binding.conflict = null
          binding.saveError = null
          binding.dirty = false
          binding.loadedFile = binding.currentFile
          binding.autosaveAfter = Date.now() + 6000
          resources.rememberDocument(binding, binding.currentFile, content)
          transport.notify(binding, 'file-update', {
            fileURI: pathToFileURL(binding.currentFile).toString(),
            content,
            zoomToFit: false,
            isDirty: false,
            displayName: path.basename(binding.currentFile),
          })
        } else if (action === 'overwrite') {
          const conflict = binding.conflict
          binding.conflict = null
          binding.dirty = true
          try { await saveCanvas(binding) }
          catch (error) { binding.conflict = conflict; throw error }
        } else {
          throw new Error('action must be reload or overwrite')
        }
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, file: binding.currentFile, conflict: binding.conflict }))
    } catch (error) {
      res.writeHead(409); res.end(error && error.message ? error.message : String(error))
    }
  }
  async function turnCurrentIntoLibrary(binding) {
    await enqueueCanvas(binding, async () => {
      if (binding.conflict) throw new Error('resolve the external file conflict first')
      try { await fsp.access(binding.currentFile) }
      catch (error) { if (error && error.code === 'ENOENT') binding.dirty = true; else throw error }
      await saveCanvas(binding)
      const target = await resources.nextLibraryPath(binding)
      resources.stopDocumentWatcher(binding)
      await fsp.rename(binding.currentFile, target)
      binding.currentFile = target
      binding.loadedFile = null
      binding.conflict = null
      await queueCurrentFile(binding)
    })
  }
  async function handleReveal(req, res) {
    const binding = bindingOf(req)
    if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
    let target = binding.workspace
    if (req.method === 'POST') {
      try {
        const body = await readBody(req)
        if (body.target) target = insideWorkspace(binding, body.target)
      } catch (error) { res.writeHead(400); res.end(error && error.message ? error.message : 'bad json'); return }
    }
    const argv = process.platform === 'darwin'
      ? ['/usr/bin/open', target]
      : process.platform === 'win32'
        ? ['explorer.exe', target]
        : ['xdg-open', target]
    try {
      const handle = sub.spawn({ argv, cwd: binding.workspace, env: {} })
      if (handle && handle.done && typeof handle.done.catch === 'function') {
        handle.done.catch((err) => console.warn('[dsh-with-pencil] reveal workspace failed', err && err.message))
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
          binding.conflict = null
          binding.saveError = null
          binding.autosaveAfter = Infinity
        }
        catch (err) { res.writeHead(403); res.end('forbidden'); return }
      } else if (msg.method === 'file-changed') {
        if (binding.loadedFile === binding.currentFile) binding.dirty = true
      } else if (msg.method === 'set-session') {
        sessionStore.set(msg.payload)
      } else if (msg.method === 'load-file') {
        const requested = msg.payload && msg.payload.filePath ? msg.payload.filePath : msg.payload
        void enqueueCanvas(binding, () => selectCanvasFile(binding, requested))
          .catch((error) => console.warn('[dsh-with-pencil] editor load-file failed:', error && error.message))
      } else if (msg.method === 'turn-into-library') {
        void turnCurrentIntoLibrary(binding)
          .catch((error) => console.warn('[dsh-with-pencil] turn-into-library failed:', error && error.message))
      } else if (msg.method === 'save-resource') {
        if (!binding.conflict && binding.currentFile && binding.loadedFile === binding.currentFile && (binding.saveRequested || Date.now() >= binding.autosaveAfter) && msg.payload && msg.payload.content !== undefined) {
          try {
            const target = insideWorkspace(binding, binding.saveTarget || binding.currentFile)
            const content = String(msg.payload.content)
            validateDocument(content)
            if (binding.saveExclusive) await writeFileAtomicNew(target, content)
            else await writeFileAtomic(target, content)
            if (target === binding.currentFile) resources.rememberDocument(binding, target, content)
            binding.dirty = false
            binding.saveError = null
            binding.saveRevision += 1
            for (const waiter of binding.saveWaiters.slice()) {
              if (binding.saveRevision <= waiter.revision) continue
              clearTimeout(waiter.timer)
              binding.saveWaiters.splice(binding.saveWaiters.indexOf(waiter), 1)
              waiter.resolve()
            }
          } catch (error) {
            binding.saveError = error && error.message ? error.message : String(error)
            rejectSaveWaiters(binding, error)
            console.error('[dsh-with-pencil] save failed', binding.saveError)
          }
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
    try {
      switch (msg.method) {
        case 'get-session': out = sessionStore.get(); break
        case 'get-current-workspace': out = { label: 'DeepSeek Harness', rootPath: binding.workspace }; break
        case 'get-device-id': out = { deviceId: 'dsh-local' }; break
        case 'get-last-online-at': out = { timestamp: Date.now(), lastOnlineAt: Date.now() }; break
        case 'read-file': out = await resources.readFile(binding, payload); break
        case 'stat-file': {
          try { out = await resources.statFile(binding, payload) }
          catch (error) { out = { exists: false, isFile: false } }
          break
        }
        case 'watch-file': resources.watchFile(binding, payload); out = undefined; break
        case 'unwatch-file': resources.unwatchFile(binding, payload); out = undefined; break
        case 'save-generated-image': out = await resources.saveGeneratedImage(binding, payload); break
        case 'import-file': out = await resources.importFile(binding, payload); break
        case 'import-files': out = await resources.importFiles(binding, payload); break
        case 'import-uri': out = await resources.importUri(binding, payload); break
        case 'find-libraries': out = await resources.findLibraries(binding); break
        case 'browse-libraries': out = await resources.browseLibraries(binding, !!payload.multiple); break
        case 'new-file-picker:get-data':
        case 'new-file-picker:delete-recent': out = { templates: [], recentFiles: [] }; break
        default:
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: msg.id, type: 'response', method: msg.method, error: { code: 'METHOD_NOT_FOUND', message: 'No handler for ' + msg.method } }))
          return
      }
    } catch (error) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: msg.id,
        type: 'response',
        method: msg.method,
        error: { code: 'HOST_ERROR', message: error && error.message ? error.message : String(error) },
      }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(encodeIpcBinary({ id: msg.id, type: 'response', method: msg.method, payload: out })))
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
    binding.saveError = null
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

  async function selectionContext(agent, signal) {
    const sessionId = String(agent && agent.session && agent.session.id || '')
    const key = bindingsBySession.get(sessionId)
    const binding = key ? bindings.get(key) : undefined
    if (!binding || !binding.initialized || binding.loadedFile !== binding.currentFile || Date.now() - binding.lastSeen > 30000) return ''
    const selectedFile = binding.currentFile
    try {
      const response = await transport.request(binding, 'get-editor-state', { include_schema: false }, 3000, signal)
      if (binding.currentFile !== selectedFile || binding.loadedFile !== selectedFile || response && response.success === false) return ''
      const result = response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response
      const message = String(result && result.message || '')
      const selected = /## Selected Elements:\s*\n([\s\S]*?)(?:\n\n#{1,6}\s|$)/.exec(message)
      if (!selected || !selected[1].trim()) return ''
      const lines = selected[1].split('\n').filter((line) => /^- `[^`]+`/.test(line.trim())).slice(0, 30)
      if (!lines.length) return ''
      const relativeFile = path.relative(binding.workspace, selectedFile).split(path.sep).join('/')
      return [
        'Current pen.dev canvas selection for this Harness conversation:',
        '- Active file: `' + relativeFile + '`',
        ...lines,
        'When the user refers to “this”, “这些” or the current selection, use these node IDs unless they explicitly name another target.',
      ].join('\n')
    } catch (error) {
      return ''
    }
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
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/save', handler: handleSave }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/save-as', handler: handleSaveAs }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/export', handler: handleExport }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/conflict', handler: handleConflict }))
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
    res.end(JSON.stringify({
      file: binding.currentFile,
      connected: binding.initialized && Date.now() - binding.lastSeen < 30000,
      conflict: binding.conflict,
      saveError: binding.saveError,
    }))
  } }))
  routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-session-token', handler: async (req, res) => {
    if (!bindingOf(req)) { res.writeHead(401); res.end('invalid canvas binding'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ token: sessionStore.token() }))
  } }))
  for (const d of routeDisposers) if (d) ctx.effect(() => d)
  ctx.effect(() => async () => {
    headless.setCanvasBridge(null)
    await Promise.all([...bindings.values()].map((binding) => enqueueCanvas(binding, async () => {
      if (!binding.initialized || binding.loadedFile !== binding.currentFile || !binding.dirty || binding.conflict) return
      try { await saveCanvas(binding) }
      catch (error) { console.warn('[dsh-with-pencil] final canvas save failed:', error && error.message) }
    })))
    for (const binding of [...bindings.values()]) releaseBinding(binding, new Error('pen.dev canvas bridge stopped'))
    bindingsBySession.clear()
  })
  console.log('[dsh-with-pencil] pen.dev canvas routes ready at /pen-editor (binds workspace on conversation trigger)')
  return { selectionContext }
}
