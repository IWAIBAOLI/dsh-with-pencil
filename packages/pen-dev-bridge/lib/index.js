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
import { defineTool } from '@deepseek-ai/dsh-tools'

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

function withSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('pencil call aborted'))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error(signal.reason ? String(signal.reason) : 'pencil call aborted/timed out'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

export default {
  name: 'pen-dev-bridge',
  apply(ctx) {
    const sub = ctx.get('subprocess')
    const policy = ctx.get('sandboxPolicy')
    if (sub === undefined) {
      console.warn('[pen-dev-bridge] subprocess service unavailable; bridge disabled')
      return
    }
    const { penBin, mcpBin } = resolvePenPaths()
    const workspace = (policy && policy.workspaceRoot) || process.cwd()
    const cliKey = process.env.PEN_CLI_KEY || process.env.PENCIL_CLI_KEY || ''
    const baseEnv = {}
    if (cliKey) baseEnv.PEN_CLI_KEY = cliKey

    // ---- headless editor engine lifecycle (the DeepSeek-as-agent seat) ----
    const engine = { handle: null, file: null, ready: Promise.resolve() }
    function absPath(p) {
      const s = String(p || '')
      return path.isAbsolute(s) ? s : path.join(workspace, s)
    }
    function stopEngine() {
      if (engine.handle) {
        try { engine.handle.terminate() } catch (err) { /* ignore */ }
        engine.handle = null
        engine.file = null
      }
    }
    function ensureEngine(filePath, signal) {
      const target = absPath(filePath)
      if (engine.handle && engine.file === target) return engine.ready
      stopEngine()
      engine.file = target
      // `--out` starts from an EMPTY canvas and never loads existing content;
      // on an existing file use `--in target --out target` so prior saves load.
      const argv = fs.existsSync(target)
        ? [penBin, 'interactive', '--in', target, '--out', target]
        : [penBin, 'interactive', '--out', target]
      const handle = sub.spawn({
        argv,
        cwd: workspace,
        // Engine readiness logs land on STDOUT ("Ready."), not stderr.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
        graceMs: 2000,
        signal,
        env: baseEnv,
      })
      engine.handle = handle
      engine.ready = new Promise((resolve, reject) => {
        let out = ''
        let settled = false
        const deadline = AbortSignal.timeout(20000)
        const onAbort = () => { cleanup(); reject(new Error('pen.dev engine did not become ready in time')) }
        const onData = (chunk) => {
          out += chunk.toString()
          if (out.includes('Ready.')) { cleanup(); resolve() }
        }
        const onExit = () => { cleanup(); reject(new Error('pen.dev engine exited before becoming ready')) }
        const cleanup = () => {
          if (settled) return
          settled = true
          deadline.removeEventListener('abort', onAbort)
          if (handle.stdout) { try { handle.stdout.removeListener('data', onData) } catch (err) { /* ignore */ } }
        }
        deadline.addEventListener('abort', onAbort)
        if (handle.stdout) handle.stdout.on('data', onData)
        handle.done.then(onExit, onExit)
      }).catch((err) => { stopEngine(); throw err })
      return engine.ready
    }
    function saveEngine() {
      if (engine.handle && engine.handle.stdin) {
        try { engine.handle.stdin.write('save()\n') } catch (err) { /* ignore */ }
      }
    }
    ctx.effect(() => stopEngine)

    // ---- detect an external pen.dev editor app name (desktop / IDE) ----
    let appNameCache = null
    function detectApp() {
      if (engine.handle) return 'cli'
      if (appNameCache) return appNameCache
      appNameCache = process.env.DSH_PEN_MCP_APP || 'desktop'
      try {
        const dir = path.join(os.homedir(), '.pencil', 'apps')
        const entries = fs.readdirSync(dir).filter((n) => n !== '.DS_Store')
        if (entries.length) appNameCache = entries[0]
      } catch (err) { /* keep fallback */ }
      return appNameCache
    }

    // ---- run the official pen CLI once ----
    async function runCli(args, opts) {
      let argv = [penBin].concat(args)
      let executable = null
      try { fs.accessSync(penBin, fs.constants.X_OK) } catch (err) { executable = process.execPath; argv = [penBin].concat(args) }
      const handle = sub.spawn({
        argv: executable ? [executable, ...argv] : argv,
        cwd: workspace,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 400000, spill: { maxBytes: 2000000 } },
          stderr: { maxBytes: 200000, spill: { maxBytes: 1000000 } },
        },
        graceMs: 2000,
        signal: opts.signal,
        env: baseEnv,
      })
      const outcome = await handle.done
      const readAll = (r) => { try { return r ? r.readFrom(0).text : '' } catch (err) { return '' } }
      return {
        exitCode: outcome.exitCode,
        stdout: readAll(handle.collected.stdout),
        stderr: readAll(handle.collected.stderr),
        aborted: !!(opts.signal && opts.signal.aborted),
      }
    }

    // ---- stdio MCP client for the bundled Pencil MCP server ----
    function mcpClient(appName) {
      const handle = sub.spawn({
        argv: [mcpBin, '--app', appName],
        cwd: workspace,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 200000 } },
        graceMs: 2000,
        env: baseEnv,
      })
      const stdin = handle.stdin
      const stdout = handle.stdout
      let buf = ''
      const pending = new Map()
      let nextId = 1
      stdout.on('data', (chunk) => {
        buf += chunk.toString()
        let idx
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx)
          buf = buf.slice(idx + 1)
          if (!line.trim()) continue
          let msg
          try { msg = JSON.parse(line) } catch (err) { continue }
          if (msg && msg.id !== undefined && pending.has(msg.id)) {
            const resolve = pending.get(msg.id)
            pending.delete(msg.id)
            resolve(msg)
          }
        }
      })
      const call = (method, params) => new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
      const init = async () => {
        await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-pen-dev-bridge', version: '0.1.0' } })
        stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      }
      const close = () => { try { handle.terminate() } catch (err) { /* ignore */ } }
      return { call, init, close, done: handle.done }
    }

    async function runMcp(tool, args, opts) {
      let appName = detectApp()
      // Engine file may differ from the MCP argument filePath (get_screenshot
      // must not receive filePath, but still needs the engine on that file).
      const fileArg = (opts && opts.filePath) || (args && args.filePath)
      if (fileArg) {
        try {
          await ensureEngine(fileArg, opts.signal)
          appName = 'cli'
        } catch (err) {
          return { ok: false, text: 'engine start failed: ' + (err && err.message ? err.message : String(err)) }
        }
      }
      const client = mcpClient(appName)
      try {
        await withSignal(client.init(), opts.signal)
        const raced = Promise.race([
          client.call('tools/call', { name: tool, arguments: args }),
          client.done.then(() => { throw new Error('pencil MCP server exited before responding (is the pen.dev editor app running?)') }),
        ])
        const res = await withSignal(raced, opts.signal)
        if (res && res.error) {
          return { ok: false, text: 'MCP error: ' + String((res.error.message || JSON.stringify(res.error))).slice(0, 4000) }
        }
        if (tool === 'execute' || tool === 'export_html' || tool === 'export_nodes') {
          setTimeout(() => saveEngine(), 400)
        }
        const content = res && res.result && res.result.content
        const text = Array.isArray(content)
          ? content.map((c) => {
              if (c && c.text != null) return c.text
              if (c && c.type === 'image' && c.data) {
                return '[screenshot: ' + Math.round(String(c.data).length * 0.75 / 1024) + ' KB PNG (base64)]'
              }
              return ''
            }).join('\n')
          : JSON.stringify(res && res.result)
        return { ok: !(res && res.result && res.result.isError), text: text.slice(0, 8000) }
      } catch (err) {
        return { ok: false, text: 'MCP call failed: ' + (err && err.message ? err.message : String(err)) }
      } finally {
        client.close()
      }
    }

    // ---- tool definitions ----
    const output = {
      schema: { type: 'object', additionalProperties: true },
      render(args, value) { return textBlock(value.text) },
    }
    function register(name, description, parameterProperties, run, timeoutMs) {
      const tool = defineTool({
        name,
        description,
        parameters: parameterProperties,
        output,
        timeoutMs,
        execute(args, exec) { return run(args, exec) },
      })
      const disposer = ctx.tools.register(tool)
      ctx.effect(() => disposer)
    }

    register('pencil_status', 'Check pen.dev (pencil.dev) authentication status by running the official `pen status` CLI. Run this first before any design work to see whether you are logged in and with which account.',
      {},
      async () => {
        const r = await runCli(['status'], {})
        const text = (r.stdout || r.stderr || '').trim() || ('pen status exited with ' + r.exitCode)
        return { ok: r.exitCode === 0, text }
      }, 60000)

    register('pencil_login', 'Log in to pen.dev. Call with {email} to request a one-time code by email (non-interactive OTP flow), then call again with {email, code} to complete login. The session persists in ~/.pencil/session-cli.json. Alternative: set PEN_CLI_KEY (organization developer key from pen.dev web app).',
      {
        email: { type: 'string', required: true, description: 'Your pen.dev account email.' },
        code: { type: 'string', description: 'The OTP code emailed after the first call (omit on the first call).' },
      },
      async (args) => {
        const email = String(args.email || '').trim()
        if (!email) return { ok: false, text: 'email is required' }
        const argv = ['login', '--email', email]
        if (args.code) argv.push('--code', String(args.code).trim())
        const r = await runCli(argv, {})
        const text = (r.stdout || r.stderr || '').trim() || ('pen login exited with ' + r.exitCode)
        return { ok: r.exitCode === 0, text }
      }, 90000)

    register('pencil_workspaces', 'List your pen.dev organizations and workspaces by running `pen --list-workspaces`. Useful to pick a --workspace slug for pencil_design.',
      {},
      async () => {
        const r = await runCli(['--list-workspaces'], {})
        const text = (r.stdout || r.stderr || '').trim() || ('pen --list-workspaces exited with ' + r.exitCode)
        return { ok: r.exitCode === 0, text }
      }, 60000)

    register('pencil_design', 'Run the official pen.dev AI design agent on .pen files (NOT DeepSeek): `pen [--in <file.pen>] --out <file.pen> --prompt "..."`. Delegates to pen.dev\'s OWN agent, which requires a local Claude Code / Codex / Gemini CLI login. Prefer the pencil_mcp_* tools: DeepSeek itself drives the pen.dev headless engine as the agent. Output paths are relative to the session workspace. May take minutes.',
      {
        prompt: { type: 'string', required: true, description: 'Natural-language design instruction.' },
        out: { type: 'string', description: 'Output .pen file path (default design.pen).' },
        in: { type: 'string', description: 'Optional input .pen file to modify.' },
        agent: { type: 'string', enum: ['claude', 'codex', 'gemini'], description: 'Agent backend (default claude).' },
        model: { type: 'string', description: 'Optional model id.' },
        workspace: { type: 'string', description: 'Optional pen.dev cloud workspace slug.' },
        export: { type: 'string', description: 'Optional image export path.' },
        exportType: { type: 'string', enum: ['png', 'jpeg', 'webp', 'pdf'], description: 'Export format (default png).' },
      },
      async (args, exec) => {
        const prompt = String(args.prompt || '').trim()
        if (!prompt) return { ok: false, text: 'prompt is required' }
        const out = String(args.out || 'design.pen').trim()
        const argv = ['--out', out]
        if (args.in) argv.push('--in', String(args.in))
        argv.push('--prompt', prompt)
        if (args.agent) argv.push('--agent', String(args.agent))
        if (args.model) argv.push('--model', String(args.model))
        if (args.workspace) argv.push('--workspace', String(args.workspace))
        if (args.export) {
          argv.push('--export', String(args.export))
          if (args.exportType) argv.push('--export-type', String(args.exportType))
        }
        const r = await runCli(argv, { signal: exec.signal })
        const tail = (r.stdout || '').trim()
        const err = (r.stderr || '').trim()
        let text = tail || err || ('pen design agent exited with ' + r.exitCode)
        if (r.aborted) text += '\n[call aborted/timed out]'
        return { ok: r.exitCode === 0 && !r.aborted, text }
      }, 900000)

    register('pencil_export', 'Export a .pen design file to an image without running any agent: `pen --in <file.pen> --export <out> --export-type <png|jpeg|webp|pdf>`. Uses the local headless engine; needs a saved .pen file.',
      {
        in: { type: 'string', required: true, description: 'Input .pen file path.' },
        out: { type: 'string', description: 'Output image path without extension.' },
        type: { type: 'string', enum: ['png', 'jpeg', 'webp', 'pdf'], description: 'Export format (default png).' },
      },
      async (args, exec) => {
        const inp = String(args.in || '').trim()
        if (!inp) return { ok: false, text: 'in (.pen file) is required' }
        const out = String(args.out || 'export').trim()
        const argv = ['--in', inp, '--export', out]
        if (args.type) argv.push('--export-type', String(args.type))
        const r = await runCli(argv, { signal: exec.signal })
        const text = (r.stdout || r.stderr || '').trim() || ('pen export exited with ' + r.exitCode)
        return { ok: r.exitCode === 0 && !r.aborted, text }
      }, 180000)

    register('pencil_mcp_open', 'Open (or switch) a .pen file into the local pen.dev headless engine. Spawns the engine once per file and keeps it alive so DeepSeek can drive design work through the pencil_mcp_* tools. Call this FIRST with the target .pen path; the file is created on first save. Returns the current app state.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
      },
      async (args, exec) => {
        const filePath = String(args.filePath || '').trim()
        if (!filePath) return { ok: false, text: 'filePath is required' }
        try {
          await ensureEngine(filePath, exec.signal)
        } catch (err) {
          return { ok: false, text: 'engine start failed: ' + (err && err.message ? err.message : String(err)) }
        }
        const client = mcpClient('cli')
        try {
          await withSignal(client.init(), exec.signal)
          const res = await withSignal(client.call('tools/call', { name: 'get_app_state', arguments: { filePath: absPath(filePath), include_schema: false, include_canvas_design: false, include_scripts_and_shaders: false } }), exec.signal)
          const content = res && res.result && res.result.content
          const text = Array.isArray(content) ? content.map((c) => (c && c.text != null ? c.text : '')).join('\n') : JSON.stringify(res && res.result)
          return { ok: !(res && res.result && res.result.isError), text: 'Engine ready on ' + absPath(filePath) + '.\n\n' + text.slice(0, 4000) }
        } catch (err) {
          return { ok: false, text: 'MCP call failed: ' + (err && err.message ? err.message : String(err)) }
        } finally {
          client.close()
        }
      }, 60000)

    register('pencil_mcp_get_app_state', 'Official Pencil MCP tool: get the current state of the .pen canvas editor (document, selection, browser state). Works against the local headless engine once pencil_mcp_open has opened a file. Always start design sessions with this (include_schema true) to learn the .pen schema.',
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
        if (engine.file) a.filePath = engine.file
        return runMcp('get_app_state', a, { signal: exec.signal })
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
        return runMcp('get_guidelines', a, { signal: exec.signal })
      }, 120000)

    register('pencil_mcp_execute', 'Official Pencil MCP tool: modify a .pen document by running a JavaScript snippet (Insert/Get/Set/Print etc., see get_app_state with include_schema for the schema). filePath is the .pen file. On failure, the server returns an editId — retry with {editId, edits:[{find, replace}]} instead of resending input. .pen files are encrypted; never read/write them with the fs tools. Changes are saved to the file after each successful call.',
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
        const a = { filePath: absPath(String(args.filePath || '')) }
        if (args.input) a.input = String(args.input)
        if (args.editId) a.editId = String(args.editId)
        if (args.edits) a.edits = args.edits
        if (!a.input && !a.editId) return { ok: false, text: 'filePath and input (or editId+edits) are required' }
        return runMcp('execute', a, { signal: exec.signal })
      }, 300000)

    register('pencil_mcp_get_screenshot', 'Official Pencil MCP tool: take a screenshot of a node in a .pen file (nodeId "document" for the whole file). Use sparingly to verify visual fidelity after edits.',
      {
        filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
        nodeId: { type: 'string', description: 'Node id to screenshot, or "document" for the entire document (default document).' },
      },
      async (args, exec) => {
        // get_screenshot must NOT receive filePath (the server rejects it);
        // the engine is still started on the file via opts.filePath.
        const fp = absPath(String(args.filePath || ''))
        const nodeId = String(args.nodeId || 'document')
        return runMcp('get_screenshot', { nodeId }, { filePath: fp, signal: exec.signal })
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
        const a = { filePath: absPath(String(args.filePath || '')), nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [], outputPath: absPath(String(args.outputPath || '')) }
        if (!a.filePath || !a.outputPath || !a.nodeIds.length) return { ok: false, text: 'filePath, nodeIds and outputPath are required' }
        if (args.format) a.format = args.format
        if (args.includeHtmlScaffold !== undefined) a.includeHtmlScaffold = !!args.includeHtmlScaffold
        if (args.includeLayerIds !== undefined) a.includeLayerIds = !!args.includeLayerIds
        if (args.includeLayerNames !== undefined) a.includeLayerNames = !!args.includeLayerNames
        return runMcp('export_html', a, { signal: exec.signal })
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
        const a = { filePath: absPath(String(args.filePath || '')), nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [], outputDir: absPath(String(args.outputDir || '')) }
        if (!a.filePath || !a.outputDir || !a.nodeIds.length) return { ok: false, text: 'filePath, nodeIds and outputDir are required' }
        if (args.format) a.format = args.format
        if (args.quality !== undefined) a.quality = Number(args.quality)
        if (args.scale !== undefined) a.scale = Number(args.scale)
        return runMcp('export_nodes', a, { signal: exec.signal })
      }, 180000)

    // ---- pen.dev canvas UI host: editor static routes + IPC bridge + autosave ----
    // Serves the pen-editor dist under /pen-editor, the vscodeapi postMessage
    // bridge under /pen-host/*, and keeps the browser editor in sync with the
    // local .pen file (save-document polling + save-resource writes).
    const webServer = ctx.get('webServer')
    if (webServer !== undefined) {
      const editorDir = process.env.DSH_PEN_EDITOR_DIR || path.join(workspace, 'pen-editor', 'out')
      const stateFile = path.join(workspace, '.pen-host-state.json')
      const sessionCli = path.join(os.homedir(), '.pencil', 'session-cli.json')
      const uiState = { email: '', token: '' }
      let currentFile = process.env.DSH_PEN_FILE || path.join(workspace, 'designs', 'login.pen')
      const MIME = {
        html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
        json: 'application/json', map: 'application/json', wasm: 'application/wasm',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
        woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon', txt: 'text/plain',
        glsl: 'text/plain', pen: 'application/octet-stream',
      }
      const TEXT_EXT = ['html', 'js', 'mjs', 'css', 'json', 'map', 'svg', 'txt', 'glsl']
      const hostQueue = []
      let hostMsgSeq = 0

      try {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        if (s && s.token) { uiState.email = s.email || ''; uiState.token = s.token }
      } catch (err) { /* no persisted state yet */ }
      function sessionToken() {
        if (uiState.token) return uiState.token
        try {
          const cli = JSON.parse(fs.readFileSync(sessionCli, 'utf8'))
          if (cli && cli.token) return cli.token
        } catch (err) { /* not logged in via CLI either */ }
        return null
      }
      function persistState() {
        try { fs.writeFileSync(stateFile, JSON.stringify(uiState, null, 2)) } catch (err) { /* ignore */ }
      }
      function pathnameOf(url) {
        const s = String(url || '/')
        const q = s.indexOf('?')
        return q >= 0 ? s.slice(0, q) : s
      }
      function uriToPath(uri) {
        const s = String(uri || '')
        if (s.indexOf('file://') === 0) {
          try { return decodeURIComponent(s.slice(7)) } catch (err) { return s.slice(7) }
        }
        return s
      }

      function injectBootstrap(html) {
        const boot = `
<script>
window.vscodeapi = {
  postMessage: function (msg) {
    fetch('/pen-host/ipc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) })
      .then(function (r) { return r.json() })
      .then(function (resp) { window.postMessage(resp, '*') })
      .catch(function (err) { console.error('[penhost] ipc error', err) })
  },
  getState: function () { return {} },
  setState: function () {}
};
var __penToken = null;
try {
  var __xhr = new XMLHttpRequest();
  __xhr.open('GET', '/pen-session-token', false);
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
  fileURI: 'file://' + (typeof window.__penFile !== 'undefined' ? window.__penFile : '')
};
setInterval(function () {
  fetch('/pen-host/pending', { method: 'GET' })
    .then(function (r) { return r.json() })
    .then(function (d) {
      if (d && Array.isArray(d.messages)) {
        for (var i = 0; i < d.messages.length; i++) window.postMessage(d.messages[i], '*')
      }
    })
    .catch(function () {})
}, 1000);
</script>`
        const marker = '<script type="module"'
        const idx = html.indexOf(marker)
        if (idx === -1) return html
        return html.slice(0, idx) + boot + '\n    ' + html.slice(idx)
      }
      let servedIndex = null
      try {
        servedIndex = injectBootstrap(fs.readFileSync(path.join(editorDir, 'index.html'), 'utf8'))
      } catch (err) {
        console.warn('[pen-dev-bridge] pen-editor index unavailable at ' + editorDir + ': ' + (err && err.message ? err.message : String(err)))
      }

      const autosaveTimer = setInterval(() => {
        if (hostQueue.length < 8) {
          hostMsgSeq += 1
          hostQueue.push({ id: 'host-' + hostMsgSeq + '-' + Date.now(), type: 'request', method: 'save-document', payload: {} })
        }
      }, 6000)
      ctx.effect(() => () => clearInterval(autosaveTimer))

      async function serveStatic(req, res, pathname) {
        const rel = pathname.slice('/pen-editor'.length) || '/index.html'
        if (rel.indexOf('..') !== -1) { res.writeHead(403); res.end('forbidden'); return }
        if (rel === '/index.html') {
          if (servedIndex === null) { res.writeHead(503); res.end('pen-editor index not ready'); return }
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(servedIndex)
          return
        }
        const full = path.join(editorDir, rel)
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

      async function handleIpc(req, res) {
        let body = ''
        try {
          for await (const chunk of req) body += chunk
        } catch (err) { /* ignore */ }
        let msg
        try { msg = JSON.parse(body) } catch (err) { res.writeHead(400); res.end('bad json'); return }
        if (msg.type === 'notification') {
          if (msg.method === 'set-current-file') {
            currentFile = uriToPath(msg.payload && msg.payload.uri)
          } else if (msg.method === 'set-session') {
            if (msg.payload && msg.payload.token) {
              uiState.email = msg.payload.email || ''
              uiState.token = msg.payload.token
              persistState()
            }
          } else if (msg.method === 'save-resource') {
            if (currentFile && msg.payload && msg.payload.content !== undefined) {
              try {
                await fsp.writeFile(currentFile, String(msg.payload.content))
              } catch (err) { console.error('[pen-dev-bridge] save failed', err && err.message) }
            }
          }
          res.writeHead(200); res.end('{}')
          return
        }
        if (msg.type === 'response') {
          res.writeHead(200); res.end('{}')
          return
        }
        if (msg.type !== 'request') { res.writeHead(200); res.end('{}'); return }
        const payload = msg.payload || {}
        let out
        switch (msg.method) {
          case 'get-session': out = { token: sessionToken() }; break
          case 'get-current-workspace': out = { label: 'DeepSeek Harness', rootPath: workspace }; break
          case 'get-device-id': out = { deviceId: 'dsh-local' }; break
          case 'get-last-online-at': out = { lastOnlineAt: Date.now() }; break
          case 'read-file': {
            const p = uriToPath(payload.uri)
            try { out = { content: await fsp.readFile(p, 'utf8') } }
            catch (err) { out = { content: '' } }
            break
          }
          case 'stat-file': {
            const p = uriToPath(payload.uri)
            try {
              const st = await fsp.stat(p)
              out = { exists: true, isFile: st.isFile() }
            } catch (err) { out = { exists: false, isFile: false } }
            break
          }
          case 'find-libraries': {
            try {
              const libs = fs.readdirSync(path.join(workspace, 'pen-dev-mcp', 'node_modules', '@pen.dev', 'cli', 'dist', 'out', 'data'))
                .filter((n) => n.endsWith('.lib.pen'))
                .map((n) => 'file://' + path.join(workspace, 'pen-dev-mcp', 'node_modules', '@pen.dev', 'cli', 'dist', 'out', 'data', n))
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

      const routeDisposers = []
      routeDisposers.push(webServer.register({ kind: 'prefix', path: '/pen-editor', handler: (req, res) => {
        serveStatic(req, res, pathnameOf(req.url)).catch((err) => {
          try { res.writeHead(500); res.end('serve error') } catch (err2) { /* ignore */ }
        })
      } }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/ipc', handler: handleIpc }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/pending', handler: async (req, res) => {
        const messages = hostQueue.splice(0, hostQueue.length)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ messages: messages }))
      } }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-session-token', handler: async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ token: sessionToken() }))
      } }))
      for (const d of routeDisposers) if (d) ctx.effect(() => d)
      console.log('[pen-dev-bridge] pen.dev canvas served at /pen-editor (dist=' + editorDir + ', file=' + currentFile + ')')
    }

    console.log(`[pen-dev-bridge] registered 12 pencil_* tools (pen=${penBin}, mcp=${mcpBin}, workspace=${workspace})`)
  },
}
