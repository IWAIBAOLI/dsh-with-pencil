import fsp from 'node:fs/promises'
import path from 'node:path'

function responseResult(response, operation) {
  if (response && response.success === false) {
    throw new Error(String(response.error || operation + ' failed'))
  }
  return response && Object.prototype.hasOwnProperty.call(response, 'result') ? response.result : response
}

function stateNodes(message, heading) {
  const section = new RegExp(heading + '[^\\n]*\\n([\\s\\S]*?)(?:\\n\\n#{1,6}\\s|$)').exec(String(message || ''))
  if (!section) return []
  const nodes = []
  for (const line of section[1].split('\n')) {
    const match = /^- `([^`]+)`(?: \([^)]*\))?(?:: ([^[]+?))?(?: \[[^\]]+\])?$/.exec(line.trim())
    if (match) nodes.push({ id: match[1], name: String(match[2] || match[1]).trim() })
  }
  return nodes
}

function safeName(value, fallback) {
  let name = String(value || fallback || 'export').normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/g, '')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = '_' + name
  return name || 'export'
}

/** Export the live editor selection (or all top-level nodes) into the workspace. */
export function createCanvasExporter({ transport, insideWorkspace, saveCanvas, waitForCanvasReady, writeFileAtomic }) {
  async function targets(binding) {
    const stateResponse = await transport.request(binding, 'get-editor-state', { include_schema: false }, 10000)
    const state = responseResult(stateResponse, 'reading the canvas selection')
    const selected = stateNodes(state && state.message, '## Selected Elements:')
    if (selected.length) return { scope: 'selection', nodes: selected }

    const treeResponse = await transport.request(binding, 'batch-get', { readDepth: 0 }, 30000)
    const tree = responseResult(treeResponse, 'reading the canvas document')
    const nodes = Array.isArray(tree && tree.nodes) ? tree.nodes.map((node) => ({
      id: String(node && (node.id || node.path) || ''),
      name: String(node && (node.name || node.id || node.path) || ''),
    })).filter((node) => node.id) : []
    return { scope: 'document', nodes }
  }

  async function run(binding, format) {
    if (format !== 'png' && format !== 'pdf') throw new Error('export format must be png or pdf')
    await waitForCanvasReady(binding)
    if (binding.conflict) throw new Error('resolve the external file conflict before exporting')
    await saveCanvas(binding)
    const targetSet = await targets(binding)
    if (!targetSet.nodes.length) throw new Error('the canvas is empty; add or select a frame before exporting')

    const documentName = safeName(path.basename(binding.currentFile, path.extname(binding.currentFile)), 'design')
    const outputDirectory = insideWorkspace(binding, path.join('exports', documentName))
    await fsp.mkdir(outputDirectory, { recursive: true })
    const files = []

    if (format === 'pdf') {
      const response = await transport.request(binding, 'export-nodes', {
        nodeIds: targetSet.nodes.map((node) => node.id), format: 'pdf', scale: 1,
      }, 120000)
      const exported = responseResult(response, 'PDF export')
      const image = exported && Array.isArray(exported.images) ? exported.images[0] : undefined
      if (!image || !image.image) throw new Error('the editor returned no PDF data')
      const target = path.join(outputDirectory, documentName + '.pdf')
      await writeFileAtomic(target, Buffer.from(String(image.image), 'base64'))
      files.push(path.relative(binding.workspace, target).split(path.sep).join('/'))
    } else {
      for (const [index, node] of targetSet.nodes.entries()) {
        const response = await transport.request(binding, 'export-nodes', {
          nodeIds: [node.id], format: 'png', scale: 2,
        }, 120000)
        const exported = responseResult(response, 'PNG export')
        const image = exported && Array.isArray(exported.images) ? exported.images[0] : undefined
        if (!image || !image.image) throw new Error('the editor returned no PNG data for ' + node.id)
        const filename = String(index + 1).padStart(2, '0') + '-' + safeName(node.name, node.id) + '.png'
        const target = path.join(outputDirectory, filename)
        await writeFileAtomic(target, Buffer.from(String(image.image), 'base64'))
        files.push(path.relative(binding.workspace, target).split(path.sep).join('/'))
      }
    }

    return {
      ok: true,
      format,
      scope: targetSet.scope,
      directory: path.relative(binding.workspace, outputDirectory).split(path.sep).join('/'),
      files,
    }
  }

  return { run }
}
