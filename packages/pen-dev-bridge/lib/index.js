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
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
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
    const cliKey = process.env.PEN_CLI_KEY || process.env.PENCIL_CLI_KEY || ''
    const baseEnv = {}
    if (cliKey) baseEnv.PEN_CLI_KEY = cliKey

    // Workspaces belong to sessions, not to plugin startup. Resolve the path
    // boundary only when a tool call is actually made.
    function workspaceForExec(exec) {
      const session = exec && exec.agent && exec.agent.session
      const scoped = policy && typeof policy.resolve === 'function'
        ? policy.resolve(session ? { session } : {})
        : undefined
      const cwd = (scoped && scoped.workspaceRoot) || (session && session.header && session.header.cwd)
      if (!cwd) throw new Error('pen.dev requires a workspace-backed conversation')
      return path.resolve(String(cwd))
    }
    function absPath(p, workspace) {
      const s = String(p || '')
      return path.isAbsolute(s) ? s : path.join(workspace, s)
    }

    // Keep each conversation's selected file, but allow only one active
    // headless process: the official CLI hardcodes the global `cli` socket.
    // MCP calls are serialized and switch that process between session files.
    const engines = new Map()
    const cliSocket = path.join(os.homedir(), '.pencil', 'socket', 'pencil-cli.sock')
    let activeEngine = null
    let mcpSerial = Promise.resolve()
    function engineFor(exec) {
      const workspace = workspaceForExec(exec)
      const key = String(exec && exec.agent && exec.agent.session && exec.agent.session.id || workspace)
      let engine = engines.get(key)
      if (!engine) {
        engine = { key, workspace, handle: null, file: null, ready: Promise.resolve() }
        engines.set(key, engine)
      }
      return engine
    }
    function cliSocketActive() {
      if (!fs.existsSync(cliSocket)) return Promise.resolve(false)
      return new Promise((resolve) => {
        const socket = net.createConnection(cliSocket)
        let settled = false
        const finish = (active) => {
          if (settled) return
          settled = true
          try { socket.destroy() } catch (err) { /* ignore */ }
          resolve(active)
        }
        socket.once('connect', () => finish(true))
        socket.once('error', () => finish(false))
        socket.setTimeout(400, () => finish(false))
      })
    }
    async function cleanupStaleCliSocket() {
      if (!fs.existsSync(cliSocket) || await cliSocketActive()) return false
      try { await fsp.unlink(cliSocket); return true }
      catch (err) { return false }
    }
    async function stopEngine(engine) {
      const handle = engine && engine.handle
      if (!handle) return
      engine.handle = null
      engine.file = null
      if (activeEngine === engine) activeEngine = null
      try { handle.terminate() } catch (err) { /* ignore */ }
      try {
        await Promise.race([
          handle.done.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ])
      } catch (err) { /* ignore */ }
      await cleanupStaleCliSocket()
    }
    async function ensureEngine(filePath, exec) {
      const engine = engineFor(exec)
      const target = absPath(filePath, engine.workspace)
      if (engine.handle && engine.file === target) return engine.ready
      if (activeEngine && activeEngine !== engine) await stopEngine(activeEngine)
      await stopEngine(engine)
      await cleanupStaleCliSocket()
      if (await cliSocketActive()) {
        throw new Error('another pen.dev CLI engine is already using ' + cliSocket)
      }
      engine.file = target
      // `--out` starts from an EMPTY canvas and never loads existing content;
      // on an existing file use `--in target --out target` so prior saves load.
      const argv = fs.existsSync(target)
        ? [penBin, 'interactive', '--in', target, '--out', target]
        : [penBin, 'interactive', '--out', target]
      const handle = sub.spawn({
        argv,
        cwd: engine.workspace,
        // Engine readiness logs land on STDOUT ("Ready."), not stderr.
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
        graceMs: 2000,
        signal: exec.signal,
        env: baseEnv,
      })
      engine.handle = handle
      activeEngine = engine
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
      }).catch(async (err) => { await stopEngine(engine); throw err })
      handle.done.then(
        () => {
          if (engine.handle === handle) { engine.handle = null; engine.file = null }
          if (activeEngine === engine) activeEngine = null
          void cleanupStaleCliSocket()
        },
        () => {
          if (engine.handle === handle) { engine.handle = null; engine.file = null }
          if (activeEngine === engine) activeEngine = null
          void cleanupStaleCliSocket()
        },
      )
      return engine.ready
    }
    function saveEngine(engine) {
      if (engine.handle && engine.handle.stdin) {
        try { engine.handle.stdin.write('save()\n') } catch (err) { /* ignore */ }
      }
    }
    ctx.effect(() => () => {
      for (const engine of engines.values()) void stopEngine(engine)
      engines.clear()
    })

    // ---- detect an external pen.dev editor app name (desktop / IDE) ----
    function detectApp(engine) {
      if (engine && engine.handle && activeEngine === engine) return 'cli'
      if (process.env.DSH_PEN_MCP_APP) return process.env.DSH_PEN_MCP_APP
      try {
        const dir = path.join(os.homedir(), '.pencil', 'apps')
        const entries = fs.readdirSync(dir).filter((n) => n !== '.DS_Store')
        for (const entry of entries) {
          const pid = Number(fs.readFileSync(path.join(dir, entry), 'utf8').trim())
          if (!Number.isInteger(pid) || pid <= 0) continue
          try { process.kill(pid, 0) } catch (err) { continue }
          if (fs.existsSync(path.join(os.homedir(), '.pencil', 'socket', 'pencil-' + entry + '.sock'))) return entry
        }
      } catch (err) { /* no live external editor */ }
      return null
    }

    // ---- run the official pen CLI once ----
    async function runCli(args, opts) {
      const workspace = workspaceForExec(opts.exec)
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
    function mcpClient(appName, workspace) {
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
        await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-pen-dev-bridge', version: '0.3.3' } })
        stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
        const listed = await call('tools/list', {})
        const tools = listed && listed.result && Array.isArray(listed.result.tools) ? listed.result.tools : []
        return new Map(tools.map((tool) => [tool.name, tool]))
      }
      const close = () => { try { handle.terminate() } catch (err) { /* ignore */ } }
      return { call, init, close, done: handle.done }
    }

    const mcpAliases = {
      get_app_state: ['get_app_state', 'get_editor_state'],
      execute: ['execute', 'batch_design'],
    }
    function adaptMcpArguments(requested, actual, args, spec, fileArg) {
      if (actual === 'get_editor_state') return { include_schema: !!args.include_schema }
      if (actual === 'batch_design') {
        if (!args.input) throw new Error('CLI 0.3.0 batch_design requires input; editId patch retries are unavailable')
        return { filePath: fileArg || args.filePath, input: args.input }
      }
      const adapted = { ...args }
      const requiredFields = spec && spec.inputSchema && Array.isArray(spec.inputSchema.required) ? spec.inputSchema.required : Array()
      if (fileArg && requiredFields.includes('filePath') && !adapted.filePath) adapted.filePath = fileArg
      return adapted
    }
    async function runMcpNow(tool, args, opts) {
      const workspace = workspaceForExec(opts.exec)
      const engine = engineFor(opts.exec)
      let appName = detectApp(engine)
      // Engine file may differ from the MCP argument filePath (get_screenshot
      // must not receive filePath, but still needs the engine on that file).
      const fileArg = (opts && opts.filePath) || (args && args.filePath)
      if (fileArg) {
        try {
          await ensureEngine(fileArg, opts.exec)
          appName = 'cli'
        } catch (err) {
          return { ok: false, text: 'engine start failed: ' + (err && err.message ? err.message : String(err)) }
        }
      }
      if (!appName) {
        return { ok: false, text: 'No pen.dev engine is bound to this conversation. Call pencil_mcp_open with the target .pen file first.' }
      }
      const client = mcpClient(appName, workspace)
      try {
        const catalog = await withSignal(client.init(), opts.signal)
        const candidates = mcpAliases[tool] || [tool]
        const actualTool = candidates.find((name) => catalog.has(name))
        if (!actualTool) {
          return { ok: false, text: 'MCP tool unavailable: ' + tool + ' (server exposes: ' + Array.from(catalog.keys()).join(', ') + ')' }
        }
        const toolArgs = adaptMcpArguments(tool, actualTool, args || {}, catalog.get(actualTool), fileArg)
        const raced = Promise.race([
          client.call('tools/call', { name: actualTool, arguments: toolArgs }),
          client.done.then(() => { throw new Error('pencil MCP server exited before responding (is the pen.dev editor app running?)') }),
        ])
        const res = await withSignal(raced, opts.signal)
        if (res && res.error) {
          return { ok: false, text: 'MCP error: ' + String((res.error.message || JSON.stringify(res.error))).slice(0, 4000) }
        }
        if (tool === 'execute' || actualTool === 'batch_design' || tool === 'export_html' || tool === 'export_nodes') {
          setTimeout(() => saveEngine(engine), 400)
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
    function runMcp(tool, args, opts) {
      const operation = mcpSerial.then(
        () => runMcpNow(tool, args, opts),
        () => runMcpNow(tool, args, opts),
      )
      mcpSerial = operation.then(() => undefined, () => undefined)
      return operation
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
      async (args, exec) => {
        const r = await runCli(['status'], { exec, signal: exec.signal })
        const text = (r.stdout || r.stderr || '').trim() || ('pen status exited with ' + r.exitCode)
        return { ok: r.exitCode === 0, text }
      }, 60000)

    register('pencil_login', 'Log in to pen.dev. Call with {email} to request a one-time code by email (non-interactive OTP flow), then call again with {email, code} to complete login. The session persists in ~/.pencil/session-cli.json. Alternative: set PEN_CLI_KEY (organization developer key from pen.dev web app).',
      {
        email: { type: 'string', required: true, description: 'Your pen.dev account email.' },
        code: { type: 'string', description: 'The OTP code emailed after the first call (omit on the first call).' },
      },
      async (args, exec) => {
        const email = String(args.email || '').trim()
        if (!email) return { ok: false, text: 'email is required' }
        const argv = ['login', '--email', email]
        if (args.code) argv.push('--code', String(args.code).trim())
        const r = await runCli(argv, { exec, signal: exec.signal })
        const text = (r.stdout || r.stderr || '').trim() || ('pen login exited with ' + r.exitCode)
        return { ok: r.exitCode === 0, text }
      }, 90000)

    register('pencil_workspaces', 'List your pen.dev organizations and workspaces by running `pen --list-workspaces`. Useful to pick a --workspace slug for pencil_design.',
      {},
      async (args, exec) => {
        const r = await runCli(['--list-workspaces'], { exec, signal: exec.signal })
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
        const r = await runCli(argv, { exec, signal: exec.signal })
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
        const r = await runCli(argv, { exec, signal: exec.signal })
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
        const workspace = workspaceForExec(exec)
        const target = absPath(filePath, workspace)
        const state = await runMcp('get_app_state', {
          filePath: target,
          include_schema: false,
          include_canvas_design: false,
          include_scripts_and_shaders: false,
        }, { exec, filePath: target, signal: exec.signal })
        if (!state.ok) return state
        return { ok: true, text: 'Engine ready on ' + target + '.\n\n' + state.text.slice(0, 4000) }
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
        const engine = engineFor(exec)
        if (engine.file) a.filePath = engine.file
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

    register('pencil_mcp_execute', 'Official Pencil MCP tool: modify a .pen document by running a JavaScript snippet (Insert/Get/Set/Print etc., see get_app_state with include_schema for the schema). The bridge maps this to execute or legacy batch_design according to tools/list. filePath is the .pen file. .pen files are encrypted; never read/write them with the fs tools. Changes are saved to the file after each successful call.',
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
        const a = { filePath: absPath(String(args.filePath || ''), workspace) }
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
        const fp = absPath(String(args.filePath || ''), workspaceForExec(exec))
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
        const a = { filePath: absPath(String(args.filePath || ''), workspace), nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [], outputPath: absPath(String(args.outputPath || ''), workspace) }
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
        const a = { filePath: absPath(String(args.filePath || ''), workspace), nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [], outputDir: absPath(String(args.outputDir || ''), workspace) }
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

      try {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        if (s && s.token) { uiState.email = s.email || ''; uiState.token = s.token }
      } catch (err) { /* no persisted state yet */ }
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
        try {
          fs.mkdirSync(path.dirname(stateFile), { recursive: true })
          fs.writeFileSync(stateFile, JSON.stringify(uiState, null, 2))
        } catch (err) { /* ignore */ }
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
        const decoded = uriToPath(input)
        const target = path.resolve(binding.workspace, decoded)
        const rel = path.relative(binding.workspace, target)
        if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
          throw new Error('path escapes the bound session workspace')
        }
        return target
      }
      function defaultFile(workspace) {
        const configured = process.env.DSH_PEN_FILE
        const target = configured
          ? (path.isAbsolute(configured) ? configured : path.join(workspace, configured))
          : path.join(workspace, 'designs', 'design.pen')
        const rel = path.relative(workspace, path.resolve(target))
        if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
          throw new Error('DSH_PEN_FILE must stay inside the bound conversation workspace')
        }
        return path.resolve(target)
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
            binding.queue.push({
              id: 'host-' + hostMsgSeq + '-' + Date.now(), type: 'notification', method: 'file-error',
              payload: { filePath: target, errorMessage: err && err.message ? err.message : String(err) },
            })
            return
          }
          content = JSON.stringify({ version: EDITOR_SCHEMA_VERSION, children: [], fileToken: randomUUID() })
        }
        binding.loadedFile = target
        binding.autosaveAfter = Date.now() + 6000
        hostMsgSeq += 1
        binding.queue.push({
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
setInterval(function () {
  fetch(__penHostUrl('/pen-host/pending'), { method: 'GET' })
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
          if (Date.now() < binding.autosaveAfter) continue
          if (binding.queue.length >= 8) continue
          hostMsgSeq += 1
          binding.queue.push({ id: 'host-' + hostMsgSeq + '-' + Date.now(), type: 'request', method: 'save-document', payload: {} })
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
        if (liveCwd && requestedCwd && liveCwd !== requestedCwd) {
          res.writeHead(409); res.end('workspace does not match the conversation'); return
        }
        const workspace = liveCwd || requestedCwd
        if (!workspace || !path.isAbsolute(workspace)) {
          res.writeHead(409); res.end('conversation has no workspace'); return
        }
        const existing = [...bindings.values()].find((item) => item.sessionId === sessionId)
        if (existing) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ binding: existing.key, workspace: existing.workspace, file: existing.currentFile }))
          return
        }
        const key = randomUUID()
        let currentFile
        try { currentFile = defaultFile(workspace) }
        catch (err) { res.writeHead(409); res.end(err.message); return }
        const binding = { key, sessionId, workspace, currentFile, loadedFile: null, autosaveAfter: Infinity, queue: [] }
        bindings.set(key, binding)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ binding: key, workspace, file: binding.currentFile }))
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
        binding.currentFile = target
        binding.loadedFile = null
        binding.autosaveAfter = Infinity
        binding.queue = []
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
        let msg
        try { msg = await readBody(req) }
        catch (err) { res.writeHead(400); res.end('bad json'); return }
        if (msg.type === 'notification') {
          if (msg.method === 'initialized') {
            await queueCurrentFile(binding)
          } else if (msg.method === 'set-current-file') {
            try {
              const uri = typeof msg.payload === 'string' ? msg.payload : msg.payload && msg.payload.uri
              binding.currentFile = insideWorkspace(binding, uri)
              binding.loadedFile = null
              binding.autosaveAfter = Infinity
              binding.queue = []
            }
            catch (err) { res.writeHead(403); res.end('forbidden'); return }
          } else if (msg.method === 'set-session') {
            if (msg.payload && msg.payload.token) {
              uiState.email = msg.payload.email || ''
              uiState.token = msg.payload.token
              persistState()
            }
          } else if (msg.method === 'save-resource') {
            if (binding.currentFile && binding.loadedFile === binding.currentFile && Date.now() >= binding.autosaveAfter && msg.payload && msg.payload.content !== undefined) {
              try {
                const target = insideWorkspace(binding, binding.currentFile)
                await writeFileAtomic(target, String(msg.payload.content))
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

      const routeDisposers = []
      routeDisposers.push(webServer.register({ kind: 'prefix', path: '/pen-editor', handler: (req, res) => {
        serveStatic(req, res).catch((err) => {
          try { res.writeHead(500); res.end('serve error') } catch (err2) { /* ignore */ }
        })
      } }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/bind', handler: handleBind }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/files', handler: handleFiles }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/file', handler: handleFile }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/reveal', handler: handleReveal }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/ipc', handler: handleIpc }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-host/pending', handler: async (req, res) => {
        const binding = bindingOf(req)
        if (!binding) { res.writeHead(401); res.end('invalid canvas binding'); return }
        const messages = binding.queue.splice(0, binding.queue.length)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ messages: messages }))
      } }))
      routeDisposers.push(webServer.register({ kind: 'exact', path: '/pen-session-token', handler: async (req, res) => {
        if (!bindingOf(req)) { res.writeHead(401); res.end('invalid canvas binding'); return }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ token: sessionToken() }))
      } }))
      for (const d of routeDisposers) if (d) ctx.effect(() => d)
      console.log('[pen-dev-bridge] pen.dev canvas routes ready at /pen-editor (binds workspace on conversation trigger)')
    }

    console.log(`[pen-dev-bridge] registered 12 pencil_* tools (pen=${penBin}, mcp=${mcpBin}; workspace resolves per call)`)
  },
}
