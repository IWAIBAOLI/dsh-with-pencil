import fs from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { resolveWorkspacePath } from './workspace-path.js'
import { clearSessionFile, getSessionFile, sessionIdOf } from './session-file.js'

function withSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('pencil call aborted'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error(signal.reason ? String(signal.reason) : 'pencil call aborted/timed out'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/** Own the single global Pencil CLI engine and its short-lived MCP helpers. */
export function createHeadlessRuntime({ ctx, sub, penBin, mcpBin, baseEnv, workspaceForExec }) {
  const engines = new Map()
  const cliSocket = path.join(os.homedir(), '.pencil', 'socket', 'pencil-cli.sock')
  let activeEngine = null
  let mcpSerial = Promise.resolve()
  let canvasBridge = null

  function engineFor(exec) {
    const workspace = workspaceForExec(exec)
    const key = String(exec && exec.agent && exec.agent.session && exec.agent.session.id || workspace)
    let engine = engines.get(key)
    if (!engine) {
      engine = { key, workspace, handle: null, file: null, ready: Promise.resolve(), output: '', outputWaiters: [], dirty: false }
      engines.set(key, engine)
    }
    return engine
  }
  function appendEngineOutput(engine, chunk) {
    engine.output += chunk.toString()
    for (const waiter of engine.outputWaiters.slice()) {
      const fresh = engine.output.slice(waiter.start)
      if (!waiter.test(fresh)) continue
      clearTimeout(waiter.timer)
      engine.outputWaiters.splice(engine.outputWaiters.indexOf(waiter), 1)
      waiter.resolve(fresh)
    }
  }
  function waitForEngineOutput(engine, test, timeoutMs, start) {
    return new Promise((resolve, reject) => {
      const waiter = { start: start === undefined ? engine.output.length : start, test, resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        const index = engine.outputWaiters.indexOf(waiter)
        if (index !== -1) engine.outputWaiters.splice(index, 1)
        reject(new Error('pen.dev engine command timed out after ' + timeoutMs + 'ms'))
      }, timeoutMs)
      engine.outputWaiters.push(waiter)
      const fresh = engine.output.slice(waiter.start)
      if (test(fresh)) {
        clearTimeout(waiter.timer)
        engine.outputWaiters.splice(engine.outputWaiters.indexOf(waiter), 1)
        resolve(fresh)
      }
    })
  }
  function rejectEngineWaiters(engine, error) {
    for (const waiter of engine.outputWaiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
  async function engineCommand(engine, command, test, timeoutMs) {
    if (!engine.handle || !engine.handle.stdin) throw new Error('pen.dev engine is not running')
    const awaited = waitForEngineOutput(engine, test, timeoutMs)
    try { engine.handle.stdin.write(command + '\n') }
    catch (error) { rejectEngineWaiters(engine, error); throw error }
    return awaited
  }
  function cliSocketActive() {
    if (!fs.existsSync(cliSocket)) return Promise.resolve(false)
    return new Promise((resolve) => {
      const socket = net.createConnection(cliSocket)
      let settled = false
      const finish = (active) => {
        if (settled) return
        settled = true
        try { socket.destroy() } catch (error) { /* already closed */ }
        resolve(active)
      }
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
      socket.setTimeout(400, () => finish(false))
    })
  }
  async function cleanupStaleCliSocket() {
    if (!fs.existsSync(cliSocket) || await cliSocketActive()) return false
    try { await fsp.unlink(cliSocket); return true } catch (error) { return false }
  }
  async function saveEngine(engine) {
    const target = engine && engine.file
    if (!target) throw new Error('pen.dev engine has no active file')
    await engineCommand(engine, 'save()', (fresh) => fresh.includes('Saved ' + target), 15000)
    const content = await fsp.readFile(target, 'utf8')
    const document = JSON.parse(content)
    if (!document || !Array.isArray(document.children)) throw new Error('saved .pen file is not a valid document')
    return { bytes: Buffer.byteLength(content), children: document.children.length }
  }
  async function stopEngine(engine, flush = true) {
    const handle = engine && engine.handle
    if (!handle) return
    if (flush && engine.dirty) {
      await saveEngine(engine)
      engine.dirty = false
    }
    engine.handle = null
    engine.file = null
    engine.dirty = false
    if (activeEngine === engine) activeEngine = null
    try { handle.terminate() } catch (error) { /* already stopped */ }
    try {
      await Promise.race([handle.done.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 2500))])
    } catch (error) { /* termination is best effort */ }
    await cleanupStaleCliSocket()
  }
  async function ensureEngine(filePath, exec) {
    const engine = engineFor(exec)
    const target = resolveWorkspacePath(engine.workspace, filePath, { extension: '.pen', label: 'filePath' })
    let currentMtime = 0
    try { currentMtime = (await fsp.stat(target)).mtimeMs } catch { /* file may not exist yet */ }
    // Reuse the running engine only when the on-disk document is unchanged;
    // a live canvas saves after every edit, so a changed mtime means the
    // engine must reload or it would render stale content.
    if (engine.handle && engine.file === target && engine.fileMtime === currentMtime) return engine.ready
    if (activeEngine && activeEngine !== engine) await stopEngine(activeEngine)
    await stopEngine(engine)
    await cleanupStaleCliSocket()
    if (await cliSocketActive()) throw new Error('another pen.dev CLI engine is already using ' + cliSocket)
    engine.file = target
    engine.fileMtime = currentMtime
    engine.output = ''
    engine.outputWaiters = []
    engine.dirty = false
    const argv = fs.existsSync(target)
      ? [penBin, 'interactive', '--in', target, '--out', target]
      : [penBin, 'interactive', '--out', target]
    const handle = sub.spawn({
      argv, cwd: engine.workspace,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
      graceMs: 2000, signal: exec.signal, env: baseEnv,
    })
    engine.handle = handle
    activeEngine = engine
    if (handle.stdout) handle.stdout.on('data', (chunk) => appendEngineOutput(engine, chunk))
    engine.ready = waitForEngineOutput(engine, (fresh) => fresh.includes('[INFO] Ready.'), 20000, 0)
      .catch(async (error) => { await stopEngine(engine, false); throw error })
    const exited = () => {
      rejectEngineWaiters(engine, new Error('pen.dev engine exited'))
      if (engine.handle === handle) { engine.handle = null; engine.file = null }
      if (activeEngine === engine) activeEngine = null
      void cleanupStaleCliSocket()
    }
    handle.done.then(exited, exited)
    return engine.ready
  }

  async function runCli(args, opts) {
    const workspace = workspaceForExec(opts.exec)
    let argv = [penBin].concat(args)
    let executable = null
    try { fs.accessSync(penBin, fs.constants.X_OK) } catch (error) { executable = process.execPath; argv = [penBin].concat(args) }
    const handle = sub.spawn({
      argv: executable ? [executable, ...argv] : argv,
      cwd: workspace,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 400000, spill: { maxBytes: 2000000 } },
        stderr: { maxBytes: 200000, spill: { maxBytes: 1000000 } },
      },
      graceMs: 2000, signal: opts.signal, env: baseEnv,
    })
    const outcome = await handle.done
    const readAll = (stream) => { try { return stream ? stream.readFrom(0).text : '' } catch (error) { return '' } }
    return {
      exitCode: outcome.exitCode,
      stdout: readAll(handle.collected.stdout),
      stderr: readAll(handle.collected.stderr),
      aborted: !!(opts.signal && opts.signal.aborted),
    }
  }

  function mcpClient(appName, workspace) {
    const handle = sub.spawn({
      argv: [mcpBin, '--app', appName], cwd: workspace,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 200000 } },
      graceMs: 2000, env: baseEnv,
    })
    if (!handle.stdout || !handle.stdin) {
      // The spawn itself failed (the harness returns pid -1 with no streams);
      // surface the real cause instead of crashing on handle.stdout access.
      const failure = handle.done.catch((error) => error)
      console.warn('[dsh-with-pencil] pencil MCP server failed to start:', mcpBin)
      return {
        call: async () => { throw await failure },
        init: async () => { throw await failure },
        close: async () => { try { handle.terminate() } catch (error) { /* already stopped */ } },
        done: handle.done,
      }
    }
    const stdin = handle.stdin
    let buffer = ''
    const pending = new Map()
    let nextId = 1
    handle.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        let message
        try { message = JSON.parse(line) } catch (error) { continue }
        if (message && message.id !== undefined && pending.has(message.id)) {
          const resolve = pending.get(message.id)
          pending.delete(message.id)
          resolve(message)
        }
      }
    })
    const call = (method, params) => new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
    const init = async () => {
      await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-with-pencil', version: '0.5.0' } })
      stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      const listed = await call('tools/list', {})
      const tools = listed && listed.result && Array.isArray(listed.result.tools) ? listed.result.tools : []
      return new Map(tools.map((tool) => [tool.name, tool]))
    }
    const close = async () => {
      try { handle.terminate() } catch (error) { /* already stopped */ }
      try {
        await Promise.race([handle.done.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 2000))])
      } catch (error) { /* termination is best effort */ }
    }
    return { call, init, close, done: handle.done }
  }

  const aliases = { get_app_state: ['get_app_state', 'get_editor_state'], execute: ['execute', 'batch_design'] }
  function adaptArguments(actual, args, spec, fileArg) {
    if (actual === 'get_editor_state') return { include_schema: !!args.include_schema }
    if (actual === 'batch_design') {
      if (!args.input) throw new Error('CLI 0.3.0 batch_design requires input; editId patch retries are unavailable')
      return { filePath: fileArg || args.filePath, input: args.input }
    }
    const adapted = { ...args }
    const required = spec && spec.inputSchema && Array.isArray(spec.inputSchema.required) ? spec.inputSchema.required : []
    // The engine is loaded for fileArg, so every filePath-bearing call must
    // target that absolute path; a caller-supplied relative filePath makes the
    // MCP server answer "wrong .pen file" because it cannot match the loaded
    // document.
    if (fileArg && required.includes('filePath')) adapted.filePath = fileArg
    return adapted
  }
  function appFor(engine) {
    if (engine && engine.handle && activeEngine === engine) return 'cli'
    return process.env.DSH_PEN_MCP_APP || null
  }
  async function runMcpNow(tool, args, opts) {
    const workspace = workspaceForExec(opts.exec)
    const engine = engineFor(opts.exec)
    // The session's current working file is authoritative: whichever path
    // switched it (agent open, canvas UI, Save As), both the webview and the
    // headless engine operate on the same object. A tool call that names a
    // different file only matters when no session file is known yet.
    let fileArg = getSessionFile(sessionIdOf(opts.exec)) || (opts && opts.filePath) || (args && args.filePath)
    // Webview is preferred where it is reliable: live edits, state and
    // exports. Screenshots, node reads and guidelines stay on the headless
    // engine (the webview screenshot is a viewport image that ignores
    // nodeId, and data tools do not need a canvas).
    const canvasPreferred = tool === 'execute' || tool === 'get_app_state' || tool === 'export_nodes'
    if (canvasPreferred && canvasBridge && canvasBridge.has(opts.exec)) {
      if (canvasBridge.supports(tool)) {
        if (engine.handle) await stopEngine(engine)
        return canvasBridge.run(tool, args || {}, opts, fileArg)
      }
      const flushed = await canvasBridge.flush(opts, fileArg)
      if (!flushed.ok) return flushed
    }
    let appName = appFor(engine)
    if (fileArg) {
      try {
        await ensureEngine(fileArg, opts.exec)
        appName = 'cli'
        // The engine loaded the resolved absolute path; every filePath-bearing
        // MCP call must target that exact path (a caller-supplied relative
        // filePath makes the server answer "wrong .pen file").
        fileArg = engine.file
      }
      catch (error) { return { ok: false, text: 'engine start failed: ' + (error && error.message ? error.message : String(error)) } }
    }
    if (!appName) return { ok: false, text: 'No pen.dev engine is bound to this conversation. Call pencil_mcp_open with the target .pen file first.' }
    const client = mcpClient(appName, workspace)
    try {
      const catalog = await withSignal(client.init(), opts.signal)
      const actual = (aliases[tool] || [tool]).find((name) => catalog.has(name))
      if (!actual) return { ok: false, text: 'MCP tool unavailable: ' + tool + ' (server exposes: ' + Array.from(catalog.keys()).join(', ') + ')' }
      const toolArgs = adaptArguments(actual, args || {}, catalog.get(actual), fileArg)
      const response = await withSignal(Promise.race([
        client.call('tools/call', { name: actual, arguments: toolArgs }),
        client.done.then(() => { throw new Error('pencil MCP server exited before responding') }),
      ]), opts.signal)
      if (response && response.error) return { ok: false, text: 'MCP error: ' + String(response.error.message || JSON.stringify(response.error)).slice(0, 4000) }
      const content = response && response.result && response.result.content
      let imageData
      let imageMediaType
      let text = Array.isArray(content) ? content.map((item) => {
        if (item && item.text != null) return item.text
        if (item && item.type === 'image' && item.data) {
          imageData = String(item.data)
          imageMediaType = String(item.mimeType || 'image/png')
          return '[screenshot: ' + Math.round(imageData.length * 0.75 / 1024) + ' KB ' + imageMediaType + ']'
        }
        return ''
      }).join('\n') : JSON.stringify(response && response.result)
      if (!(response && response.result && response.result.isError) && (tool === 'execute' || actual === 'batch_design')) {
        engine.dirty = true
        try {
          const persisted = await saveEngine(engine)
          engine.dirty = false
          text += '\nSaved to disk: ' + engine.file + ' (' + persisted.bytes + ' bytes, ' + persisted.children + ' top-level nodes).'
        } catch (error) {
          return { ok: false, text: text.slice(0, 6000) + '\n\nMCP edit succeeded in memory, but disk save failed: ' + (error && error.message ? error.message : String(error)) }
        }
      }
      // get_app_state carries the .pen schema; 8000 chars truncate the core
      // node-type definitions (Text starts ~7.8k, Document ~10.6k after the
      // status block), which made the model probe attribute names instead.
      // Keep the whole node-type region visible for schema reads.
      const maxText = tool === 'get_app_state' ? 12000 : 8000
      return { ok: !(response && response.result && response.result.isError), text: text.slice(0, maxText), ...(imageData ? { imageData, imageMediaType } : {}) }
    } catch (error) {
      return { ok: false, text: 'MCP call failed: ' + (error && error.message ? error.message : String(error)) }
    } finally {
      await client.close()
    }
  }
  function serializeHeadless(run) {
    const operation = mcpSerial.then(run, run)
    mcpSerial = operation.then(() => undefined, () => undefined)
    return operation
  }
  function runMcp(tool, args, opts) {
    // Live canvases have their own per-session queue and do not share the
    // Pencil CLI socket. Keep those calls independent across conversations.
    if ((tool === 'execute' || tool === 'get_app_state' || tool === 'export_nodes') && canvasBridge && canvasBridge.has(opts.exec) && canvasBridge.supports(tool)) {
      return runMcpNow(tool, args, opts)
    }
    return serializeHeadless(() => runMcpNow(tool, args, opts))
  }
  async function releaseSessionNow(sessionId) {
    const engine = engines.get(String(sessionId || ''))
    clearSessionFile(sessionId)
    if (!engine) return
    await stopEngine(engine)
    engines.delete(engine.key)
  }
  function releaseSession(sessionId) {
    // Binding a browser canvas hands the document off from headless mode.
    // Wait for an in-flight MCP edit/save before terminating that engine.
    return serializeHeadless(() => releaseSessionNow(sessionId))
  }

  ctx.effect(() => () => {
    for (const engine of engines.values()) void stopEngine(engine)
    engines.clear()
  })

  return {
    runCli,
    runMcp,
    selectedFile(exec) { return engineFor(exec).file },
    canvasActive(exec) { return !!(canvasBridge && canvasBridge.has(exec)) },
    canvasDocumentExport(exec, opts) {
      if (!canvasBridge || !canvasBridge.has(exec)) return Promise.resolve(null)
      return canvasBridge.documentExport(exec, opts)
    },
    setCanvasBridge(value) { canvasBridge = value },
    releaseSession,
  }
}
