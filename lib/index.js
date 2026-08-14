// dsh-with-pencil — DeepSeek Harness with pen.dev (Pencil).
//
// DeepSeek IS the design agent: this plugin spawns pen.dev's local headless
// editor engine (from @pen.dev/cli) and exposes the official Pencil MCP tools
// (get_app_state / execute / export_html / export_nodes / get_screenshot /
// get_guidelines), with legacy one-shot `pen` CLI helpers available opt-in.
//
// It is the persistent, installable form of the session's dynamic plugin
// `pencil-6` — same capabilities, but a real Node plugin: full Node access,
// binary resolution from its own node_modules, env overrides, and cleanup on
// stop through Cordis disposers.
import { createRequire } from 'node:module'
import path from 'node:path'
import { registerCanvasHost } from './canvas-host.js'
import { createHeadlessRuntime } from './headless-runtime.js'
import { registerModelTools } from './model-tools.js'
import { workspaceForExec as resolveExecWorkspace } from './workspace-path.js'

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

export default {
  name: 'dsh-with-pencil',
  apply(ctx) {
    const sub = ctx.get('subprocess')
    const policy = ctx.get('sandboxPolicy')
    const attachments = ctx.get('attachments')
    if (sub === undefined) {
      console.warn('[dsh-with-pencil] subprocess service unavailable; Pencil integration disabled')
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
    const toolCount = registerModelTools({ ctx, attachments, headless, workspaceForExec })
    const canvasHost = registerCanvasHost({ ctx, sub, mcpBin, headless })
    if (canvasHost && typeof ctx.on === 'function') {
      ctx.on('system-prompt/assemble', async (assembly, context, next) => {
        const selection = await canvasHost.selectionContext(context && context.agent, context && context.signal)
        if (selection) {
          if (!Array.isArray(assembly.contexts)) assembly.contexts = []
          assembly.contexts.push({ name: 'pen-dev:selection', text: selection })
        }
        return next()
      })
    }

    console.log(`[dsh-with-pencil] registered ${toolCount} pencil_* tools (pen=${penBin}, mcp=${mcpBin}; workspace resolves per call)`)
  },
}
