import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveWorkspacePath } from './workspace-path.js'

const SKIPPED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out'])

function uriToPath(value) {
  const input = String(value || '')
  if (!input.startsWith('file:')) return input
  try { return fileURLToPath(input) }
  catch (error) { return decodeURIComponent(input.replace(/^file:\/\//, '')) }
}

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  throw new Error('file contents were not transferred as binary data')
}

function relativeFilePath(binding, target) {
  const relative = path.relative(path.dirname(binding.currentFile), target).split(path.sep).join('/')
  return relative.startsWith('.') ? relative : './' + relative
}

function safeFileName(value, fallback) {
  const name = path.basename(String(value || fallback)).replace(/[\u0000-\u001f]/g, '').trim()
  return name && name !== '.' && name !== '..' ? name : fallback
}

async function writeUnique(directory, fileName, contents) {
  await fsp.mkdir(directory, { recursive: true })
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension) || 'asset'
  for (let suffix = 0; suffix < 10000; suffix += 1) {
    const candidateName = stem + (suffix ? '-' + suffix : '') + extension
    const candidate = path.join(directory, candidateName)
    try {
      const existing = await fsp.readFile(candidate)
      if (existing.equals(contents)) return candidate
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
      try {
        await fsp.writeFile(candidate, contents, { flag: 'wx' })
        return candidate
      } catch (writeError) {
        if (!writeError || writeError.code !== 'EEXIST') throw writeError
      }
    }
  }
  throw new Error('could not allocate a unique asset filename')
}

async function walkForLibraries(root) {
  const result = []
  async function walk(directory, depth) {
    if (depth > 6 || result.length >= 200) return
    let entries
    try { entries = await fsp.readdir(directory, { withFileTypes: true }) }
    catch (error) { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (result.length >= 200) break
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lib.pen')) result.push(full)
    }
  }
  await walk(root, 0)
  return result
}

/** File, asset, watcher, and design-library capabilities requested by the official editor. */
export function createWorkspaceResources({ mcpBin, transport }) {
  const builtInDataDir = path.resolve(path.dirname(mcpBin), 'data')

  function workspacePath(binding, input) {
    return resolveWorkspacePath(binding.workspace, uriToPath(input))
  }

  function readablePath(binding, input) {
    const decoded = uriToPath(input)
    const raw = path.isAbsolute(decoded) ? path.resolve(decoded) : path.resolve(binding.workspace, decoded)
    try { return workspacePath(binding, raw) }
    catch (workspaceError) {
      let realData
      let realTarget
      try {
        realData = fs.realpathSync.native(builtInDataDir)
        realTarget = fs.realpathSync.native(raw)
      } catch (error) { throw workspaceError }
      if (!isInside(realData, realTarget) || !realTarget.toLowerCase().endsWith('.lib.pen')) throw workspaceError
      return realTarget
    }
  }

  function fingerprint(content) {
    return createHash('sha256').update(content).digest('hex')
  }

  function rememberDocument(binding, target, content) {
    binding.documentFingerprint = fingerprint(content)
    if (binding.documentWatcher && binding.documentWatcher.target === target) return
    stopDocumentWatcher(binding)
    const listener = async (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
      let nextContent
      try { nextContent = await fsp.readFile(target, 'utf8') }
      catch (error) {
        if (binding.onExternalDocumentChange) binding.onExternalDocumentChange({ target, error })
        return
      }
      const nextFingerprint = fingerprint(nextContent)
      if (nextFingerprint === binding.documentFingerprint) return
      if (binding.onExternalDocumentChange) {
        binding.onExternalDocumentChange({ target, content: nextContent, fingerprint: nextFingerprint })
      }
    }
    fs.watchFile(target, { interval: 500, persistent: false }, listener)
    binding.documentWatcher = { target, listener }
  }

  function stopDocumentWatcher(binding) {
    const watcher = binding.documentWatcher
    if (!watcher) return
    fs.unwatchFile(watcher.target, watcher.listener)
    binding.documentWatcher = null
  }

  function watchFile(binding, input) {
    const target = workspacePath(binding, input)
    const key = path.resolve(target)
    const current = binding.resourceWatchers.get(key)
    if (current) { current.references += 1; return }
    const uri = String(input).startsWith('file:') ? String(input) : pathToFileURL(target).toString()
    const listener = (next, previous) => {
      if (next.mtimeMs === previous.mtimeMs && next.size === previous.size) return
      transport.notify(binding, 'file-changed', uri)
    }
    fs.watchFile(target, { interval: 500, persistent: false }, listener)
    binding.resourceWatchers.set(key, { target, listener, references: 1 })
  }

  function unwatchFile(binding, input) {
    const target = workspacePath(binding, input)
    const key = path.resolve(target)
    const watcher = binding.resourceWatchers.get(key)
    if (!watcher) return
    watcher.references -= 1
    if (watcher.references > 0) return
    fs.unwatchFile(watcher.target, watcher.listener)
    binding.resourceWatchers.delete(key)
  }

  function cleanup(binding) {
    stopDocumentWatcher(binding)
    for (const watcher of binding.resourceWatchers.values()) {
      fs.unwatchFile(watcher.target, watcher.listener)
    }
    binding.resourceWatchers.clear()
  }

  async function importFile(binding, item) {
    const contents = asBuffer(item && item.fileContents)
    const fileName = safeFileName(item && item.fileName, 'image.png')
    const imagesDir = resolveWorkspacePath(binding.workspace, path.join(path.dirname(binding.currentFile), 'images'))
    const target = await writeUnique(imagesDir, fileName, contents)
    return { filePath: relativeFilePath(binding, target) }
  }

  async function importFiles(binding, items) {
    if (!Array.isArray(items)) throw new Error('import-files requires an array')
    const result = []
    for (const item of items) result.push(await importFile(binding, item))
    return result
  }

  async function importUri(binding, payload) {
    const target = workspacePath(binding, payload && payload.uri)
    const fileContents = await fsp.readFile(target)
    return { filePath: relativeFilePath(binding, target), fileContents }
  }

  async function saveGeneratedImage(binding, payload) {
    const encoded = String(payload && payload.image || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    if (!encoded) throw new Error('generated image is empty')
    const contents = Buffer.from(encoded, 'base64')
    if (!contents.length) throw new Error('generated image is invalid')
    const imagesDir = resolveWorkspacePath(binding.workspace, path.join(path.dirname(binding.currentFile), 'images'))
    const target = await writeUnique(imagesDir, 'generated-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.png', contents)
    return { relativePath: relativeFilePath(binding, target) }
  }

  async function findLibraries(binding) {
    const workspaceLibraries = await walkForLibraries(binding.workspace)
    let builtIns = []
    try {
      builtIns = (await fsp.readdir(builtInDataDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.lib.pen'))
        .map((entry) => path.join(builtInDataDir, entry.name))
    } catch (error) { /* official CLI package may omit bundled libraries */ }
    return [...new Set([...workspaceLibraries, ...builtIns])].map((file) => pathToFileURL(file).toString())
  }

  async function browseLibraries(binding, multiple) {
    const libraries = await findLibraries(binding)
    return multiple ? libraries : libraries.slice(0, 1)
  }

  async function nextLibraryPath(binding) {
    const current = binding.currentFile
    if (current.toLowerCase().endsWith('.lib.pen')) throw new Error('the current file is already a design library')
    const stem = current.toLowerCase().endsWith('.pen') ? current.slice(0, -4) : current
    for (let suffix = 0; suffix < 10000; suffix += 1) {
      const target = stem + (suffix ? '-' + suffix : '') + '.lib.pen'
      try { await fsp.access(target) }
      catch (error) { if (error && error.code === 'ENOENT') return workspacePath(binding, target); throw error }
    }
    throw new Error('could not allocate a design-library filename')
  }

  return {
    browseLibraries,
    cleanup,
    findLibraries,
    fingerprint,
    importFile,
    importFiles,
    importUri,
    nextLibraryPath,
    readFile: (binding, input) => fsp.readFile(readablePath(binding, input)),
    async statFile(binding, input) {
      const stat = await fsp.stat(readablePath(binding, input))
      return { exists: true, isFile: stat.isFile() }
    },
    rememberDocument,
    saveGeneratedImage,
    stopDocumentWatcher,
    unwatchFile,
    watchFile,
    workspacePath,
  }
}
