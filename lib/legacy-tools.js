import { resolveWorkspacePath } from './workspace-path.js'

/** Register the optional one-shot pen CLI tools kept for compatibility. */
export function registerLegacyTools({ register, runCli, workspaceForExec }) {
  register('pencil_status', 'Check pen.dev authentication status with the official `pen status` CLI.', {},
    async (args, exec) => {
      const result = await runCli(['status'], { exec, signal: exec.signal })
      const text = (result.stdout || result.stderr || '').trim() || ('pen status exited with ' + result.exitCode)
      return { ok: result.exitCode === 0, text }
    }, 60000)

  register('pencil_login', 'Log in to pen.dev with the official CLI email OTP flow.', {
    email: { type: 'string', required: true, description: 'Your pen.dev account email.' },
    code: { type: 'string', description: 'The emailed OTP code; omit on the first call.' },
  }, async (args, exec) => {
    const email = String(args.email || '').trim()
    if (!email) return { ok: false, text: 'email is required' }
    const argv = ['login', '--email', email]
    if (args.code) argv.push('--code', String(args.code).trim())
    const result = await runCli(argv, { exec, signal: exec.signal })
    const text = (result.stdout || result.stderr || '').trim() || ('pen login exited with ' + result.exitCode)
    return { ok: result.exitCode === 0, text }
  }, 90000)

  register('pencil_workspaces', 'List pen.dev cloud workspaces with the official CLI.', {},
    async (args, exec) => {
      const result = await runCli(['--list-workspaces'], { exec, signal: exec.signal })
      const text = (result.stdout || result.stderr || '').trim() || ('pen --list-workspaces exited with ' + result.exitCode)
      return { ok: result.exitCode === 0, text }
    }, 60000)

  register('pencil_design', 'Run the official pen.dev AI design agent instead of DeepSeek. Disabled by default; prefer the pencil_mcp_* tools.', {
    prompt: { type: 'string', required: true, description: 'Natural-language design instruction.' },
    out: { type: 'string', description: 'Output .pen file path (default design.pen).' },
    in: { type: 'string', description: 'Optional input .pen file to modify.' },
    agent: { type: 'string', enum: ['claude', 'codex', 'gemini'], description: 'Agent backend.' },
    model: { type: 'string', description: 'Optional model id.' },
    workspace: { type: 'string', description: 'Optional pen.dev cloud workspace slug.' },
    export: { type: 'string', description: 'Optional image export path.' },
    exportType: { type: 'string', enum: ['png', 'jpeg', 'webp', 'pdf'], description: 'Export format.' },
  }, async (args, exec) => {
    const prompt = String(args.prompt || '').trim()
    if (!prompt) return { ok: false, text: 'prompt is required' }
    const workspace = workspaceForExec(exec)
    const out = resolveWorkspacePath(workspace, String(args.out || 'design.pen').trim(), { extension: '.pen', label: 'out' })
    const argv = ['--out', out]
    if (args.in) argv.push('--in', resolveWorkspacePath(workspace, String(args.in), { extension: '.pen', label: 'in' }))
    argv.push('--prompt', prompt)
    if (args.agent) argv.push('--agent', String(args.agent))
    if (args.model) argv.push('--model', String(args.model))
    if (args.workspace) argv.push('--workspace', String(args.workspace))
    if (args.export) {
      argv.push('--export', resolveWorkspacePath(workspace, String(args.export), { label: 'export' }))
      if (args.exportType) argv.push('--export-type', String(args.exportType))
    }
    const result = await runCli(argv, { exec, signal: exec.signal })
    const text = (result.stdout || '').trim() || (result.stderr || '').trim() || ('pen design agent exited with ' + result.exitCode)
    return { ok: result.exitCode === 0 && !result.aborted, text: result.aborted ? text + '\n[call aborted/timed out]' : text }
  }, 900000)

  register('pencil_export', 'Export a .pen file with the official one-shot CLI. Disabled by default; prefer pencil_mcp_export_nodes.', {
    in: { type: 'string', required: true, description: 'Input .pen file path.' },
    out: { type: 'string', description: 'Output image path without extension.' },
    type: { type: 'string', enum: ['png', 'jpeg', 'webp', 'pdf'], description: 'Export format.' },
  }, async (args, exec) => {
    const workspace = workspaceForExec(exec)
    const inputPath = resolveWorkspacePath(workspace, String(args.in || '').trim(), { extension: '.pen', label: 'in' })
    const out = resolveWorkspacePath(workspace, String(args.out || 'export').trim(), { label: 'out' })
    const argv = ['--in', inputPath, '--export', out]
    if (args.type) argv.push('--export-type', String(args.type))
    const result = await runCli(argv, { exec, signal: exec.signal })
    const text = (result.stdout || result.stderr || '').trim() || ('pen export exited with ' + result.exitCode)
    return { ok: result.exitCode === 0 && !result.aborted, text }
  }, 180000)
}
