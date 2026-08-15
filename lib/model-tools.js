import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerLegacyTools } from './legacy-tools.js'
import { resolveWorkspacePath } from './workspace-path.js'

function textBlock(text) {
  return [{ type: 'text', text: String(text) }]
}

/**
 * Ground truth for the headless engine's snippet API (probed live against the
 * bundled @pen.dev/cli 0.3.0 MCP server). The official docs advertise Get/Print,
 * but the headless sandbox does NOT define them — calling them throws
 * ReferenceError and rolls back the whole block. Never let the model rely on
 * the official documentation chain for the operation list.
 */
const HEADLESS_OPS_NOTE =
  'In headless mode (no live canvas bound), pencil_mcp_execute snippets can only call these document operations: ' +
  'Update, Insert, Copy, Delete, Move, Set, Replace. Get and Print are NOT defined in this environment — never call them. ' +
  'Edit patches (editId/edits) are unavailable: after a failure, fix the snippet and resend the whole input. ' +
  'Read node data from the .pen file with regular file tools, or from this tool\'s returned state.'

/** Register the model-facing API without exposing Canvas Host internals. */
export function registerModelTools({ ctx, attachments, headless, workspaceForExec }) {
  const { runCli, runMcp } = headless
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
      const request = {
        include_schema: !!args.include_schema,
        include_canvas_design: !!args.include_canvas_design,
        include_scripts_and_shaders: !!args.include_scripts_and_shaders,
      }
      const selectedFile = headless.selectedFile(exec)
      if (selectedFile) request.filePath = selectedFile
      const state = await runMcp('get_app_state', request, { exec, signal: exec.signal })
      if (state.ok && state.mode !== 'canvas') {
        return { ...state, text: HEADLESS_OPS_NOTE + '\n\n' + state.text }
      }
      return state
    }, 120000)

  register('pencil_mcp_get_guidelines', 'Official Pencil MCP tool: load guides and styles for working with .pen files. Call with no args to list available guides/styles, then load one by {category: guide|style, name}.',
    {
      category: { type: 'string', enum: ['guide', 'style'], description: 'Guideline category.' },
      name: { type: 'string', description: 'Guideline name from the category listing.' },
      params: { type: 'object', additionalProperties: true, description: 'Key-value params required by the selected guide.' },
    },
    async (args, exec) => {
      const request = {}
      if (args.category) request.category = args.category
      if (args.name) request.name = args.name
      if (args.params) request.params = args.params
      return runMcp('get_guidelines', request, { exec, signal: exec.signal })
    }, 120000)

  register('pencil_mcp_execute', 'Official Pencil MCP tool: modify a .pen document by running a JavaScript snippet against the document API.\n\n' +
    'Available operations in this environment (headless): Update, Insert, Copy, Delete, Move, Set, Replace — exactly these seven. ' +
    'Get and Print are NOT defined here; never call them (they throw ReferenceError and roll back the whole call). ' +
    'Read node data from the .pen file with regular file tools, or from pencil_mcp_get_app_state output; Get-style reads are not available.\n\n' +
    'Each call runs in its own scope: local variables do not persist between calls, so assign ids without const/let. ' +
    'A failing call rolls back all modifications; editId/edits patch retries are unavailable in this environment, so fix the snippet and resend the whole input. ' +
    'Use pencil_mcp_get_app_state with include_schema for the .pen schema and pencil_mcp_get_guidelines for design guides.',
    {
      filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
      input: { type: 'string', description: 'JavaScript snippet to execute (required in this environment).' },
      editId: { type: 'string', description: 'Id of a failed execute snippet to patch; only available with a live canvas — unavailable in headless mode.' },
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
        description: 'Patch list for a failed snippet under editId; only available with a live canvas — unavailable in headless mode.',
      },
    },
    async (args, exec) => {
      const workspace = workspaceForExec(exec)
      const request = { filePath: resolveWorkspacePath(workspace, String(args.filePath || ''), { extension: '.pen', label: 'filePath' }) }
      if (args.input) request.input = String(args.input)
      if (args.editId) request.editId = String(args.editId)
      if (args.edits) request.edits = args.edits
      if (!request.input && !request.editId) return { ok: false, text: 'filePath and input (or editId+edits) are required' }
      return runMcp('execute', request, { exec, signal: exec.signal })
    }, 300000)

  register('pencil_mcp_get_screenshot', 'Official Pencil MCP tool: take a screenshot of a node in a .pen file (nodeId "document" for the whole file). Use sparingly to verify visual fidelity after edits.',
    {
      filePath: { type: 'string', required: true, description: 'Path to the .pen file, relative to the workspace.' },
      nodeId: { type: 'string', description: 'Node id to screenshot, or "document" for the entire document (default document).' },
    },
    async (args, exec) => {
      const filePath = resolveWorkspacePath(workspaceForExec(exec), String(args.filePath || ''), { extension: '.pen', label: 'filePath' })
      const nodeId = String(args.nodeId || 'document')
      return runMcp('get_screenshot', { nodeId }, { exec, filePath, signal: exec.signal })
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
      const request = {
        filePath: resolveWorkspacePath(workspace, String(args.filePath || ''), { extension: '.pen', label: 'filePath' }),
        nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [],
        outputPath: resolveWorkspacePath(workspace, String(args.outputPath || ''), { label: 'outputPath' }),
      }
      if (!request.nodeIds.length) return { ok: false, text: 'filePath, nodeIds and outputPath are required' }
      if (args.format) request.format = args.format
      if (args.includeHtmlScaffold !== undefined) request.includeHtmlScaffold = !!args.includeHtmlScaffold
      if (args.includeLayerIds !== undefined) request.includeLayerIds = !!args.includeLayerIds
      if (args.includeLayerNames !== undefined) request.includeLayerNames = !!args.includeLayerNames
      return runMcp('export_html', request, { exec, signal: exec.signal })
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
      const request = {
        filePath: resolveWorkspacePath(workspace, String(args.filePath || ''), { extension: '.pen', label: 'filePath' }),
        nodeIds: Array.isArray(args.nodeIds) ? args.nodeIds : [],
        outputDir: resolveWorkspacePath(workspace, String(args.outputDir || ''), { label: 'outputDir' }),
      }
      if (!request.nodeIds.length) return { ok: false, text: 'filePath, nodeIds and outputDir are required' }
      if (args.format) request.format = args.format
      if (args.quality !== undefined) request.quality = Number(args.quality)
      if (args.scale !== undefined) request.scale = Number(args.scale)
      return runMcp('export_nodes', request, { exec, signal: exec.signal })
    }, 180000)

  return legacyToolsEnabled ? 12 : 7
}
