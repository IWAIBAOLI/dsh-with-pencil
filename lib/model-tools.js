import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerLegacyTools } from './legacy-tools.js'
import { resolveWorkspacePath } from './workspace-path.js'
import { setSessionFile, sessionIdOf } from './session-file.js'

function textBlock(text) {
  return [{ type: 'text', text: String(text) }]
}

/** Register the model-facing API without exposing Canvas Host internals. */
export function registerModelTools({ ctx, attachments, headless, workspaceForExec, vision }) {
  const { runCli, runMcp } = headless
  const output = {
    schema: { type: 'object', additionalProperties: true },
    render(args, value) {
      const blocks = textBlock(value.text)
      if (value && value.image && value.image.attachmentId) blocks.push({ type: 'image', attachment: value.image })
      return blocks
    },
  }
  const VISUAL_FIDELITY_INSTRUCTION =
    'Visual-fidelity spot check. Describe colors, font rendering, alignment/spacing, and layout positions of the design. ' +
    'Do NOT transcribe or read text content from the image — text is verified from the .pen document data instead.'

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
    // Text-mode screenshots carry the visual-fidelity instruction for the
    // image-translation layer. Multimodal models see the pixels themselves,
    // so they must not receive the instruction (it would steer their
    // native spot-check reading).
    const withInstruction = toolName === 'pencil_mcp_get_screenshot' && vision.mode !== 'multimodal'
      ? { ...image, instruction: VISUAL_FIDELITY_INSTRUCTION }
      : image
    return { ...rest, image: withInstruction }
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

  // The official renderer warms up over the first calls (fonts, caches):
  // the first export of a complex node often times out at the server's 60s
  // cap, then succeeds on the following attempt. Retry a few times so the
  // agent never sees a transient cold-start failure as a permanent one.
  async function retryExport(run, attempts = 3) {
    let lastError = ''
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await run()
      if (result.ok) return result
      lastError = result.text || 'export failed'
    }
    return { ok: false, text: 'export failed after ' + attempts + ' attempts (cold-start rendering may need retries): ' + lastError }
  }

  // Document screenshots go through the webview's global document export
  // (documentExport: every top-level node rendered through the live editor
  // IPC) when a canvas is active — it is far more reliable than the headless
  // engine for whole-document rendering. The exported node images are
  // composed back into one document view by document coordinates. The temp
  // dir lives inside the session workspace because the webview export path
  // enforces the workspace boundary; it is removed right after. If the
  // webview is unavailable or anything fails, return null so the caller
  // falls back to the native (low-res) document screenshot — there is no CLI
  // composition fallback.
  async function composeDocumentShot(filePath, exec) {
    if (!headless.canvasActive(exec)) return null
    const tmpDir = fs.mkdtempSync(path.join(workspaceForExec(exec), '.pen-doc-'))
    try {
      const docExport = await headless.canvasDocumentExport(exec, {
        outputDir: tmpDir, format: 'png', scale: 2, signal: exec.signal,
      })
      if (!docExport || !docExport.ok) return null
      const files = fs.readdirSync(tmpDir).filter((f) => f.toLowerCase().endsWith('.png'))
      if (!files.length) return null
      const read = await runMcp('batch_get', { filePath }, { exec, signal: exec.signal })
      if (!read.ok || !read.text) return null
      const nodes = JSON.parse(read.text)
      const tops = Array.isArray(nodes) ? nodes.filter((n) => {
        const w = Number(n && n.width)
        const h = Number(n && n.height)
        return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
      }) : []
      if (!tops.length || tops.length > 20) return null
      const sharpModule = await import('sharp').then((m) => m.default).catch(() => null)
      if (!sharpModule) return null
      const minX = Math.min(...tops.map((n) => Number(n.x) || 0))
      const minY = Math.min(...tops.map((n) => Number(n.y) || 0))
      const maxX = Math.max(...tops.map((n) => (Number(n.x) || 0) + Number(n.width)))
      const maxY = Math.max(...tops.map((n) => (Number(n.y) || 0) + Number(n.height)))
      const layers = []
      for (const n of tops) {
        const file = path.join(tmpDir, String(n.id) + '.png')
        if (!fs.existsSync(file)) continue
        layers.push({
          input: await sharpModule(file).resize(Math.max(1, Math.round(Number(n.width))), Math.max(1, Math.round(Number(n.height)))).png().toBuffer(),
          left: Math.round((Number(n.x) || 0) - minX),
          top: Math.round((Number(n.y) || 0) - minY),
        })
      }
      if (!layers.length) return null
      const canvasW = Math.max(1, Math.ceil(maxX - minX))
      const canvasH = Math.max(1, Math.ceil(maxY - minY))
      const composite = await sharpModule({
        create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite(layers).png().toBuffer()
      return {
        ok: true,
        text: '[screenshot: ' + Math.round(composite.length / 1024) + ' KB image/png]',
        imageData: composite.toString('base64'),
        imageMediaType: 'image/png',
      }
    } catch { return null } finally {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }

  const legacyToolsEnabled = process.env.DSH_PEN_LEGACY_TOOLS === '1'
  if (legacyToolsEnabled) registerLegacyTools({ register, runCli, workspaceForExec })

  register('pencil_mcp_open', 'Open (or switch) the conversation\'s .pen file — call FIRST for any design work. With a live canvas the file loads there and edits render live; otherwise a local headless engine is used. Returns the current app state.',
    {
      filePath: { type: 'string', required: true, description: 'Workspace-relative .pen path.' },
    },
    async (args, exec) => {
      const filePath = String(args.filePath || '').trim()
      if (!filePath) return { ok: false, text: 'filePath is required' }
      const workspace = workspaceForExec(exec)
      const target = resolveWorkspacePath(workspace, filePath, { extension: '.pen', label: 'filePath' })
      setSessionFile(sessionIdOf(exec), target)
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

  register('pencil_mcp_get_app_state', 'Get the current canvas/headless document state. Start design sessions with include_schema: true to learn the .pen schema.',
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
      return runMcp('get_app_state', request, { exec, signal: exec.signal })
    }, 120000)

  register('pencil_mcp_batch_get', 'Read .pen node data (text content, properties, structure) by node IDs or search patterns — the authoritative way to verify text and attribute values. Combine multiple node reads and searches into one call; returns the requested nodes with their direct children.',
    {
      filePath: { type: 'string', required: true, description: 'Workspace-relative .pen path.' },
      nodeIds: { type: 'array', items: { type: 'string' }, description: 'Node IDs to read; prefer batching several at once.' },
      parentId: { type: 'string', description: 'Only read nodes inside this subtree.' },
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Regex matched against node names.' },
            type: { type: 'string', description: 'Only nodes of this type.' },
            reusable: { type: 'boolean', description: 'Only nodes with reusable set to this value.' },
          },
        },
        description: 'Search patterns; combine with nodeIds in one call.',
      },
      readDepth: { type: 'number', description: 'How deep to descend from each read node (default 1; omitted children become "...").' },
      searchDepth: { type: 'number', description: 'How deep the search descends (default unlimited).' },
      resolveVariables: { type: 'boolean', description: 'Resolve variable-bound properties to their current values.' },
      resolveInstances: { type: 'boolean', description: 'Expand ref instances into full node structure.' },
      includePathGeometry: { type: 'boolean', description: 'Include full path geometry (default abbreviated).' },
    },
    async (args, exec) => {
      return runMcp('batch_get', args, { exec, signal: exec.signal })
    }, 120000)

  register('pencil_mcp_get_guidelines', 'Load .pen design guides and styles. Call with no args to list them, then load one by {category: guide|style, name}.',
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

  register('pencil_mcp_execute', 'Modify the .pen document by running a JavaScript snippet. Operations (only these): Update, Insert, Copy, Delete, Move, Set, Replace. Signatures: Insert(parentId, nodeData), Update(id, props), Delete(id), Move(id, targetId), Copy(id, targetId), Replace(id, nodeData). Get/Print are NOT defined — calling them throws ReferenceError and rolls back the call; read node data with pencil_mcp_batch_get (node IDs). Each call is its own scope (no shared locals; assign ids without const/let). Failure rolls back all edits; editId/edits patches are unavailable — fix and resend the input. Property semantics: lineHeight is a multiplier (1.2 = 120%), not px — lineHeight: 120 inflates layout ~120x and breaks rendering; gap/padding/fontSize/letterSpacing are px.',
    {
      filePath: { type: 'string', required: true, description: 'Workspace-relative .pen path.' },
      input: { type: 'string', description: 'Snippet to execute (required).' },
      editId: { type: 'string', description: 'Id of a failed snippet to patch (live canvas only).' },
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
        description: 'Patch list for a failed snippet (live canvas only).',
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

  register('pencil_mcp_get_screenshot', 'Render a .pen node (nodeId "document" = whole file) to an image returned directly as an attachment — a visual-fidelity spot check (colors, font rendering, alignment/spacing, layout positions). Screenshots are expensive: use sparingly and prefer the smallest meaningful node. Text and property content is verified with pencil_mcp_batch_get, not from the image.',
    {
      filePath: { type: 'string', required: true, description: 'Workspace-relative .pen path.' },
      nodeId: { type: 'string', description: 'Node id to screenshot, or "document" for the entire document (default document).' },
    },
    async (args, exec) => {
      const filePath = resolveWorkspacePath(workspaceForExec(exec), String(args.filePath || ''), { extension: '.pen', label: 'filePath' })
      const nodeId = String(args.nodeId || 'document')
      // Multimodal models see the pixels themselves: native screenshots are
      // the official spot-check path. Text models need the high-res routing
      // below because their image transcription depends on clarity.
      if (vision.mode === 'multimodal') {
        return runMcp('get_screenshot', { nodeId }, { exec, filePath, signal: exec.signal })
      }
      // Large nodes render as tiny thumbnails through the native screenshot
      // path, so route them internally to the high-resolution export renderer;
      // the temporary file is deleted right after. Small nodes stay native.
      const SCREENSHOT_EXPORT_THRESHOLD = 640
      let big = false
      if (nodeId !== 'document') {
        const read = await runMcp('batch_get', { filePath, nodeIds: [nodeId] }, { exec, signal: exec.signal })
        if (read.ok && read.text) {
          try {
            const nodes = JSON.parse(read.text)
            const node = Array.isArray(nodes) ? nodes.find((n) => n && n.id === nodeId) : null
            if (node) big = Math.max(Number(node.width) || 0, Number(node.height) || 0) > SCREENSHOT_EXPORT_THRESHOLD
          } catch { /* fall through to native */ }
        }
        if (big) {
          // The export path follows the environment: active canvas retries
          // retry the webview renderer (never switching to CLI, which is less
          // reliable while a canvas is live); no canvas uses the CLI engine
          // with the same retry count. Failure falls back to native.
          const tmpDir = fs.mkdtempSync(path.join(workspaceForExec(exec), '.pen-shot-'))
          try {
            // scale 1: already ~5x the native thumbnail resolution, while
            // larger scales make complex nodes (gradients, heavy shadows)
            // time out or fail with misleading "wrong .pen file" errors.
            const exported = await retryExport(() => runMcp('export_nodes', { filePath, nodeIds: [nodeId], outputDir: tmpDir, format: 'png', scale: 1 }, { exec, signal: exec.signal }))
            if (exported.ok) {
              const files = fs.readdirSync(tmpDir).filter((f) => f.toLowerCase().endsWith('.png'))
              if (files.length) {
                const data = fs.readFileSync(path.join(tmpDir, files[0]))
                const imageMediaType = 'image/png'
                return {
                  ok: true,
                  text: '[screenshot: ' + Math.round(data.length / 1024) + ' KB ' + imageMediaType + ']',
                  imageData: data.toString('base64'),
                  imageMediaType,
                }
              }
            }
            // Export failed after retries or produced nothing: fall back to the
            // native screenshot rather than failing the tool, and say so.
          } finally {
            try { await fsp.rm(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
          }
        }
      }
      if (nodeId === 'document') {
        const composed = await composeDocumentShot(filePath, exec)
        if (composed) return composed
      }
      const native = await runMcp('get_screenshot', { nodeId }, { exec, filePath, signal: exec.signal })
      if ((big || nodeId === 'document') && native.ok) {
        native.text = (native.text || '') + ' (compressed native screenshot — open the canvas for a full-resolution render)'
      }
      return native
    }, 300000)

  register('pencil_mcp_export_html', 'Export .pen nodes to HTML (html-tailwind or html-css) at outputPath; image assets use relative paths.',
    {
      filePath: { type: 'string', required: true, description: 'Workspace-relative .pen path.' },
      nodeIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Node ids to export.' },
      outputPath: { type: 'string', required: true, description: 'Workspace-relative output .html path.' },
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
      return retryExport(() => runMcp('export_html', request, { exec, signal: exec.signal }))
    }, 300000)

  register('pencil_mcp_export_nodes', 'Export .pen nodes to image files (PNG/JPEG/WEBP/PDF, 2x scale) into outputDir, one file per node. Use for deliverable files on disk (user handoff, multi-node export, specific format/scale) — not for design verification.',
    {
      filePath: { type: 'string', required: true, description: 'Workspace-relative .pen path.' },
      nodeIds: { type: 'array', required: true, items: { type: 'string' }, description: 'Node ids to export.' },
      outputDir: { type: 'string', required: true, description: 'Workspace-relative output directory.' },
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
      return retryExport(() => runMcp('export_nodes', request, { exec, signal: exec.signal }))
    }, 300000)

  return legacyToolsEnabled ? 12 : 7
}
