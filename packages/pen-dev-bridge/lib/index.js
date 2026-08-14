// pen-dev-bridge — DeepSeek Harness ↔ pen.dev (pencil.dev) bridge.
//
// DeepSeek IS the design agent: this plugin spawns pen.dev's local headless
// editor engine (from @pen.dev/cli) and exposes the official Pencil MCP tools
// (get_app_state / execute / export_html / export_nodes / get_screenshot /
// get_guidelines) plus the one-shot `pen` CLI helpers as dynamic model tools.
//
// It is the persistent, installable form of the session's dynamic plugin
// `pencil-6` — same capabilities, but a real Node plugin: full Node access,
// binary resolution from its own node_modules, env overrides, and cleanup on
// stop through Cordis disposers.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createHeadlessRuntime } from './headless-runtime.js'
import { registerLegacyTools } from './legacy-tools.js'
import { resolveWorkspacePath, workspaceForExec as resolveExecWorkspace } from './workspace-path.js'

const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Binary resolution: env override -> @pen.dev/cli package
// ---------------------------------------------------------------------------
function resolvePenPaths() {
  const env = process.env
  if (env.DSH_PEN_CLI_BIN && env.DSH_PEN_MCP_BIN) {
    return { penBin: env.DSH_PEN_CLI_BIN, mcpBin: env.DSH_PEN_MCP_BIN }
  }
  const pkgRoot = path.dirname(require.resolve('@pen.dev/cli/package.json'))
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : process.arch
  const platform = process.platform === 'win32' ? 'windows' : process.platform // darwin | linux | windows
  const ext = platform === 'windows' ? '.exe' : ''
  const mcpBin = path.join(pkgRoot, 'dist', 'out', `mcp-server-${platform}-${arch}${ext}`)
  const penBin = path.join(pkgRoot, 'dist', 'index.mjs')
  return { penBin, mcpBin }
}

function textBlock(text) {
  return [{ type: 'text', text: String(text) }]
}

export default {
  name: 'pen-dev-bridge',
  apply(ctx) {
    const sub = ctx.get('subprocess')
    const policy = ctx.get('sandboxPolicy')
    const attachments = ctx.get('attachments')
    if (sub === undefined) {
      console.warn('[pen-dev-bridge] subprocess service unavailable; bridge disabled')
      return
    }
    const { penBin, mcpBin } = resolvePenPaths()
    const cliKey = process.env.PEN_CLI_KEY || process.env.PENCIL_CLI_KEY || ''
    const baseEnv = {}
    if (cliKey) baseEnv.PEN_CLI_KEY = cliKey

    // Workspaces belong to sessions, not to plugin startup. Resolve the path
    // boundary only when a tool call is actually made.
    function workspaceForExec(exec) {
      return resolveExecWorkspace(policy, exec)
    }

    const headless = createHeadlessRuntime({ ctx, sub, penBin, mcpBin, baseEnv, workspaceForExec })
    const { runCli, runMcp } = headless

    // ---- tool definitions ----
    const output = {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) {
        const blocks = textBlock(value.text)
        if (value && value.image && value.image.attachmentId) blocks.push({ type: 'image', attachment: value.image })
        return blocks
      },
    }
    async function materializeToolResult(value, toolName) {
      if (!value || !value.imageData) return value
      const { imageData, imageMediaType, ...rest } = value
      if (!attachments || typeof attachments.saveImage !== 'function') return rest
      const mediaType = String(imageMediaType || 'image/png')
      const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png'
      const image = await attachments.saveImage({
        data: Buffer.from(String(imageData), 'base64'),
        mediaType,
        name: toolName + '.' + extension,
      })
      return { ...rest, image }
    }
    function register(name, description, parameterProperties, run, timeoutMs) {
      const tool = defineTool({
        name,
        description,
        parameters: parameterProperties,
        output,
        timeoutMs,
        async execute(args, exec) { return materializeToolResult(await run(args, exec), name) },
      })
      const disposer = ctx.tools.register(tool)
      ctx.effect(() => disposer)
    }

    const legacyToolsEnabled = process.env.DSH_PEN_LEGACY_TOOLS === '1'
    if (legacyToolsEnabled) registerLegacyTools({ register, runCli, workspaceForExec })

    register('pencil_mcp_open', 'Open (or switch) a .pen file for this conversation. If its browser canvas is open, the file is loaded into that live editor and later MCP edits render there immediately; otherwise a local headless engine is used. Call this FIRST with the target .pen path. Returns the current app state.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
      },
      async (args, exec) => {
        const filePath = String(args.filePath || '').trim()
        if (!filePath) return { ok: false, text: 'filePath is required' }
        const workspace = workspaceForExec(exec)
        const target = resolveWorkspacePath(workspace, filePath, { extension: '.pen', label: 'filePath' })
        const state = await runMcp('get_app_state', {
          filePath: target,
          include_schema: false,
          include_canvas_design: false,
          include_scripts_and_shaders: false,
        }, { exec, filePath: target, signal: exec.signal })
        if (!state.ok) return state
        const readyLabel = state.mode === 'canvas' ? 'Live canvas ready on ' : 'Headless engine ready on '
        return { ok: true, text: readyLabel + target + '.\n\n' + state.text.slice(0, 4000) }
      }, 60000)

    register('pencil_mcp_get_app_state', 'Official Pencil MCP tool: get the current state of the live conversation canvas, or its headless fallback when no canvas is open. Always start design sessions with this (include_schema true) to learn the .pen schema.',
      {
        include_schema: { type: 'boolean', description: 'Include the .pen file schema (default false).' },
        include_canvas_design: { type: 'boolean', description: 'Include canvas editor instructions (default false).' },
        include_scripts_and_shaders: { type: 'boolean', description: 'Include scripts/shaders instructions (default false).' },
      },
      async (args, exec) => {
        const a = {
          include_schema: !!args.include_schema,
          include_canvas_design: !!args.include_canvas_design,
          include_scripts_and_shaders: !!args.include_scripts_and_shaders,
        }
        const selectedFile = headless.selectedFile(exec)
        if (selectedFile) a.filePath = selectedFile
        return runMcp('get_app_state', a, { exec, signal: exec.signal })
      }, 120000)

    register('pencil_mcp_get_guidelines', 'Official Pencil MCP tool: load guides and styles for working with .pen files. Call with no args to list available guides/styles, then load one by {category: guide|style, name}.',
      {
        category: { type: 'string', enum: ['guide', 'style'], description: 'Guideline category.' },
        name: { type: 'string', description: 'Guideline name from the category listing.' },
        params: { type: 'object', additionalProperties: true, description: 'Key-value params required by the selected guide.' },
      },
      async (args, exec) => {
        const a = {}
        if (args.category) a.category = args.category
        if (args.name) a.name = args.name
        if (args.params) a.params = args.params
        return runMcp('get_guidelines', a, { exec, signal: exec.signal })
      }, 120000)

    register('pencil_mcp_execute', 'Official Pencil MCP tool: modify a .pen document by running a JavaScript snippet (Insert/Get/Set/Print etc., see get_app_state with include_schema for the schema). With an open conversation canvas, this directly edits the visible editor via its official webview IPC; otherwise the bridge maps to execute or legacy batch_design in headless mode. Changes are saved and verified after each successful call.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
        input: { type: 'string', description: 'JavaScript snippet to execute (required unless editId+edits are used).' },
        editId: { type: 'string', description: 'Id of a failed execute snippet to patch; send only together with edits.' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              find: { type: 'string', required: true },
              replace: { type: 'string', required: true },
              all: { type: 'boolean' },
            },
          },
          description: 'Patch list for a failed snippet under editId.',
        },
      },
      async (args, exec) => {
        const workspace = workspaceForExec(exec)
        const a = { filePath: resolveWorkspacePath(workspace, String(args.filePath || ''), { extension: '.pen', label: 'filePath' }) }
        if (args.input) a.input = String(args.input)
        if (args.editId) a.editId = String(args.editId)
        if (args.edits) a.edits = args.edits
        if (!a.input && !a.editId) return { ok: false, text: 'filePath and input (or editId+edits) are required' }
        return runMcp('execute', a, { exec, signal: exec.signal })
      }, 300000)

    register('pencil_mcp_get_screenshot', 'Official Pencil MCP tool: take a screenshot of a node in a .pen file (nodeId "document" for the whole file). Use sparingly to verify visual fidelity after edits.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
        nodeId: { type: 'string', description: 'Node id to screenshot, or "document" for the entire document (default document).' },
      },
      async (args, exec) => {
        // get_screenshot must NOT receive filePath (the server rejects it);
        // the engine is still started on the file via opts.filePath.
        const fp = resolveWorkspacePath(workspaceForExec(exec), String(args.filePath || ''), { extension: '.pen', label: 'filePath' })
        const nodeId = String(args.nodeId || 'document')
        return runMcp('get_screenshot', { nodeId }, { exec, filePath: fp, signal: exec.signal })
      }, 120000)

    register('pencil_mcp_export_html', 'Official Pencil MCP tool: export .pen nodes to HTML (html-tailwind or html-css) at outputPath. Image assets are referenced with relative paths.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
        nodeIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Node ids to export.' },
        outputPath: { type: 'string', required: true, description: 'Path to write the HTML file (relative to workspace).' },
        format: { type: 'string', enum: ['html-tailwind', 'html-css'], description: 'Output format (default html-tailwind).' },
        includeHtmlScaffold: { type: 'boolean', description: 'Include a full HTML document scaffold (default true).' },
        includeLayerIds: { type: 'boolean', description: 'Include layer ids as data attributes (default false).' },
        includeLayerNames: { type: 'boolean', description: 'Include layer names as data attributes (default true).' },
      },
      async (args, exec) => {
        const workspace = workspaceForExec(exec)
        const a = {
          filePath: resolveWorkspacePath(workspace, String(args.filePath || ''), { extension: '.pen', label: 'filePath' }),
          nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [],
          outputPath: resolveWorkspacePath(workspace, String(args.outputPath || ''), { label: 'outputPath' }),
        }
        if (!a.filePath || !a.outputPath || !a.nodeIds.length) return { ok: false, text: 'filePath, nodeIds and outputPath are required' }
        if (args.format) a.format = args.format
        if (args.includeHtmlScaffold !== undefined) a.includeHtmlScaffold = !!args.includeHtmlScaffold
        if (args.includeLayerIds !== undefined) a.includeLayerIds = !!args.includeLayerIds
        if (args.includeLayerNames !== undefined) a.includeLayerNames = !!args.includeLayerNames
        return runMcp('export_html', a, { exec, signal: exec.signal })
      }, 180000)

    register('pencil_mcp_export_nodes', 'Official Pencil MCP tool: export .pen nodes to image files (PNG/JPEG/WEBP/PDF, 2x scale) into outputDir, one file per node.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
        nodeIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Node ids to export.' },
        outputDir: { type: 'string', required: true, description: 'Directory to write exported files to (relative to workspace).' },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'pdf'], description: 'Export format (default png).' },
        quality: { type: 'number', description: 'Quality 1-100 for jpeg/webp.' },
        scale: { type: 'number', description: 'Scale factor (default 2).' },
      },
      async (args, exec) => {
        const workspace = workspaceForExec(exec)
        const a = {
          filePath: resolveWorkspacePath(workspace, String(args.filePath || ''), { extension: '.pen', label: 'filePath' }),
          nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [],
          outputDir: resolveWorkspacePath(workspace, String(args.outputDir || ''), { label: 'outputDir' }),
        }
        if (!a.filePath || !a.outputDir || !a.nodeIds.length) return { ok: false, text: 'filePath, nodeIds and outputDir are required' }
        if (args.format) a.format = args.format
        if (args.quality !== undefined) a.quality = Number(args.quality)
        if (args.scale !== undefined) a.scale = Number(args.scale)
        return runMcp('export_nodes', a, { exec, signal: exec.signal })
      }, 180000)

    // ---- pen.dev canvas UI host: session-bound editor + IPC bridge ----
    const webServer = ctx.get('webServer')
    if (webServer !== undefined) {
      const packageDir = path.dirname(fileURLToPath(import.meta.url))
      const stateFile = path.resolve(process.env.DSH_PEN_STATE_FILE || path.join(os.homedir(), '.dsh', 'pen-dev-bridge', 'state.json'))
      const sessionCli = path.join(os.homedir(), '.pencil', 'session-cli.json')
      const uiState = { email: '', token: '' }
      const bindings = new Map()
      const bindingsBySession = new Map()
      // This must match CURRENT_SCHEMA_VERSION in the bundled pen-editor assets.
      // The editor rejects every other version instead of migrating it in place.
      const EDITOR_SCHEMA_VERSION = '2.14'
      const MIME = {
        html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
        json: 'application/json', map: 'application/json', wasm: 'application/wasm',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
        woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon', txt: 'text/plain',
        glsl: 'text/plain', pen: 'application/octet-stream',
      }
      const TEXT_EXT = ['html', 'js', 'mjs', 'css', 'json', 'map', 'svg', 'txt', 'glsl']
      let hostMsgSeq = 0
      let rawIndex
      let resolvedEditorDir

      function sessionIdForExec(exec) {
        return String(exec && exec.agent && exec.agent.session && exec.agent.session.id || '')
      }
      function bindingForExec(exec) {
        const sessionId = sessionIdForExec(exec)
        if (!sessionId) return undefined
        const key = bindingsBySession.get(sessionId)
        return key ? bindings.get(key) : undefined
      }
      function takeCanvasMessages(binding) {
        const messages = binding.queue.splice(0, binding.queue.length)
        for (const message of messages) {
          if (!message || message.type !== 'request') continue
          const pending = binding.pendingRequests.get(message.id)
          if (pending) pending.delivered = true
        }
        return messages
      }
      function pushCanvasMessage(binding, message) {
        binding.queue.push(message)
        const waiter = binding.pollWaiters.shift()
        if (waiter) waiter.finish(takeCanvasMessages(binding))
      }
      function rejectCanvasRequests(binding, error) {
        for (const pending of binding.pendingRequests.values()) {
          clearTimeout(pending.timer)
          if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
          pending.reject(error)
        }
        binding.pendingRequests.clear()
        for (const waiter of binding.saveWaiters.splice(0)) {
          clearTimeout(waiter.timer)
          waiter.reject(error)
        }
      }
      function releaseBinding(binding, reason) {
        if (!binding) return
        rejectCanvasRequests(binding, reason || new Error('pen.dev canvas binding released'))
        for (const waiter of binding.pollWaiters.splice(0)) waiter.finish([])
        bindings.delete(binding.key)
        if (bindingsBySession.get(binding.sessionId) === binding.key) bindingsBySession.delete(binding.sessionId)
      }
      function requestCanvas(binding, method, payload, timeoutMs = 120000, signal) {
        if (!binding.initialized || Date.now() - binding.lastSeen > 30000) {
          return Promise.reject(new Error('the conversation canvas is not connected'))
        }
        if (signal && signal.aborted) return Promise.reject(new Error('canvas request cancelled before delivery'))
        return new Promise((resolve, reject) => {
          hostMsgSeq += 1
          const id = 'host-' + hostMsgSeq + '-' + Date.now()
          const cancel = (reason) => {
            const pending = binding.pendingRequests.get(id)
            if (!pending) return
            binding.pendingRequests.delete(id)
            clearTimeout(pending.timer)
            if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
            const queued = binding.queue.findIndex((message) => message && message.id === id)
            if (queued !== -1) binding.queue.splice(queued, 1)
            const suffix = pending.delivered || queued === -1
              ? '; the editor may still complete it, so inspect canvas state before retrying'
              : ' before delivery'
            reject(new Error(reason + suffix))
          }
          const timer = setTimeout(() => cancel('canvas request ' + method + ' timed out after ' + timeoutMs + 'ms'), timeoutMs)
          const onAbort = () => cancel('canvas request ' + method + ' was cancelled')
          binding.pendingRequests.set(id, { resolve, reject, timer, method, delivered: false, signal, onAbort })
          if (signal) signal.addEventListener('abort', onAbort, { once: true })
          pushCanvasMessage(binding, { id, type: 'request', method, payload })
        })
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
          await requestCanvas(binding, 'save-document', {}, 20000)
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

      // Editor assets are plugin resources, never a conversation workspace.
      // Resolve them lazily on the first canvas request: an explicit override,
      // packaged assets, a source checkout, then the profile's local file/link
      // dependency provenance used by plugin development installs.
      function editorDirectory() {
        if (resolvedEditorDir) return resolvedEditorDir
        const candidates = []
        if (process.env.DSH_PEN_EDITOR_DIR) candidates.push(path.resolve(process.env.DSH_PEN_EDITOR_DIR))
        candidates.push(path.resolve(packageDir, '../editor/out'))
        candidates.push(path.resolve(packageDir, '../../../../pen-editor/out'))
        let cursor = packageDir
        for (let depth = 0; depth < 5; depth += 1) {
          const manifest = path.join(cursor, 'package.json')
          try {
            const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
            const spec = pkg && pkg.dependencies && pkg.dependencies['pen-dev-bridge-bundle']
            if (typeof spec === 'string' && (spec.startsWith('file:') || spec.startsWith('link:'))) {
              const bundleDir = path.resolve(cursor, spec.slice(spec.indexOf(':') + 1))
              candidates.push(path.resolve(bundleDir, '../../..', 'pen-editor/out'))
            }
          } catch (err) { /* not a profile manifest */ }
          const parent = path.dirname(cursor)
          if (parent === cursor) break
          cursor = parent
        }
        for (const candidate of candidates) {
          try {
            if (fs.statSync(path.join(candidate, 'index.html')).isFile()) {
              resolvedEditorDir = candidate
              return candidate
            }
          } catch (err) { /* try the next independent resource location */ }
        }
        throw new Error('pen-editor assets unavailable; set DSH_PEN_EDITOR_DIR to pen-editor/out')
      }

      try { fs.chmodSync(stateFile, 0o600) } catch (err) { /* no persisted state yet */ }
      try {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        if (s && s.token) { uiState.email = s.email || ''; uiState.token = s.token }
      } catch (err) { /* no valid persisted state yet */ }
      function sessionState() {
        if (uiState.email && uiState.token) return { email: uiState.email, token: uiState.token }
        try {
          const cli = JSON.parse(fs.readFileSync(sessionCli, 'utf8'))
          if (cli && cli.email && cli.token) return { email: cli.email, token: cli.token }
        } catch (err) { /* not logged in via CLI either */ }
        return { email: '', token: '' }
      }
      function sessionToken() { return sessionState().token || null }
      function persistState() {
        const temporary = stateFile + '.tmp-' + randomUUID()
        try {
          fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 })
          fs.writeFileSync(temporary, JSON.stringify(uiState, null, 2), { mode: 0o600 })
          fs.renameSync(temporary, stateFile)
          fs.chmodSync(stateFile, 0o600)
        } catch (err) {
          try { fs.unlinkSync(temporary) } catch (cleanupError) { /* no temporary state */ }
          console.warn('[pen-dev-bridge] failed to persist browser session:', err && err.message)
        }
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
            hostMsgSeq += 1
            pushCanvasMessage(binding, {
              id: 'host-' + hostMsgSeq + '-' + Date.now(), type: 'notification', method: 'file-error',
              payload: { filePath: target, errorMessage: err && err.message ? err.message : String(err) },
            })
            return
          }
          content = JSON.stringify({ version: EDITOR_SCHEMA_VERSION, children: [], fileToken: randomUUID() })
        }
        binding.loadedFile = target
        binding.dirty = false
        binding.autosaveAfter = Date.now() + 6000
        hostMsgSeq += 1
        pushCanvasMessage(binding, {
          id: 'host-' + hostMsgSeq + '-' + Date.now(), type: 'notification', method: 'file-update',
          payload: { fileURI: 'file://' + target, content, zoomToFit: true, isDirty: false, displayName: path.basename(target) },
        })
      }
      function injectBootstrap(html, binding) {
        const bindingKey = JSON.stringify(binding.key)
        const penFile = JSON.stringify(binding.currentFile)
        const boot = `
<script>
var __penBinding = ${bindingKey};
var __penFile = ${penFile};
function __penHostUrl(path) { return path + '?binding=' + encodeURIComponent(__penBinding); }
function __penDecodeResponse(resp) {
  var encoded = resp && resp.payload && resp.payload.__penBinaryBase64;
  if (typeof encoded !== 'string') return resp;
  var raw = atob(encoded);
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  resp.payload = bytes.buffer;
  return resp;
}
window.vscodeapi = {
  postMessage: function (msg) {
    fetch(__penHostUrl('/pen-host/ipc'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) })
      .then(function (r) { return r.json() })
      .then(__penDecodeResponse)
      .then(function (resp) { window.postMessage(resp, '*') })
      .catch(function (err) { console.error('[penhost] ipc error', err) })
  },
  getState: function () { return {} },
  setState: function () {}
};
var __penToken = null;
try {
  var __xhr = new XMLHttpRequest();
  __xhr.open('GET', __penHostUrl('/pen-session-token'), false);
  __xhr.send();
  if (__xhr.status === 200) { __penToken = JSON.parse(__xhr.responseText).token; }
} catch (e) {}
window.PENCIL_APP_NAME = 'cli';
window.PENCIL_INIT_PARAMS = {
  hostVersion: '0.1.94',
  editorVersion: '0.1.94',
  appName: 'cli',
  apiHostName: 'https://api.pencil.dev',
  displayName: 'DeepSeek Harness',
  sessionToken: __penToken,
  isTemporary: false,
  fileURI: 'file://' + __penFile
};
function __penPoll() {
  fetch(__penHostUrl('/pen-host/pending'), { method: 'GET' })
    .then(function (r) { return r.json() })
    .then(function (d) {
      if (d && Array.isArray(d.messages)) {
        for (var i = 0; i < d.messages.length; i++) window.postMessage(d.messages[i], '*')
      }
      setTimeout(__penPoll, 0);
    })
    .catch(function () { setTimeout(__penPoll, 1000); });
}
__penPoll();
</script>`
        const marker = '<script type="module"'
        const idx = html.indexOf(marker)
        if (idx === -1) return html
        return html.slice(0, idx) + boot + '\n    ' + html.slice(idx)
      }
      function editorIndex() {
        if (rawIndex !== undefined) return rawIndex
        try {
          rawIndex = fs.readFileSync(path.join(editorDirectory(), 'index.html'), 'utf8')
          return rawIndex
        } catch (err) {
          throw new Error(err && err.message ? err.message : String(err))
        }
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

      async function serveStatic(req, res) {
        const requestUrl = urlOf(req)
        const pathname = requestUrl.pathname
        const rel = pathname.slice('/pen-editor'.length) || '/index.html'
        if (rel.indexOf('..') !== -1) { res.writeHead(403); res.end('forbidden'); return }
        if (rel === '/index.html') {
          const binding = bindingOf(req)
          if (!binding) { res.writeHead(401); res.end('bind the canvas to a conversation first'); return }
          let servedIndex
          try { servedIndex = injectBootstrap(editorIndex(), binding) }
          catch (err) { res.writeHead(503); res.end(err.message); return }
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(servedIndex)
          return
        }
        let full
        try { full = path.join(editorDirectory(), rel) }
        catch (err) { res.writeHead(503); res.end(err.message); return }
        let st
        try { st = await fsp.stat(full) } catch (err) { res.writeHead(404); res.end('not found'); return }
        if (!st.isFile()) { res.writeHead(404); res.end('not found'); return }
        const dot = rel.lastIndexOf('.')
        const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ''
        const mime = MIME[ext] || 'application/octet-stream'
        try {
          if (TEXT_EXT.indexOf(ext) !== -1) {
            res.writeHead(200, { 'Content-Type': mime })
            res.end(await fsp.readFile(full, 'utf8'))
          } else {
            const buf = await fsp.readFile(full)
            res.writeHead(200, { 'Content-Type': mime, 'Content-Length': String(buf.byteLength) })
            res.end(buf)
          }
        } catch (err) {
          res.writeHead(500); res.end('serve error')
        }
      }

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
            if (msg.payload && msg.payload.token) {
              uiState.email = msg.payload.email || ''
              uiState.token = msg.payload.token
              persistState()
            }
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
          const pending = binding.pendingRequests.get(msg.id)
          if (pending) {
            binding.pendingRequests.delete(msg.id)
            clearTimeout(pending.timer)
            if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort)
            if (msg.error) pending.reject(new Error(msg.error.message || ('canvas ' + pending.method + ' failed')))
            else pending.resolve(msg.payload)
          }
          res.writeHead(200); res.end('{}')
          return
        }
        if (msg.type !== 'request') { res.writeHead(200); res.end('{}'); return }
        const payload = msg.payload || {}
        let out
        switch (msg.method) {
          case 'get-session': out = sessionState(); break
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
              const response = await requestCanvas(binding, method, payload, 120000, opts.signal)
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
        serveStatic(req, res).catch((err) => {
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
        binding.lastSeen = Date.now()
        const send = (messages) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ messages }))
        }
        if (binding.queue.length) { send(takeCanvasMessages(binding)); return }
        const waiter = { done: false, timer: null, finish: null }
        waiter.finish = (messages) => {
          if (waiter.done) return
          waiter.done = true
          clearTimeout(waiter.timer)
          const index = binding.pollWaiters.indexOf(waiter)
          if (index !== -1) binding.pollWaiters.splice(index, 1)
          try { send(messages) } catch (err) { /* browser disconnected */ }
        }
        waiter.timer = setTimeout(() => waiter.finish([]), 25000)
        res.once('close', () => {
          if (waiter.done) return
          waiter.done = true
          clearTimeout(waiter.timer)
          const index = binding.pollWaiters.indexOf(waiter)
          if (index !== -1) binding.pollWaiters.splice(index, 1)
        })
        binding.pollWaiters.push(waiter)
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
        res.end(JSON.stringify({ token: sessionToken() }))
      } }))
      for (const d of routeDisposers) if (d) ctx.effect(() => d)
      ctx.effect(() => () => {
        headless.setCanvasBridge(null)
        for (const binding of [...bindings.values()]) releaseBinding(binding, new Error('pen.dev canvas bridge stopped'))
        bindingsBySession.clear()
      })
      console.log('[pen-dev-bridge] pen.dev canvas routes ready at /pen-editor (binds workspace on conversation trigger)')
    }

    const toolCount = legacyToolsEnabled ? 12 : 7
    console.log(`[pen-dev-bridge] registered ${toolCount} pencil_* tools (pen=${penBin}, mcp=${mcpBin}; workspace resolves per call)`)
  },
}
